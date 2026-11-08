import {ArrowUpRight, Construction, Fuel, Megaphone} from 'lucide-react';
import type {CityId, GameSnapshot} from '../../shared/game';
import {CITIES, CITY_IDS} from '../../shared/config/cities';
import {RESOURCES} from '../../shared/config/items';
import {useI18n} from '../lib/i18n';
import {GoodsIcon, Meter, Money, RESOURCE_LABELS} from './ui';
import {CITY_COLORS, CITY_ICONS} from './CityMap';
import {Reputation} from './StationPanel';
import {MayorDecision} from './TradeCounter';
export function CityLedger({
  state,
  onNavigate,
  onStation,
  onContracts,
}: {
  state: GameSnapshot;
  onNavigate: (city: CityId) => void;
  onStation: (id: string) => void;
  onContracts: (city: CityId) => void;
}) {
  const {t} = useI18n();
  return (
    <div className="city-ledger">
      {CITY_IDS.map(id => {
        const city = state.world.cities[id],
          Icon = CITY_ICONS[id];
        return (
          <article className="ledger-city" key={id}>
            <header>
              <Icon color={CITY_COLORS[id]} size={28} />
              <div>
                <h3>{t(CITIES[id].name)}</h3>
                <small>{t(city.state)}</small>
              </div>
              <button aria-label={t('Set destination')} onClick={() => onNavigate(id)}>
                <ArrowUpRight size={18} />
              </button>
            </header>
            <MayorDecision city={city} />
            <div className="ledger-fuel">
              <Fuel size={15} />
              {t('Fuel')}
              <strong>{Math.round(city.fuelPercent)}%</strong>
            </div>
            <Meter value={city.fuelPercent} label={t('Fuel')} />
            <p className="ledger-price-label">{t('Stock · mayor pays per unit')}</p>
            <div className="ledger-stock">
              {RESOURCES.map(r => (
                <div key={r}>
                  <GoodsIcon resource={r} size={16} />
                  <span>{t(RESOURCE_LABELS[r])}</span>
                  <strong>
                    {city.stock[r]}
                    <small>
                      {city.prices.buy[r] > 0 ? t('{price} coins / unit', {price: city.prices.buy[r]}) : '—'}
                    </small>
                  </strong>
                </div>
              ))}
            </div>
            <Reputation score={state.player.reputation[id]} />
            <div className="ledger-money">
              <span>{t('Treasury')}</span>
              <Money value={city.treasury} />
            </div>
            {city.protest > 0 && (
              <p className="shortage-note">
                <Megaphone size={16} />
                {t('Residents are protesting shortages.')}
              </p>
            )}
            {city.bounties.map(b => (
              <div key={b.id} className="ledger-bounty">
                <span>
                  {t('Wanted')}: {b.remaining} {t(RESOURCE_LABELS[b.resource])}
                </span>
                <Money value={b.unitPrice} />
                <small>{t('/ unit · payment reserved')}</small>
              </div>
            ))}
            <p className="competition-note">{t(city.competitionReason)}</p>
            <div className="ledger-businesses">
              {Object.values(state.world.stations)
                .filter(s => s.cityId === id)
                .map(s => (
                  <button key={s.id} onClick={() => onStation(s.id)}>
                    <Fuel size={15} />
                    <span>
                      {s.ownerId ? s.name : t('Station plot')}
                      <small>{t(s.ownerId ? 'Player-owned' : 'For sale')}</small>
                    </span>
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              <button onClick={() => onContracts(id)}>
                {t('Supply contracts')}
                <ArrowUpRight size={13} />
              </button>
            </div>
            {id === 'harbor' && (
              <div className="plot-list">
                {city.construction.map((p, i) => (
                  <div key={p.id}>
                    <Construction size={15} />
                    <span>
                      {t('Building {number}', {number: i + 1})}
                      <small>
                        {t(p.complete ? 'Complete' : p.stalled ? 'Waiting for supplies' : 'Under construction')}
                      </small>
                    </span>
                    <strong>{Math.floor(p.progress)}%</strong>
                    <Meter value={p.progress} label={t('Construction')} />
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
