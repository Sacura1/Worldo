import {Anchor, Factory, Flame, MapPin, Megaphone} from 'lucide-react';
import type {CityId, GameSnapshot} from '../../shared/game';
import {CITY_CENTERS, CITY_ROADS, RESOURCE_ZONES} from '../../shared/city-layout';
import {CITIES, CITY_IDS} from '../../shared/config/cities';
import {useI18n} from '../lib/i18n';
import {RESOURCES} from '../../shared/config/items';
import {Meter, RESOURCE_LABELS} from './ui';
export const CITY_COLORS: Record<CityId, string> = {refinery: '#f3a856', motor: '#6da8ed', harbor: '#64c6ba'};
export const CITY_ICONS = {refinery: Flame, motor: Factory, harbor: Anchor};
export function CityMap({
  state,
  compact = false,
  onSelect,
  onStation,
  onContracts,
}: {
  state: GameSnapshot;
  compact?: boolean;
  onSelect: (id: CityId) => void;
  onStation?: (id: string) => void;
  onContracts?: (id: CityId) => void;
}) {
  const {t, formatNumber} = useI18n(),
    p = state.player.position;
  const activeBounties = (id: CityId) =>
    state.world.cities[id].bounties.filter(b => b.remaining > 0 && b.expiresAt > state.world.simulatedAt);
  return (
    <div className={`city-map ${compact ? 'compact' : ''}`}>
      <svg viewBox="-190 -190 380 380" aria-label={t('World map')} role="img">
        <defs>
          <pattern id={compact ? 'grid-mini' : 'grid-full'} width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="currentColor" opacity=".08" />
          </pattern>
        </defs>
        <rect x="-190" y="-190" width="380" height="380" fill={`url(#${compact ? 'grid-mini' : 'grid-full'})`} />
        <path d="M-190 156Q-40 164 30 152T190 162V190H-190Z" fill="#237885" opacity=".5" />
        {CITY_ROADS.map(([x, z, bx, bz, w], i) => (
          <path key={i} d={`M${x} ${z}L${bx} ${bz}`} stroke="#a8ab99" strokeWidth={w * 0.7} opacity=".6" />
        ))}
        {RESOURCE_ZONES.map(zone => (
          <g key={zone.id}>
            <circle
              cx={zone.position.x}
              cy={zone.position.z}
              r="11"
              fill={zone.resource === 'crude_oil' ? '#c38d50' : zone.resource === 'rubber' ? '#669c7b' : '#b7b787'}
              opacity=".65"
            />
            {!compact && (
              <text x={zone.position.x} y={zone.position.z - 17} textAnchor="middle">
                {t(zone.name)}
              </text>
            )}
          </g>
        ))}
        {CITY_IDS.map(id => (
          <g
            key={id}
            className="map-city"
            role="button"
            tabIndex={0}
            aria-label={t(CITIES[id].name)}
            onClick={() => onSelect(id)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(id);
              }
            }}
          >
            <rect
              x={CITY_CENTERS[id].x - 26}
              y={CITY_CENTERS[id].z - 27}
              width="52"
              height="51"
              rx="9"
              fill={CITY_COLORS[id]}
              opacity=".24"
            />
            <circle cx={CITY_CENTERS[id].x} cy={CITY_CENTERS[id].z} r="6" fill={CITY_COLORS[id]} />
            {!compact && activeBounties(id).length > 0 && (
              <g aria-label={t('Emergency delivery')}>
                <circle cx={CITY_CENTERS[id].x + 20} cy={CITY_CENTERS[id].z - 20} r="8" fill="#e7ad68" />
                <text x={CITY_CENTERS[id].x + 20} y={CITY_CENTERS[id].z - 16.5} textAnchor="middle">
                  !
                </text>
                <title>{t('Emergency delivery')}</title>
              </g>
            )}
            {!compact && (
              <text x={CITY_CENTERS[id].x} y={CITY_CENTERS[id].z + 40} textAnchor="middle">
                {t(CITIES[id].name)}
              </text>
            )}
          </g>
        ))}
        {Object.values(state.world.stations).map(station => (
          <g
            key={station.id}
            className="map-city"
            role="button"
            tabIndex={compact ? -1 : 0}
            aria-label={t(station.ownerId ? station.name : 'Station plot')}
            onClick={() => (onStation ? onStation(station.id) : onSelect(station.cityId))}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (onStation) onStation(station.id);
                else onSelect(station.cityId);
              }
            }}
          >
            <rect
              x={station.position.x - 4}
              y={station.position.z - 4}
              width="8"
              height="8"
              fill={station.ownerId ? '#e3bd71' : '#c4d0d0'}
              stroke="#14242f"
              strokeWidth="1.2"
            />
            <title>{t(station.ownerId ? station.name : 'Station plot')}</title>
          </g>
        ))}
        <circle cx={p.x} cy={p.z} r="10" fill="#fff1ba" opacity=".2" />
        <path
          transform={`translate(${p.x} ${p.z}) rotate(${(-state.player.heading * 180) / Math.PI})`}
          d="M0-7L5 6L0 3L-5 6Z"
          fill="#fff1ba"
          stroke="#17222d"
          strokeWidth="1.3"
        />
      </svg>
      {!compact && (
        <div className="map-legend">
          {CITY_IDS.map(id => {
            const Icon = CITY_ICONS[id],
              city = state.world.cities[id],
              wanted = RESOURCES.filter(resource => city.prices.buy[resource] > 0),
              bounties = activeBounties(id);
            return (
              <button key={id} className="city-map-card" onClick={() => onSelect(id)}>
                <Icon color={CITY_COLORS[id]} />
                <span>
                  <strong>{t(CITIES[id].name)}</strong>
                  <small>
                    {t(city.state)} · {t('Fuel')} {formatNumber(Math.round(city.fuelPercent))}%
                  </small>
                  <Meter value={city.fuelPercent} label={t('Fuel')} />
                  <small>
                    {t('Buy supplies')} · {t('Petrol')}:{' '}
                    {t('{price} coins / unit', {price: formatNumber(city.prices.sell.petrol)})}
                  </small>
                  {wanted.length > 0 && (
                    <small>
                      {t('Sell cargo')} ·{' '}
                      {wanted
                        .map(resource => t(RESOURCE_LABELS[resource]) + ': ' + formatNumber(city.prices.buy[resource]))
                        .join(' · ')}{' '}
                      {t('coins / unit')}
                    </small>
                  )}
                  {bounties.map(bounty => (
                    <span className="shortage-note" key={bounty.id}>
                      <Megaphone size={16} aria-hidden="true" />
                      <span>
                        {t('Emergency delivery')} · {formatNumber(bounty.remaining)}{' '}
                        {t(RESOURCE_LABELS[bounty.resource])}
                        <small>
                          {t('{price} coins / unit', {price: formatNumber(bounty.unitPrice)})} ·{' '}
                          {t('Next deadline in {minutes} minutes', {
                            minutes: formatNumber(
                              Math.max(1, Math.ceil((bounty.expiresAt - state.world.simulatedAt) / 60000)),
                            ),
                          })}
                        </small>
                      </span>
                    </span>
                  ))}
                </span>
                <MapPin size={16} />
              </button>
            );
          })}
        </div>
      )}
      {!compact && (
        <div className="map-businesses">
          <h3>{t('Station plots & businesses')}</h3>
          <div>
            {Object.values(state.world.stations).map(station => (
              <button key={station.id} onClick={() => (onStation ? onStation(station.id) : onSelect(station.cityId))}>
                <MapPin size={15} />
                <span>
                  <strong>{station.ownerId ? station.name : t('Station plot')}</strong>
                  <small>
                    {t(CITIES[station.cityId].name)} ·{' '}
                    {t(station.ownerId ? (station.progress >= 100 ? 'Open' : 'Under construction') : 'For sale')}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <h3>{t('Supply contract boards')}</h3>
          <div>
            {CITY_IDS.map(id => (
              <button key={id} onClick={() => onContracts?.(id)}>
                {t(CITIES[id].name)}
                <strong>
                  {state.world.supplyContracts.filter(c => c.cityId === id && c.status === 'open').length}
                </strong>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
