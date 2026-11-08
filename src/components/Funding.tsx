import {useCallback, useEffect, useState} from 'react';
import {ArrowRight, LoaderCircle, ShieldCheck} from 'lucide-react';
import {cityRequest} from '../lib/city-api';
import {useI18n} from '../lib/i18n';
import {FundingInstructions, type FundingToken, type FundingQuote} from './FundingInstructions';

type FundingStatus = {intentsEnabled: boolean; liveEnabled: boolean; walletSetupEnabled: boolean; message: string};
const paymentLabels: Record<string, string> = {
  SUCCESS: 'Funding complete',
  PENDING_DEPOSIT: 'Waiting for your deposit',
  KNOWN_DEPOSIT_TX: 'Deposit detected',
  PROCESSING: 'Processing swap',
  INCOMPLETE_DEPOSIT: 'Deposit incomplete',
  REFUNDING: 'Refund in progress',
  REFUNDED: 'Refunded',
  FAILED: 'Funding failed',
};
/** Optional mainnet wallet funding, entirely separate from the game coin ledger. */
export function Funding() {
  const {t, locale} = useI18n();
  const [status, setStatus] = useState<FundingStatus | null>(null),
    [walletReady, setWalletReady] = useState(false),
    [tokens, setTokens] = useState<FundingToken[]>([]),
    [asset, setAsset] = useState(''),
    [amount, setAmount] = useState(''),
    [refund, setRefund] = useState(''),
    [quote, setQuote] = useState<FundingQuote | null>(null),
    [payment, setPayment] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(Date.now());
  // Funding explicitly checks the chain and sponsor; ordinary sign-in does not
  // wait for these sequential read-only probes. Cancellation still closes this load.
  const load = useCallback(async (signal?: AbortSignal) => {
    const s = await cityRequest<FundingStatus>('/api/near/status?readiness=1', undefined, signal, 60000);
    setStatus(s);
    if (!s.intentsEnabled || !s.liveEnabled) return;
    const wallet = await cityRequest<{walletReady: boolean}>('/api/near/balance', undefined, signal);
    setWalletReady(wallet.walletReady);
    if (wallet.walletReady) {
      const list = await cityRequest<{tokens: FundingToken[]}>('/api/intents/tokens', undefined, signal);
      setTokens(list.tokens);
      setAsset(
        current =>
          current || list.tokens.find(token => token.symbol === 'USDC')?.assetId || list.tokens[0]?.assetId || '',
      );
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal).catch(e => {
      if (!abort.signal.aborted) setError(e.message);
    });
    return () => abort.abort();
  }, [load]);
  useEffect(() => {
    if (!quote || quote.dry) return;
    const abort = new AbortController();
    let working = false;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (working || ['SUCCESS', 'REFUNDED', 'FAILED'].includes(payment)) return;
      working = true;
      void cityRequest<{status: string}>(`/api/intents/status/${quote.id}`, undefined, abort.signal)
        .then(result => setPayment(result.status))
        .catch(e => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          working = false;
        });
    }, 5000);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [quote, payment]);
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      await cityRequest('/api/near/prepare-wallet', {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function getQuote() {
    setBusy(true);
    setError('');
    setQuote(null);
    setPayment('');
    try {
      const next = await cityRequest<FundingQuote>('/api/intents/quote', {
        originAsset: asset,
        amount,
        refundTo: refund,
        slippageBps: 100,
        dry: false,
      });
      setQuote(next);
      setNow(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const enabled = status?.intentsEnabled && status.liveEnabled && walletReady,
    expired = !!quote?.quote.deadline && Date.parse(quote.quote.deadline) <= now;
  return (
    <div className="funding-panel">
      <p>{t('Optional wallet funding. This does not buy Worldo coins.')}</p>
      <p>
        {t(
          'Use a supported asset from another chain to fund your own account with wNEAR. Review the quote before sending anything.',
        )}
      </p>
      {!enabled && <p role="status">{t(status?.message || 'Checking account availability…')}</p>}
      {status?.intentsEnabled && status.liveEnabled && !walletReady && (
        <button className="button" disabled={busy || !status.walletSetupEnabled} onClick={() => void prepare()}>
          {t('Activate wallet · setup sponsored')}
        </button>
      )}
      {enabled && (
        <>
          <label>
            {t('PAY WITH')}
            <select
              value={asset}
              onChange={e => {
                setAsset(e.target.value);
                setQuote(null);
              }}
            >
              {tokens.map(token => (
                <option key={token.assetId} value={token.assetId}>
                  {token.symbol} · {token.blockchain}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('AMOUNT')}
            <input
              dir="ltr"
              inputMode="decimal"
              value={amount}
              onChange={e => {
                setAmount(e.target.value);
                setQuote(null);
              }}
              placeholder="0.00"
            />
          </label>
          <label>
            {t('REFUND ADDRESS')}
            <input
              dir="ltr"
              value={refund}
              onChange={e => {
                setRefund(e.target.value);
                setQuote(null);
              }}
              placeholder={t('Your address on the sending chain')}
            />
          </label>
          <small>{t('Refunds return to this address if the swap cannot complete. Maximum slippage: 1%.')}</small>
          <button
            className="button primary"
            disabled={busy || !asset || !amount || !refund}
            onClick={() => void getQuote()}
          >
            {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />} {t('Review funding quote')}
          </button>
        </>
      )}
      {quote && (
        <section className="funding-quote">
          <div>
            {t('Estimated received')} <strong>{quote.quote.amountOutFormatted || '—'} wNEAR</strong>
          </div>
          <p>{t('The result is wrapped NEAR in your own wallet.')}</p>
          {expired ? (
            <p>{t('This quote has expired.')}</p>
          ) : (
            <FundingInstructions quote={quote} tokens={tokens} onCopyError={setError} />
          )}
          <small>
            {t('Quote expires:')} {quote.quote.deadline ? new Date(quote.quote.deadline).toLocaleString(locale) : '—'}
          </small>
          <p role="status">{t(paymentLabels[payment] || 'Waiting for your deposit')}</p>
        </section>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {t(error)}
        </p>
      )}
      <small>
        <ShieldCheck size={14} /> NEAR Intents · 1Click
      </small>
    </div>
  );
}
