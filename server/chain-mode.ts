/** Local play and chain-backed worlds never share saves. Opt in explicitly only
 * after the matching deployment and operator credentials are configured. */
export function chainSyncEnabled(env: Record<string, string | undefined> = process.env) {
  const value = env.CHAIN_SYNC_ENABLED ?? 'false';
  if (!['true', 'false'].includes(value)) throw new Error('CHAIN_SYNC_ENABLED must be true or false.');
  return value === 'true';
}
