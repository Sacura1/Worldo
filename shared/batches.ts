import type {SettlementBatch, SettlementPlan} from './game';
const MAX_MERGED_EFFECTS = 100;
const effectCount = (plan: SettlementPlan) =>
  plan.transfers.length + plan.mints.length + plan.burns.length + (plan.stationEffects?.length ?? 0);
/** Two neighbouring city updates can become one. The contract already checks net
 * balance changes across a tick, so the result settles exactly the same totals. */
export function mergeTickPlans(first: SettlementPlan, second: SettlementPlan): SettlementPlan | null {
  const transfers = first.transfers.map(item => ({...item})),
    mints = first.mints.map(item => ({...item})),
    burns = first.burns.map(item => ({...item})),
    stationEffects = (first.stationEffects ?? []).map(item => ({...item}));
  for (const item of second.transfers) {
    const match = transfers.find(t => t.from === item.from && t.to === item.to && t.tokenId === item.tokenId);
    if (match) match.amount += item.amount;
    else transfers.push({...item});
  }
  for (const item of second.mints) {
    const match = mints.find(m => m.to === item.to && m.tokenId === item.tokenId && m.reason === item.reason);
    if (match) match.amount += item.amount;
    else mints.push({...item});
  }
  for (const item of second.burns) {
    const match = burns.find(b => b.from === item.from && b.tokenId === item.tokenId && b.reason === item.reason);
    if (match) match.amount += item.amount;
    else burns.push({...item});
  }
  for (const item of second.stationEffects ?? []) {
    const match = stationEffects.find(e => e.stationId === item.stationId);
    if (match) match.petrolDelta += item.petrolDelta;
    else stationEffects.push({...item});
  }
  const merged: SettlementPlan = {
    ...second,
    transfers,
    mints,
    burns,
    stationEffects,
    metadata: {
      ...first.metadata,
      ...second.metadata,
      elapsedMs: Number(first.metadata.elapsedMs ?? 0) + Number(second.metadata.elapsedMs ?? 0),
    },
  };
  return effectCount(merged) <= MAX_MERGED_EFFECTS ? merged : null;
}
/** Player actions keep their exact order. Only ticks that touch each other merge. */
export function compactOutbox(queue: readonly SettlementPlan[]): SettlementPlan[] {
  const compact: SettlementPlan[] = [];
  for (const plan of queue) {
    const last = compact.at(-1),
      merged = last?.action === 'tick' && plan.action === 'tick' ? mergeTickPlans(last, plan) : null;
    if (merged) compact[compact.length - 1] = merged;
    else compact.push(plan);
  }
  return compact;
}
/** Mirrors the contract's aggregated NEP-245 event budget. Leave room for receipt logs. */
export function estimateWorldBatchLogBytes(batch: SettlementBatch): number {
  const mints = new Map<string, Map<string, number>>(),
    burns = new Map<string, Map<string, number>>(),
    transfers = new Map<string, {from: string; to: string; tokens: Map<string, number>}>();
  let records: unknown;
  const add = (map: Map<string, Map<string, number>>, owner: string, token: string, amount: number) => {
    const items = map.get(owner) || new Map<string, number>();
    items.set(token, (items.get(token) || 0) + amount);
    map.set(owner, items);
  };
  for (const plan of batch.plans) {
    for (const m of plan.mints) add(mints, m.to, m.tokenId, m.amount);
    for (const b of plan.burns) add(burns, b.from, b.tokenId, b.amount);
    for (const t of plan.transfers) {
      const key = t.from + '|' + t.to;
      const group = transfers.get(key) || {from: t.from, to: t.to, tokens: new Map<string, number>()};
      group.tokens.set(t.tokenId, (group.tokens.get(t.tokenId) || 0) + t.amount);
      transfers.set(key, group);
    }
    if (typeof plan.metadata.mayorRecords === 'string') {
      try {
        records = JSON.parse(plan.metadata.mayorRecords);
      } catch {}
    }
  }
  const logs: string[] = [];
  const event = (standard: string, event: string, data: unknown) =>
    logs.push(
      'EVENT_JSON:' + JSON.stringify({standard, version: standard === 'nep245' ? '1.0.0' : '2.0.0', event, data}),
    );
  for (const [name, owners] of [
    ['mt_mint', mints],
    ['mt_burn', burns],
  ] as const)
    if (owners.size)
      event(
        'nep245',
        name,
        [...owners].map(([owner, tokens]) => ({
          owner_id: owner,
          token_ids: [...tokens.keys()],
          amounts: [...tokens.values()].map(String),
        })),
      );
  if (transfers.size)
    event(
      'nep245',
      'mt_transfer',
      [...transfers.values()].map(g => ({
        old_owner_id: g.from,
        new_owner_id: g.to,
        token_ids: [...g.tokens.keys()],
        amounts: [...g.tokens.values()].map(String),
      })),
    );
  if (records) event('worldo', 'mayor_decisions', [{batch_id: batch.id, records}]);
  return logs.reduce((n, l) => n + new TextEncoder().encode(l).length, 0) + 600;
}
