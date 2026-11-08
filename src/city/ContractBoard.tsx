import {useState} from 'react';
import {Check, Clock, FileCheck2, LockKeyhole, PackageCheck} from 'lucide-react';
import type {CityId, GameAction, GameSnapshot} from '../../shared/game';
import {DAY_LENGTH_MS} from '../../shared/config/cities';
import {CONTRACT_MAX_ACTIVE, REPUTATION_CONTRACT_MIN, REPUTATION_PRIORITY} from '../../shared/config/reputation';
import {useI18n} from '../lib/i18n';
import {GoodsIcon, Money, RESOURCE_LABELS} from './ui';
import {Reputation} from './StationPanel';
export function ContractBoard({
  state,
  cityId,
  busy,
  onAction,
}: {
  state: GameSnapshot;
  cityId: CityId;
  busy: boolean;
  onAction: (action: GameAction) => Promise<void>;
}) {
  const {t} = useI18n(),
    player = state.player,
    [quantities, setQuantities] = useState<Record<string, number>>({});
  const contracts = state.world.supplyContracts.filter(
    c => c.cityId === cityId && (c.status === 'open' || c.ownerId === player.accountId),
  );
  const activeCount = state.world.supplyContracts.filter(
      c => c.ownerId === player.accountId && c.status === 'active',
    ).length,
    rep = player.reputation[cityId];
  return (
    <div className="contract-board">
      <div className="contract-board-heading">
        <div>
          <span className="eyebrow">{t('Steady work for reliable suppliers')}</span>
          <h3>{t('Supply contracts')}</h3>
        </div>
        <Reputation score={rep} />
      </div>
      <p>
        {t(
          'Lock a delivery price for several game days. Complete each day’s order to earn the agreed payment and improve your reputation.',
        )}
      </p>
      <small>
        {t('A game day lasts {minutes} minutes.', {minutes: DAY_LENGTH_MS / 60000})} ·{' '}
        {t('{count} of {maximum} active contracts', {count: activeCount, maximum: CONTRACT_MAX_ACTIVE})}
      </small>
      {contracts.length === 0 && (
        <div className="empty-board">
          <FileCheck2 size={34} />
          <p>{t('No supply contracts are posted here yet. Check back as city stocks change.')}</p>
        </div>
      )}
      {contracts.map(c => {
        const owned = c.ownerId === player.accountId,
          remaining = Math.max(0, c.quantityPerDay - c.deliveredToday),
          quantity = Math.min(quantities[c.id] ?? 1, remaining, player.inventory[c.resource]);
        return (
          <article className={`contract-ticket ${c.status}`} key={c.id}>
            <div className="ticket-top">
              <GoodsIcon resource={c.resource} size={26} />
              <div>
                <h3>{t(RESOURCE_LABELS[c.resource])}</h3>
                <span>{t('{quantity} units a day for {days} days', {quantity: c.quantityPerDay, days: c.days})}</span>
              </div>
              <strong>{t(c.status)}</strong>
            </div>
            <div className="contract-terms">
              <span>
                {t('Locked price')}
                <Money value={c.unitPrice} />
                <small>{t('/ unit')}</small>
              </span>
              <span>
                {t('Deposit at acceptance')}
                <Money value={c.collateral} />
              </span>
            </div>
            {c.status === 'open' ? (
              <>
                <p className="fine-print">
                  {t(
                    'The deposit is returned on completion. Missing a daily delivery forfeits it and lowers your reputation.',
                  )}
                </p>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    state.world.preview ||
                    rep < REPUTATION_CONTRACT_MIN ||
                    activeCount >= CONTRACT_MAX_ACTIVE ||
                    player.coins < c.collateral
                  }
                  onClick={() => void onAction({type: 'contract_accept', contractId: c.id})}
                >
                  <LockKeyhole size={15} />
                  {t('Accept locked-price contract')}
                </button>
                {rep < REPUTATION_CONTRACT_MIN && (
                  <small>{t('Improve your reputation before accepting contracts.')}</small>
                )}
                {rep < REPUTATION_PRIORITY && <small>{t('Trusted suppliers get first access to new offers.')}</small>}
              </>
            ) : owned && c.status === 'active' ? (
              <>
                <div className="contract-progress">
                  <PackageCheck size={17} />
                  {t('Delivered today')}:{' '}
                  <bdi dir="ltr">
                    {c.deliveredToday} / {c.quantityPerDay}
                  </bdi>
                  <span>
                    {t('Completed days')}:{' '}
                    <bdi dir="ltr">
                      {c.daysCompleted} / {c.days}
                    </bdi>
                  </span>
                </div>
                <p className="contract-deadline">
                  <Clock size={14} />
                  {t('Next deadline in {minutes} minutes', {
                    minutes: Math.max(
                      0,
                      Math.ceil(((c.dueAt ?? state.world.simulatedAt) - state.world.simulatedAt) / 60000),
                    ),
                  })}
                </p>
                <div className="contract-delivery">
                  <label>
                    {t('Quantity')}
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, Math.min(remaining, player.inventory[c.resource]))}
                      value={quantities[c.id] ?? 1}
                      onChange={e =>
                        setQuantities({...quantities, [c.id]: Math.max(1, Math.floor(Number(e.target.value) || 1))})
                      }
                    />
                  </label>
                  <button
                    className="button"
                    disabled={busy || state.world.preview || quantity < 1}
                    onClick={() => void onAction({type: 'contract_deliver', contractId: c.id, quantity})}
                  >
                    {t('Deliver to contract')}
                  </button>
                </div>
              </>
            ) : (
              <p className="contract-result">
                <Check size={15} />
                {t(c.status === 'completed' ? 'Contract completed. Deposit returned.' : 'This contract is closed.')}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
