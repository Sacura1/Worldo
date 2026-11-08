import {useI18n, t} from '../lib/i18n';
import {Copy} from 'lucide-react';

export type FundingToken = {assetId: string; symbol: string; blockchain: string; decimals: number};
export type FundingQuote = {
  id: string;
  dry: boolean;
  verified: boolean;
  request: unknown;
  quote: {
    depositAddress?: string;
    depositMemo?: string;
    amountInFormatted?: string;
    amountOutFormatted?: string;
    timeEstimate?: number;
    deadline?: string;
  };
};
const networks: Record<string, string> = {
  eth: 'Ethereum',
  base: 'Base',
  arb: 'Arbitrum',
  op: 'Optimism',
  pol: 'Polygon',
  bsc: 'BNB Smart Chain',
  avax: 'Avalanche',
  gnosis: 'Gnosis',
  bera: 'Berachain',
  xlayer: 'X Layer',
  monad: 'Monad',
  plasma: 'Plasma',
  scroll: 'Scroll',
  near: 'NEAR',
  sol: 'Solana',
  btc: 'Bitcoin',
};

/** Payment details come from the verified quote, never from editable form state.
 * Format atomic source units ourselves so a rounded display cannot underpay. */
export function fundingInstructions(quote: FundingQuote, tokens: FundingToken[]) {
  if (quote.dry || !quote.verified || !quote.request || typeof quote.request !== 'object') return null;
  const request = quote.request as Record<string, unknown>,
    token = tokens.find(t => t.assetId === request.originAsset);
  const address = quote.quote.depositAddress,
    memo = quote.quote.depositMemo;
  if (
    !token ||
    !Number.isInteger(token.decimals) ||
    token.decimals < 0 ||
    token.decimals > 30 ||
    typeof request.amount !== 'string' ||
    !/^\d{1,48}$/.test(request.amount) ||
    BigInt(request.amount) <= 0n ||
    typeof address !== 'string' ||
    !address ||
    address.trim() !== address ||
    (memo !== undefined && typeof memo !== 'string')
  )
    return null;
  const digits = BigInt(request.amount)
    .toString()
    .padStart(token.decimals + 1, '0');
  const whole = token.decimals ? digits.slice(0, -token.decimals) : digits,
    fraction = token.decimals ? digits.slice(-token.decimals).replace(/0+$/, '') : '';
  return {
    address,
    memo: memo || null,
    amount: whole + (fraction ? '.' + fraction : ''),
    symbol: token.symbol,
    network: networks[token.blockchain] || token.blockchain,
  };
}

export function FundingInstructions({
  quote,
  tokens,
  onCopyError,
}: {
  quote: FundingQuote;
  tokens: FundingToken[];
  onCopyError: (message: string) => void;
}) {
  useI18n();
  const instructions = fundingInstructions(quote, tokens);
  if (!instructions)
    return (
      <p role="alert" className="form-error">
        {t('Payment instructions could not be verified. Request a new quote before sending funds.')}
      </p>
    );
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      onCopyError('Could not copy. Select the value and copy it manually.');
    }
  }
  return (
    <>
      <label className="field-label">
        {t('SEND EXACTLY')}
        <div className="copy-value">
          <code dir="ltr">
            {instructions.amount} {instructions.symbol}
          </code>
          <button type="button" aria-label={t('Copy payment amount')} onClick={() => void copy(instructions.amount)}>
            <Copy size={16} />
          </button>
        </div>
      </label>
      <p className="fine-print">
        {t('Use {asset} on {network} for this quote.', {asset: instructions.symbol, network: instructions.network})}
      </p>
      <label className="field-label">
        {t('DEPOSIT ADDRESS')}
        <div className="copy-value">
          <code dir="ltr">{instructions.address}</code>
          <button type="button" aria-label={t('Copy deposit address')} onClick={() => void copy(instructions.address)}>
            <Copy size={16} />
          </button>
        </div>
      </label>
      {instructions.memo !== null && (
        <>
          <label className="field-label">
            {t('REQUIRED MEMO')}
            <div className="copy-value">
              <code dir="ltr">{instructions.memo}</code>
              <button type="button" aria-label={t('Copy required memo')} onClick={() => void copy(instructions.memo!)}>
                <Copy size={16} />
              </button>
            </div>
          </label>
          <p className="fine-print">{t('Include this memo exactly when sending. The address alone is not enough.')}</p>
        </>
      )}
    </>
  );
}
