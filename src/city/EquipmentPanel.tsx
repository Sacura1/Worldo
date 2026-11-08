import {useEffect, useState} from 'react';
import {cityRequest} from '../lib/city-api';
import {ArrowDownToLine, ArrowUpFromLine, Backpack, Check, Fuel, Hammer, Package, Truck, Wrench} from 'lucide-react';
import type {GameSnapshot, GameAction, EquipmentKind} from '../../shared/game';
import {ITEMS, RESOURCES, CARGO_UPGRADES, WAREHOUSE_UPGRADES, STORAGE_RENT} from '../../shared/config/items';
import {useI18n} from '../lib/i18n';
import {GoodsIcon, Meter, Money, RESOURCE_LABELS} from './ui';
export function EquipmentPanel({
  state,
  busy,
  onAction,
  shop = false,
}: {
  state: GameSnapshot;
  busy: boolean;
  onAction: (action: GameAction) => Promise<void>;
  shop?: boolean;
}) {
  const {t} = useI18n(),
    player = state.player;
  const [tab, setTab] = useState<'cargo' | 'tools' | 'vehicles' | 'storage'>(shop ? 'tools' : 'cargo');
  const [prices, setPrices] = useState<{
    equipment: Record<EquipmentKind, number>;
    repairs: Record<string, number>;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void cityRequest<{equipment: Record<EquipmentKind, number>; repairs: Record<string, number>}>(
      '/api/game/equipment-prices',
    )
      .then(p => {
        if (alive) setPrices(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [state.world.economyRevision]);
  const equipment = player.equipment.filter(e => ITEMS[e.kind].category === (tab === 'vehicles' ? 'vehicle' : 'tool'));
  const active = player.equipment.find(e => e.id === player.activeVehicleId),
    capacity = (active ? ITEMS[active.kind].capacity : 12) + (CARGO_UPGRADES[player.cargoLevel - 1]?.capacity ?? 0);
  return (
    <div className="equipment-panel">
      <div className="counter-tabs">
        {(
          [
            ['cargo', Backpack, 'Cargo'],
            ['tools', Wrench, 'Tools'],
            ['vehicles', Truck, 'Vehicles'],
            ['storage', Package, 'Warehouse'],
          ] as const
        ).map(([id, Icon, name]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon size={16} />
            {t(name)}
          </button>
        ))}
      </div>
      {tab === 'cargo' && (
        <>
          <div className="cargo-heading">
            <h3>{t('Your cargo')}</h3>
            <span>
              <bdi dir="ltr">
                {Object.values(player.inventory).reduce((a, b) => a + b, 0)} / {capacity}
              </bdi>
            </span>
          </div>
          <div className="cargo-grid">
            {RESOURCES.map(r => (
              <div className="cargo-item" key={r}>
                <GoodsIcon resource={r} size={30} />
                <strong>{t(RESOURCE_LABELS[r])}</strong>
                <b>{player.inventory[r]}</b>
                <small>{t('units')}</small>
              </div>
            ))}
          </div>
          <p className="fine-print">
            {t(
              'Carry goods to a city exchange to trade. Harvested cargo becomes an owned chain asset when it is sold.',
            )}
          </p>
          <div className="service-card">
            <Backpack />
            <div>
              <h3>{t('Cargo upgrade')}</h3>
              <p>{t('Harbor City fits larger cargo storage to your transport.')}</p>
            </div>
            {player.cargoLevel < CARGO_UPGRADES.length ? (
              <button
                className="button"
                disabled={busy}
                onClick={() => void onAction({type: 'upgrade', kind: 'cargo'})}
              >
                <Money value={CARGO_UPGRADES[player.cargoLevel].cost} />
              </button>
            ) : (
              <Check />
            )}
          </div>
        </>
      )}
      {(tab === 'tools' || tab === 'vehicles') && (
        <>
          <h3>{t(shop ? 'Motor City workshop' : 'Your equipment')}</h3>
          <div className="equipment-list">
            {equipment.map(e => {
              const item = ITEMS[e.kind],
                selected = e.id === player.activeVehicleId || Object.values(player.equippedTools).includes(e.id);
              return (
                <article className="equipment-card" key={e.id}>
                  <div className="equipment-emblem">
                    {item.category === 'vehicle' ? <Truck size={30} /> : <Wrench size={30} />}
                  </div>
                  <div className="equipment-info">
                    <span className="eyebrow">{t(selected ? 'Equipped' : 'Owned')}</span>
                    <h3>{t(item.name)}</h3>
                    <small>
                      {t('Condition')}{' '}
                      <bdi dir="ltr">
                        {Math.floor(e.durability)} / {Math.floor(e.maxDurability)}
                      </bdi>
                    </small>
                    <Meter
                      value={e.maxDurability ? (e.durability / e.maxDurability) * 100 : 0}
                      label={t('Condition')}
                    />
                    {item.fuelCapacity > 0 && (
                      <small>
                        <Fuel size={12} />
                        {t('Fuel')}{' '}
                        <bdi dir="ltr">
                          {Math.floor(e.fuel)} / {item.fuelCapacity}
                        </bdi>
                      </small>
                    )}
                    <small>
                      {item.category === 'vehicle'
                        ? t('Capacity: {count} units', {count: item.capacity})
                        : t('Yield: {count} per gather', {count: item.yield})}
                    </small>
                  </div>
                  <div className="equipment-actions">
                    <button
                      disabled={busy || selected}
                      className="button"
                      onClick={() => void onAction({type: 'equip', equipmentId: e.id})}
                    >
                      {selected ? <Check size={16} /> : null}
                      {t(selected ? 'Equipped' : 'Equip')}
                    </button>
                    <button
                      disabled={busy || !prices || e.durability >= e.maxDurability}
                      onClick={() => void onAction({type: 'repair', equipmentId: e.id})}
                    >
                      <Hammer size={14} />
                      {t('Repair at Motor City')}
                      {prices && <Money value={prices.repairs[e.id]} />}
                    </button>
                    {item.fuelCapacity > 0 && (
                      <button
                        disabled={busy || player.inventory.petrol < 1 || e.fuel >= item.fuelCapacity}
                        onClick={() => void onAction({type: 'refuel', equipmentId: e.id, quantity: 1})}
                      >
                        <Fuel size={14} />
                        {t('Use 1 petrol')}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <p className="fine-print">
            {t(
              'Repairing costs less than replacing, but reduces maximum condition by 10%. Worn starter tools still gather slowly.',
            )}
          </p>
          {shop && (
            <>
              <h3>{t('Built here')}</h3>
              <div className="shop-equipment">
                {(Object.keys(ITEMS) as EquipmentKind[])
                  .filter(k => ITEMS[k].category === (tab === 'vehicles' ? 'vehicle' : 'tool'))
                  .map(kind => (
                    <article key={kind}>
                      <div>
                        {tab === 'vehicles' ? <Truck /> : <Wrench />}
                        <h3>{t(ITEMS[kind].name)}</h3>
                        <small>{t('{count} in stock', {count: state.world.cities.motor.equipmentStock[kind]})}</small>
                      </div>
                      <button
                        className="button"
                        disabled={
                          busy ||
                          state.world.cities.motor.equipmentStock[kind] < 1 ||
                          !prices ||
                          player.coins < prices.equipment[kind]
                        }
                        onClick={() => void onAction({type: 'buy_equipment', kind})}
                      >
                        <Money value={prices?.equipment[kind] ?? 0} />
                      </button>
                    </article>
                  ))}
              </div>
            </>
          )}
        </>
      )}
      {tab === 'storage' && (
        <>
          <h3>{t('Harbor warehouse')}</h3>
          <p>{t('Store goods safely at Harbor City. Warehouse rent funds the city’s deliveries and construction.')}</p>
          <div className="service-card">
            <Package />
            <div>
              <strong>{t('Storage rental')}</strong>
              <small>
                {t(player.storagePaidUntil > state.world.simulatedAt ? 'Rental active' : 'Rental required')}
              </small>
            </div>
            <button className="button" disabled={busy} onClick={() => void onAction({type: 'rent_storage'})}>
              <Money value={STORAGE_RENT} />
              <small>{t('/ hour')}</small>
            </button>
          </div>
          {RESOURCES.map(resource => (
            <div className="warehouse-row" key={resource}>
              <GoodsIcon resource={resource} />
              <span>
                {t(RESOURCE_LABELS[resource])}
                <small>
                  {t('Stored')}: {player.warehouse[resource]} · {t('Cargo')}: {player.inventory[resource]}
                </small>
              </span>
              <button
                aria-label={t('Store one unit')}
                disabled={busy || player.inventory[resource] < 1}
                onClick={() => void onAction({type: 'storage', direction: 'deposit', resource, quantity: 1})}
              >
                <ArrowDownToLine size={18} />
              </button>
              <button
                aria-label={t('Take one unit')}
                disabled={busy || player.warehouse[resource] < 1}
                onClick={() => void onAction({type: 'storage', direction: 'withdraw', resource, quantity: 1})}
              >
                <ArrowUpFromLine size={18} />
              </button>
            </div>
          ))}
          {player.warehouseLevel < WAREHOUSE_UPGRADES.length && (
            <button
              className="button"
              disabled={busy}
              onClick={() => void onAction({type: 'upgrade', kind: 'warehouse'})}
            >
              {t('Expand warehouse')}
              <Money value={WAREHOUSE_UPGRADES[player.warehouseLevel].cost} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
