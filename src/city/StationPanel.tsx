import {useEffect, useRef, useState} from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Construction,
  Fuel,
  Info,
  LandPlot,
  Megaphone,
  Smile,
  TrendingUp,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';
import type {GameAction, GameSnapshot} from '../../shared/game';
import {CITIES} from '../../shared/config/cities';
import {
  STATION_BUILD_FEE,
  STATION_BUILD_WOOD,
  STATION_MAX_PRICE,
  STATION_MIN_PRICE,
  STATION_PLOT_PRICE,
  STATION_REPAIR_PER_RUBBER,
  STATION_UPGRADE,
} from '../../shared/config/stations';
import {MAYORS} from '../../shared/mayors';
import {useI18n} from '../lib/i18n';
import {Meter, Money} from './ui';

export function Reputation({score}: {score: number}) {
  const {t} = useI18n();
  return (
    <span
      className={`reputation ${score < 0 ? 'unhappy' : score >= 35 ? 'trusted' : ''}`}
      title={t('Mayor reputation')}
    >
      <Smile size={16} />
      <strong>
        {score > 0 ? '+' : ''}
        {Math.round(score)}
      </strong>
      <small>{t(score >= 35 ? 'Trusted' : score <= -25 ? 'Distrusted' : 'Getting acquainted')}</small>
    </span>
  );
}
export function StationPanel({
  state,
  stationId,
  busy,
  onAction,
  onLocate,
  allowSimulatedPricing = false,
}: {
  state: GameSnapshot;
  stationId: string;
  busy: boolean;
  onAction: (action: GameAction) => Promise<void>;
  onLocate: () => void;
  allowSimulatedPricing?: boolean;
}) {
  const {t, formatNumber} = useI18n(),
    station = state.world.stations[stationId],
    player = state.player;
  const [name, setName] = useState(''),
    [price, setPrice] = useState(station?.price ?? 12),
    [quantity, setQuantity] = useState(1),
    [dirty, setDirty] = useState(false);
  const savedPrice = useRef(station?.price);
  useEffect(() => {
    if (station?.price === price) setDirty(false);
    if (savedPrice.current !== station?.price) {
      savedPrice.current = station?.price;
      if (!dirty) setPrice(station?.price ?? 12);
    }
  }, [station?.price, dirty, price]);
  if (!station) return <p>{t('This station is not available.')}</p>;
  const city = state.world.cities[station.cityId],
    owned = station.ownerId === player.accountId,
    near = Math.hypot(player.position.x - station.position.x, player.position.z - station.position.z) <= 9,
    canManage = owned && !state.world.preview,
    canPrice = owned && (!state.world.preview || allowSimulatedPricing);
  const score = player.reputation[station.cityId],
    mayor = MAYORS.find(m => m.cityId === station.cityId)!;
  const maxWood = Math.min(player.inventory.wood, STATION_BUILD_WOOD - station.woodDelivered),
    maxPetrol = Math.min(player.inventory.petrol, station.tankCapacity - station.tank);
  const applyPrice = async () => {
    if (!dirty || busy || !canPrice) return;
    await onAction({type: 'station_price', stationId, price});
  };
  return (
    <div className="station-panel">
      <div className="station-header-card">
        <div className="station-emblem">
          <Fuel size={42} />
        </div>
        <div>
          <span className="eyebrow">{t(CITIES[station.cityId].name)}</span>
          <h3>{station.ownerId ? station.name : t('A corner of the city, yours to run.')}</h3>
          <small>
            {station.ownerId ? <bdi>{station.ownerId}</bdi> : t('Station plot · one per player in each city')}
          </small>
        </div>
      </div>
      {!station.ownerId ? (
        <>
          <p>
            {t(
              'Build a petrol station, stock its tank and win customers with your prices. Drivers compare price, queues and distance.',
            )}
          </p>
          <div className="station-requirements">
            <span>
              <LandPlot size={18} />
              {t('Plot deed')}
              <Money value={STATION_PLOT_PRICE} />
            </span>
            <span>
              <Construction size={18} />
              {t('Construction')}
              <b>
                {STATION_BUILD_WOOD} {t('Wood')}
              </b>
              <Money value={STATION_BUILD_FEE} />
            </span>
          </div>
          <label className="station-name-label">
            {t('Station name')}
            <input
              maxLength={32}
              value={name}
              placeholder={t('Name your station')}
              onChange={e => setName(e.target.value)}
            />
          </label>
          {!near && (
            <button className="button" onClick={onLocate}>
              {t('Find this plot')}
              <ArrowRight size={16} />
            </button>
          )}
          <button
            className="button primary trade-submit"
            disabled={
              busy ||
              !near ||
              state.world.preview ||
              player.coins < STATION_PLOT_PRICE ||
              Object.values(state.world.stations).some(
                s => s.cityId === station.cityId && s.ownerId === player.accountId,
              )
            }
            onClick={() => void onAction({type: 'station_buy', stationId, name: name.trim() || undefined})}
          >
            {t('Buy the station deed')}
            <Money value={STATION_PLOT_PRICE} />
          </button>
          <p className="fine-print">
            {t('The deed identifies your station. Construction and fuel are separate costs.')}
          </p>
        </>
      ) : (
        <>
          <div className="station-stats">
            <div>
              <Fuel />
              <small>{t('Tank')}</small>
              <strong>
                <bdi dir="ltr">
                  {station.tank}
                  <em> / {station.tankCapacity} L</em>
                </bdi>
              </strong>
              <Meter value={(station.tank / station.tankCapacity) * 100} label={t('Tank')} />
            </div>
            <div>
              <TrendingUp />
              <small>{t('Sales today')}</small>
              <strong>
                {formatNumber(station.litresSoldToday)}
                <em> L</em>
              </strong>
              <Money value={station.revenueToday} />
            </div>
            <div>
              <Users />
              <small>{t('Queue')}</small>
              <strong>
                {station.queueLength}
                <em> {t('cars')}</em>
              </strong>
              <small>
                {t('Pump condition')}: {Math.round(station.pumpDurability)}%
              </small>
            </div>
          </div>
          {station.progress < 100 ? (
            <div className="station-construction">
              <Construction size={24} />
              <div>
                <h3>{t('Build your station')}</h3>
                <p>
                  {t('{delivered} of {needed} wood delivered', {
                    delivered: station.woodDelivered,
                    needed: STATION_BUILD_WOOD,
                  })}
                </p>
                <Meter value={station.progress} label={t('Construction')} />
                <small>
                  {Math.floor(station.progress)}% · {t('Deliver wood to raise the structure.')}
                </small>
              </div>
              {canManage && (
                <>
                  <label>
                    {t('Wood')}
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, maxWood)}
                      value={quantity}
                      onChange={e =>
                        setQuantity(Math.max(1, Math.min(maxWood || 1, Math.floor(Number(e.target.value) || 1))))
                      }
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={
                      busy || !near || maxWood < 1 || (!station.buildFeePaid && player.coins < STATION_BUILD_FEE)
                    }
                    onClick={() =>
                      void onAction({type: 'station_build', stationId, quantity: Math.min(quantity, maxWood)})
                    }
                  >
                    {t('Deliver wood')}
                    {!station.buildFeePaid && <Money value={STATION_BUILD_FEE} />}
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="pump-price-card">
                <div className="pump-price-heading">
                  <span className="eyebrow">{t('Your pump price')}</span>
                  <Money value={price} />
                  <small>{t('/ litre')}</small>
                </div>
                <input
                  aria-label={t('Pump price')}
                  type="range"
                  min={STATION_MIN_PRICE}
                  max={STATION_MAX_PRICE}
                  step="1"
                  value={price}
                  disabled={!canPrice || busy}
                  onChange={e => {
                    setPrice(Number(e.target.value));
                    setDirty(true);
                  }}
                  onPointerUp={() => void applyPrice()}
                  onKeyUp={e => {
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key))
                      void applyPrice();
                  }}
                />
                <div className="pump-price-scale">
                  <span>{STATION_MIN_PRICE}</span>
                  <span>
                    {t('City station')}: {city.stationPrice} {t('coins / litre')}
                  </span>
                  <span>{STATION_MAX_PRICE}</span>
                </div>
                {dirty && (
                  <button className="button" disabled={!canPrice || busy} onClick={() => void applyPrice()}>
                    {t('Apply pump price')}
                    <Money value={price} />
                  </button>
                )}
                {city.priceCap &&
                  city.priceCapUntil > state.world.simulatedAt &&
                  station.effectivePrice < station.price && (
                    <p className="shortage-note">
                      <Info size={15} />
                      {t('A temporary city cap limits your pump price to {price}.', {price: station.effectivePrice})}
                    </p>
                  )}
              </div>
              {canManage && (
                <div className="station-services">
                  <div className="service-card">
                    <ArrowDownToLine />
                    <div>
                      <h3>{t('Unload petrol')}</h3>
                      <small>
                        {t('In your cargo')}: {player.inventory.petrol} L
                      </small>
                      <p>{t('Buy wholesale petrol at Refinery City, then haul it here.')}</p>
                    </div>
                    <label className="sr-only" htmlFor="station-unload">
                      {t('Litres to unload')}
                    </label>
                    <input
                      id="station-unload"
                      type="number"
                      min="1"
                      max={Math.max(1, maxPetrol)}
                      value={quantity}
                      onChange={e =>
                        setQuantity(Math.max(1, Math.min(maxPetrol || 1, Math.floor(Number(e.target.value) || 1))))
                      }
                    />
                    <button
                      className="button primary"
                      disabled={busy || !near || maxPetrol < 1}
                      onClick={() =>
                        void onAction({type: 'station_stock', stationId, quantity: Math.min(quantity, maxPetrol)})
                      }
                    >
                      {t('Unload')}
                    </button>
                  </div>
                  <div className="station-upkeep">
                    <Wrench size={18} />
                    <span>
                      {t('Repair pump hoses')}
                      <small>{t('1 rubber restores {amount}% condition', {amount: STATION_REPAIR_PER_RUBBER})}</small>
                    </span>
                    <button
                      className="button"
                      disabled={busy || !near || player.inventory.rubber < 1 || station.pumpDurability >= 100}
                      onClick={() => void onAction({type: 'station_repair', stationId, quantity: 1})}
                    >
                      {t('Use 1 rubber')}
                    </button>
                  </div>
                  {station.tankCapacity < STATION_UPGRADE.capacity && (
                    <div className="station-upkeep">
                      <Truck size={18} />
                      <span>
                        {t('Larger underground tank')}
                        <small>
                          {STATION_UPGRADE.wood} {t('Wood')} · {STATION_UPGRADE.rubber} {t('Rubber')} ·{' '}
                          {STATION_UPGRADE.capacity} L
                        </small>
                      </span>
                      <button
                        className="button"
                        disabled={
                          busy ||
                          !near ||
                          player.coins < STATION_UPGRADE.cost ||
                          player.inventory.wood < STATION_UPGRADE.wood ||
                          player.inventory.rubber < STATION_UPGRADE.rubber
                        }
                        onClick={() => void onAction({type: 'station_upgrade', stationId})}
                      >
                        <Money value={STATION_UPGRADE.cost} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          <div className="mayor-opinion">
            <div>
              <span className="eyebrow">{t('{name}’s opinion', {name: mayor.name})}</span>
              <Reputation score={score} />
            </div>
            <p>{t(city.competitionReason || 'Drivers compare price, queue length and distance.')}</p>
          </div>
          {station.protest > 0 && (
            <p className="shortage-note">
              <Megaphone size={18} />
              {t('Residents are protesting your fuel prices. Fair pricing can rebuild trust.')}
            </p>
          )}
          {!near && canManage && (
            <button className="quiet-button" onClick={onLocate}>
              {t('Visit your station to deliver supplies')}
              <ArrowRight size={14} />
            </button>
          )}
          {!owned && (
            <p className="fine-print">
              {t('This station belongs to another player. Its stock and prices are shown for comparison.')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
