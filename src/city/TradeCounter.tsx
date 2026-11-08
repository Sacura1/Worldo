import {useEffect, useState} from 'react';
import {ArrowDownLeft, ArrowUpRight, Clock, Info, Landmark, LoaderCircle} from 'lucide-react';
import type {CityId, GameAction, GameSnapshot, PriceQuote, Resource} from '../../shared/game';
import {CITIES} from '../../shared/config/cities';
import {RESOURCES} from '../../shared/config/items';
import {getCityQuote} from '../lib/city-api';
import {useI18n} from '../lib/i18n';
import {GoodsIcon, Money, RESOURCE_LABELS, Meter} from './ui';
/** Rule-based notes have translations. A NEAR AI note is shown exactly as written. */
export function MayorDecision({city}: {city: GameSnapshot['world']['cities'][CityId]}) {
  const {t} = useI18n(),
    ai = city.policy.source === 'near-ai';
  return (
    <div className={`mayor-decision ${ai ? 'ai' : ''}`}>
      <Landmark size={17} />
      <div>
        <span className="eyebrow">{t('Mayor decision')}</span>
        <p dir="auto">{ai ? city.policy.note : t(city.policy.note)}</p>
        <small>{t(ai ? 'Decided with NEAR AI' : 'Decided by city rules')}</small>
      </div>
    </div>
  );
}
export function TradeCounter({
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
  const {t, formatNumber} = useI18n(),
    city = state.world.cities[cityId];
  const [resource, setResource] = useState<Resource>(
      cityId === 'refinery' ? 'crude_oil' : cityId === 'motor' ? 'rubber' : 'wood',
    ),
    [side, setSide] = useState<'buy' | 'sell'>('sell'),
    [quantity, setQuantity] = useState(1),
    [bountyId, setBountyId] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [receivedQuote, setReceivedQuote] = useState<{key: string; value: PriceQuote} | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const quoteKey = JSON.stringify([cityId, resource, side, quantity, bountyId ?? null]);
  // Selection changes invalidate an old quote in this render, before effects
  // run. Same-order background refreshes keep the displayed, price-limited
  // offer usable instead of clearing it between pointer-down and click.
  const quote = receivedQuote?.key === quoteKey ? receivedQuote.value : null;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void getCityQuote(cityId, resource, side, quantity, bountyId)
      .then(q => {
        if (alive) setReceivedQuote({key: quoteKey, value: q});
      })
      .catch(e => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [quoteKey, cityId, resource, side, quantity, bountyId, state.world.economyRevision, state.player.nonce, refresh]);
  const available = side === 'sell' ? state.player.inventory[resource] : city.stock[resource];
  return (
    <div className="trade-counter">
      <div className="counter-summary">
        <div>
          <span className="eyebrow">{t(CITIES[cityId].name)}</span>
          <strong>{t(city.state)}</strong>
          <small>
            {t('City fuel')} · {formatNumber(city.fuelPercent, {maximumFractionDigits: 0})}%
          </small>
          <Meter value={city.fuelPercent} label={t('City fuel')} />
        </div>
        <div>
          <span className="eyebrow">{t('Treasury')}</span>
          <Money value={city.treasury} />
          <small>{t('Finite funds · live prices')}</small>
        </div>
      </div>
      {city.bounties.length > 0 && (
        <div className="bounty-list">
          {city.bounties.map(b => (
            <button
              key={b.id}
              className={`bounty-ticket ${bountyId === b.id ? 'selected' : ''}`}
              onClick={() => {
                setBountyId(b.id);
                setResource(b.resource);
                setSide('sell');
                setQuantity(Math.max(1, Math.min(b.remaining, state.player.inventory[b.resource])));
              }}
            >
              <span className="eyebrow">
                {t('Emergency delivery')}
                <Clock size={12} />
                {Math.max(0, Math.ceil((b.expiresAt - state.world.simulatedAt) / 60000))}m
              </span>
              <strong>
                <GoodsIcon resource={b.resource} />
                {t(RESOURCE_LABELS[b.resource])}
              </strong>
              <span>
                {t('{count} units needed', {count: b.remaining})} · <Money value={b.unitPrice} />
                {t('/ unit')}
              </span>
              <small>{t('Payment reserved by the city')}</small>
            </button>
          ))}
        </div>
      )}
      <div className="counter-tabs">
        <button
          className={side === 'sell' ? 'active' : ''}
          onClick={() => {
            setSide('sell');
            setBountyId(undefined);
          }}
        >
          <ArrowUpRight size={16} />
          {t('Sell cargo')}
        </button>
        <button
          className={side === 'buy' ? 'active' : ''}
          onClick={() => {
            setSide('buy');
            setBountyId(undefined);
          }}
        >
          <ArrowDownLeft size={16} />
          {t('Buy supplies')}
        </button>
      </div>
      <div className="goods-selector">
        {RESOURCES.map(r => (
          <button
            key={r}
            className={resource === r ? 'active' : ''}
            onClick={() => {
              setResource(r);
              setBountyId(undefined);
              setQuantity(1);
            }}
          >
            <GoodsIcon resource={r} />
            <span>{t(RESOURCE_LABELS[r])}</span>
            <small>{formatNumber(side === 'sell' ? state.player.inventory[r] : city.stock[r])}</small>
          </button>
        ))}
      </div>
      <div className="trade-detail">
        <div>
          <span className="eyebrow">{t(side === 'sell' ? 'In your cargo' : 'In city stock')}</span>
          <strong>
            {formatNumber(available)} <small>{t('units')}</small>
          </strong>
        </div>
        <label>
          {t('Quantity')}
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="10000"
            value={quantity}
            onChange={e => setQuantity(Math.max(1, Math.min(10000, Math.floor(Number(e.target.value) || 1))))}
          />
        </label>
        <button
          className="quiet-button"
          onClick={() => setQuantity(Math.max(1, Math.min(available, quote?.maxQuantity ?? available)))}
        >
          {t('Maximum')}
        </button>
      </div>
      <div className="price-explanation" role="status">
        <Info size={17} />
        <div>
          {loading ? t('Updating price…') : error ? t(error) : quote ? t(quote.reason) : t('Choose goods for a quote.')}
          {quote && (
            <small>
              {t('Price per unit')}: <Money value={quote.unitPrice} />
            </small>
          )}
          {quote && quote.firstUnitPrice !== quote.lastUnitPrice && (
            <small className="price-move">
              {t('This order moves the price from {from} to {to} coins.', {
                from: quote.firstUnitPrice,
                to: quote.lastUnitPrice,
              })}
            </small>
          )}
        </div>
      </div>
      <MayorDecision city={city} />
      <button
        className="button primary trade-submit"
        disabled={busy || !quote?.available || quantity > available || quantity > (quote?.maxQuantity ?? 0)}
        onClick={() => {
          if (quote)
            void onAction(
              side === 'sell'
                ? {type: 'sell', cityId, resource, quantity, bountyId, limit: quote.total}
                : {type: 'buy', cityId, resource, quantity, limit: quote.total},
            ).finally(() => setRefresh(value => value + 1));
        }}
      >
        {busy ? (
          <LoaderCircle className="spin" size={18} />
        ) : side === 'sell' ? (
          <ArrowUpRight size={18} />
        ) : (
          <ArrowDownLeft size={18} />
        )}
        <span>{t(side === 'sell' ? 'Sell for' : 'Buy for')}</span>
        <Money value={quote?.total ?? 0} />
      </button>
      {side === 'sell' &&
        available > 0 &&
        quote?.maxQuantity === 0 &&
        (resource === 'petrol' || CITIES[cityId].targetStock[resource] > 0) && (
          <button
            className="button workshop-link"
            disabled={busy}
            onClick={() => void onAction({type: 'donate', cityId, resource, quantity: 1})}
          >
            {t('Donate 1 unit to help the city restart')}
          </button>
        )}
      <p className="fine-print">
        {t(
          'Prices and quantities are checked again when you trade. Coins are game assets, separate from NEAR network fees.',
        )}
      </p>
    </div>
  );
}
