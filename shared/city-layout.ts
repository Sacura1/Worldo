import type {Collider} from './world-layout';
import type {CameraCollider} from './world-physics';
export type LayoutCityId = 'refinery' | 'motor' | 'harbor';
export type LayoutResource = 'crude_oil' | 'rubber' | 'wood';
export interface WorldPoint {
  x: number;
  z: number;
}
export const CITY_CENTERS: Record<LayoutCityId, WorldPoint> = {
  refinery: {x: -100, z: -70},
  motor: {x: 100, z: -70},
  harbor: {x: 0, z: 100},
};
export const CITY_NAMES: Record<LayoutCityId, string> = {
  refinery: 'Refinery City',
  motor: 'Motor City',
  harbor: 'Harbor City',
};
export const CITY_IDS = Object.keys(CITY_CENTERS) as LayoutCityId[];
export const CITY_WORLD_LIMIT = 185;
export const CITY_START_POSITION = {x: -100, z: -53};
export interface CityBuilding extends WorldPoint {
  id: string;
  cityId: LayoutCityId;
  w: number;
  d: number;
  height: number;
  kind: 'trade' | 'hall' | 'house' | 'workshop';
  color: string;
  roof: string;
  label: string;
  front: 1 | -1;
  enterable: boolean;
}
export const CITY_BUILDINGS: CityBuilding[] = CITY_IDS.flatMap(cityId => {
  const c = CITY_CENTERS[cityId],
    palettes =
      cityId === 'refinery'
        ? ['ochre', 'brick', 'cream']
        : cityId === 'motor'
          ? ['sage', 'white', 'shirtBlue']
          : ['cream', 'shirtRed', 'ochre'];
  return [
    {
      id: cityId + '-trade',
      cityId,
      x: c.x,
      z: c.z - 8,
      w: 12,
      d: 10,
      height: 4.3,
      kind: 'trade' as const,
      color: palettes[0],
      roof: 'darkRoof',
      label: cityId === 'refinery' ? 'Refinery Exchange' : cityId === 'motor' ? 'Motor Works' : 'Harbor Exchange',
      front: 1 as const,
      enterable: true,
    },
    {
      id: cityId + '-hall',
      cityId,
      x: c.x - 20,
      z: c.z - 5,
      w: 10,
      d: 12,
      height: 5.5,
      kind: 'hall' as const,
      color: 'cream',
      roof: 'darkRoof',
      label: 'City Hall',
      front: 1 as const,
      enterable: false,
    },
    ...[-1, 1].flatMap((row, r) =>
      [-26, -13, 1, 15, 28].map((offset, n) => ({
        id: cityId + '-home-' + r + '-' + n,
        cityId,
        x: c.x + offset,
        z: c.z + row * 29,
        w: 7 + (n % 2),
        d: 8,
        height: 3.7 + (n % 3) * 0.45,
        kind: 'house' as const,
        color: palettes[(n + r) % 3],
        roof: n % 2 ? 'roof' : 'rust',
        label: '',
        front: (row === -1 ? 1 : -1) as 1 | -1,
        enterable: false,
      })),
    ),
  ];
});
export interface CityDoor {
  id: string;
  cityId: LayoutCityId;
  buildingId: string;
  position: WorldPoint;
  hinge: WorldPoint;
  width: number;
  front: 1 | -1;
  label: string;
}
export const CITY_DOORS: CityDoor[] = CITY_BUILDINGS.filter(b => b.enterable).map(b => ({
  id: b.cityId + '-door',
  cityId: b.cityId,
  buildingId: b.id,
  position: {x: b.x, z: b.z + b.d / 2},
  hinge: {x: b.x - 1.15, z: b.z + b.d / 2},
  width: 2.3,
  front: 1,
  label: b.label,
}));
export const CITY_TRADE_POINTS = Object.fromEntries(
  CITY_IDS.map(id => [id, {x: CITY_CENTERS[id].x, z: CITY_CENTERS[id].z - 8}]),
) as Record<LayoutCityId, WorldPoint>;
export const CITY_NPCS = CITY_IDS.map((cityId, i) => ({
  id: cityId + '-mayor',
  cityId,
  name: ['Hale', 'Rosa', 'Imani'][i],
  position: {x: CITY_CENTERS[cityId].x, z: CITY_CENTERS[cityId].z - 10.6},
}));
export const CITY_PUMPS = CITY_IDS.map(cityId => ({
  id: cityId + '-pump',
  cityId,
  position: {x: CITY_CENTERS[cityId].x + 20, z: CITY_CENTERS[cityId].z + 6},
}));
export const RESOURCE_ZONES: {
  id: string;
  resource: LayoutResource;
  name: string;
  position: WorldPoint;
  radius: number;
}[] = [
  {id: 'oil-field', resource: 'crude_oil', name: 'Oil Field', position: {x: -7, z: -115}, radius: 13},
  {id: 'rubber-jungle', resource: 'rubber', name: 'Rubber Jungle', position: {x: 96, z: 26}, radius: 14},
  {id: 'forest', resource: 'wood', name: 'Forest', position: {x: -91, z: 28}, radius: 14},
];
export const RESOURCE_NODES = RESOURCE_ZONES.flatMap(zone =>
  Array.from({length: 6}, (_, i) => ({
    id: zone.id + '-' + i,
    resource: zone.resource,
    position: {
      x: zone.position.x + Math.sin((i * Math.PI) / 3) * 7,
      z: zone.position.z + Math.cos((i * Math.PI) / 3) * 7,
    },
  })),
);
export const CONSTRUCTION_PLOTS = [
  {x: 19, z: 142},
  {x: 32, z: 142},
  {x: -20, z: 142},
  {x: -33, z: 142},
];
export interface StationPlot {
  id: string;
  cityId: LayoutCityId;
  position: WorldPoint;
  pump: WorldPoint;
  roadEntry: WorldPoint;
  w: number;
  d: number;
}
export const STATION_PLOTS: StationPlot[] = CITY_IDS.flatMap(cityId =>
  [-1, 1].map((side, i) => {
    const c = CITY_CENTERS[cityId],
      position = {x: c.x + side * 50, z: c.z + 3};
    return {
      id: 'station:' + cityId + ':' + (i + 1),
      cityId,
      position,
      pump: {x: position.x, z: position.z + 2},
      roadEntry: {x: position.x, z: c.z + 12},
      w: 17,
      d: 12,
    };
  }),
);
export const CITY_ROADS: readonly (readonly [number, number, number, number, number])[] = [
  [-100, -58, 100, -58, 7],
  [-136, -58, -136, 0, 7],
  [-136, 0, -60, 112, 7],
  [-60, 112, 0, 112, 7],
  [136, -58, 136, 0, 7],
  [136, 0, 60, 112, 7],
  [60, 112, 0, 112, 7],
  [-7, -58, -7, -115, 5],
  [-117, 28, -91, 28, 4],
  [118, 26, 96, 26, 4],
  ...CITY_IDS.flatMap(id => {
    const {x, z} = CITY_CENTERS[id];
    return [
      [x - 61, z + 12, x + 61, z + 12, 7],
      [x - 36, z - 18, x + 36, z - 18, 6],
      [x - 36, z - 18, x - 36, z + 12, 6],
      [x + 36, z - 18, x + 36, z + 12, 6],
    ] as [number, number, number, number, number][];
  }),
];
/** Ground arrows lead the first delivery from the Oil Field into Refinery City by road: up
 * the field road, west along the main road through the gap in the town fence, then across
 * the square to the Exchange door, clear of the fuel queue at the pump. */
export const OIL_FIELD_TO_EXCHANGE_ROUTE: readonly WorldPoint[] = [
  {x: -7, z: -104.5},
  {x: -7, z: -59.5},
  {x: -62, z: -59.5},
  {x: -70, z: -69.6},
  {x: -100, z: -69.6},
];
/** The name board over each resource road hangs above the follow camera, so the camera
 * passes beneath it instead of through it. */
export const RESOURCE_SIGN_HEIGHT = 4.35;
export const WORLD_TREES = Array.from({length: 150}, (_, i) => {
  const a = i * 2.399963,
    r = 42 + ((i * 67) % 115);
  return {x: Math.sin(a) * r, z: Math.cos(a) * r, scale: 0.75 + (i % 4) * 0.18};
}).filter(
  p =>
    CITY_IDS.every(id => Math.hypot(p.x - CITY_CENTERS[id].x, p.z - CITY_CENTERS[id].z) > 48) &&
    STATION_PLOTS.every(
      plot => Math.abs(p.x - plot.position.x) > plot.w / 2 + 3 || Math.abs(p.z - plot.position.z) > plot.d / 2 + 3,
    ) &&
    RESOURCE_ZONES.every(z => Math.hypot(p.x - z.position.x, p.z - z.position.z) > 17) &&
    p.z < 151 &&
    CITY_ROADS.every(([ax, az, bx, bz, width]) => {
      const dx = bx - ax,
        dz = bz - az,
        t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(p.x - ax - dx * t, p.z - az - dz * t) > width / 2 + 2;
    }),
);
export function cityInterior(p: WorldPoint) {
  const b = CITY_BUILDINGS.find(
    b => b.enterable && Math.abs(p.x - b.x) < b.w / 2 - 0.15 && Math.abs(p.z - b.z) < b.d / 2 - 0.15,
  );
  return b ? {...b, ceiling: b.height - 0.14} : null;
}
export function cityDoorCollider(door: CityDoor, open: boolean): Collider {
  const angle = open ? -Math.PI / 2 : 0;
  return {
    x: door.hinge.x + (Math.cos(angle) * door.width) / 2,
    z: door.hinge.z - (Math.sin(angle) * door.width) / 2,
    w: door.width,
    d: 0.14,
    height: 2.65,
    rotation: angle,
    kind: 'door',
    id: door.id,
  };
}
const staticColliders: Collider[] = [];
for (const b of CITY_BUILDINGS) {
  if (!b.enterable) {
    staticColliders.push({x: b.x, z: b.z, w: b.w, d: b.d, height: b.height + 2, kind: 'wall', id: b.id});
    continue;
  }
  const side = (b.w - 2.3) / 2;
  staticColliders.push(
    {x: b.x - b.w / 2, z: b.z, w: 0.24, d: b.d, height: b.height, kind: 'wall'},
    {x: b.x + b.w / 2, z: b.z, w: 0.24, d: b.d, height: b.height, kind: 'wall'},
    {x: b.x, z: b.z - b.d / 2, w: b.w, d: 0.24, height: b.height, kind: 'wall'},
    ...[-1, 1].map(s => ({
      x: b.x + s * (1.15 + side / 2),
      z: b.z + b.d / 2,
      w: side,
      d: 0.24,
      height: b.height,
      kind: 'wall' as const,
    })),
    {x: b.x, z: b.z - 1.6, w: 6, d: 0.7, height: 1.06, kind: 'prop'},
  );
}
for (const id of CITY_IDS) {
  const c = CITY_CENTERS[id];
  staticColliders.push(
    {x: c.x + 20, z: c.z + 6, w: 1.3, d: 0.8, height: 1.9, kind: 'prop'},
    ...[-1, 1].map(s => ({x: c.x + 20 + s * 5, z: c.z + 4, w: 0.3, d: 0.3, height: 4, kind: 'prop' as const})),
  );
}
for (const t of WORLD_TREES)
  staticColliders.push({x: t.x, z: t.z, w: 0.55 * t.scale, d: 0.55 * t.scale, height: 7 * t.scale, kind: 'prop'});
for (const node of RESOURCE_NODES)
  staticColliders.push({
    x: node.position.x,
    z: node.position.z,
    w: node.resource === 'crude_oil' ? 1.6 : 0.7,
    d: node.resource === 'crude_oil' ? 1.6 : 0.7,
    height: node.resource === 'crude_oil' ? 2.7 : 7,
    kind: 'prop',
    id: node.id,
  });
for (const npc of CITY_NPCS)
  staticColliders.push({...npc.position, w: 0.6, d: 0.6, height: 1.9, kind: 'npc', id: npc.id});
for (const side of [-1, 1])
  for (const [offset, length] of [
    [-27, 10],
    [-4, 22],
    [25, 14],
  ])
    staticColliders.push({
      x: CITY_CENTERS.refinery.x + side * 41.5,
      z: CITY_CENTERS.refinery.z + offset,
      w: 1,
      d: length,
      height: 1.1,
      kind: 'prop',
    });
for (const offset of [-9, 0, 9])
  staticColliders.push({
    x: CITY_CENTERS.refinery.x + offset,
    z: CITY_CENTERS.refinery.z - 45,
    w: 6,
    d: 6,
    height: 7,
    kind: 'prop',
  });
for (let i = 0; i < 3; i++)
  staticColliders.push({
    x: CITY_CENTERS.refinery.x - 20 + i * 5,
    z: CITY_CENTERS.refinery.z - 43,
    w: 2.4,
    d: 2.4,
    height: 14,
    kind: 'prop',
  });
staticColliders.push(
  {x: CITY_CENTERS.motor.x, z: CITY_CENTERS.motor.z - 44, w: 26, d: 11, height: 8.4, kind: 'wall'},
  {x: CITY_CENTERS.motor.x, z: CITY_CENTERS.motor.z - 37, w: 24, d: 3, height: 2.3, kind: 'prop'},
  {x: -58, z: 150, w: 4.5, d: 4.5, height: 22, kind: 'prop'},
  {x: 41, z: 147, w: 1, d: 1, height: 18, kind: 'prop'},
);
for (const p of CONSTRUCTION_PLOTS) staticColliders.push({...p, w: 10, d: 9, height: 12, kind: 'wall'});
// Water is a visible, impassable boundary. Boats and scenery are beyond it.
staticColliders.push({x: 0, z: 169, w: 370, d: 32, height: 0.4, kind: 'prop'});
export const CITY_STATIC_COLLIDERS: readonly Collider[] = staticColliders;
export function getStationColliders(stations: Record<string, {progress: number}> = {}): Collider[] {
  return STATION_PLOTS.flatMap(plot => {
    const progress = stations[plot.id]?.progress ?? 0,
      colliders: Collider[] = [];
    if (progress > 15)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          colliders.push({
            x: plot.position.x + sx * 5.7,
            z: plot.position.z + sz * 2.9,
            w: 0.25,
            d: 0.25,
            height: 4,
            kind: 'prop',
          });
    if (progress >= 85)
      for (const side of [-1, 1])
        colliders.push({
          x: plot.position.x + side * 2.3,
          z: plot.position.z + 2,
          w: 1.15,
          d: 0.75,
          height: 1.7,
          kind: 'prop',
        });
    return colliders;
  });
}
export function getCityColliders(
  doors: Record<string, boolean> = {},
  stations: Record<string, {progress: number}> = {},
) {
  return [
    ...CITY_STATIC_COLLIDERS,
    ...CITY_DOORS.map(d => cityDoorCollider(d, !!doors[d.id])),
    ...getStationColliders(stations),
  ];
}
export function getCityCameraColliders(
  doors: Record<string, boolean> = {},
  stations: Record<string, {progress: number}> = {},
): CameraCollider[] {
  return [
    ...getCityColliders(doors, stations),
    ...CITY_PUMPS.map(p => ({x: p.position.x, z: p.position.z - 1, w: 12, d: 8, bottom: 3.76, height: 4.2})),
    ...RESOURCE_ZONES.map(zone => ({
      x: zone.position.x,
      z: zone.position.z + zone.radius + 1,
      w: 5,
      d: 0.2,
      bottom: RESOURCE_SIGN_HEIGHT - 0.5,
      height: RESOURCE_SIGN_HEIGHT + 0.5,
    })),
    ...STATION_PLOTS.filter(p => (stations[p.id]?.progress ?? 0) >= 55).map(p => ({
      x: p.position.x,
      z: p.position.z,
      w: 13.4,
      d: 8,
      bottom: 3.8,
      height: 4.3,
    })),
    ...CITY_BUILDINGS.filter(b => b.enterable).flatMap(b => [
      {x: b.x, z: b.z, w: b.w + 0.5, d: b.d + 0.5, bottom: b.height - 0.14, height: b.height + 2},
      {x: b.x, z: b.z + b.d / 2, w: 2.3, d: 0.25, bottom: 2.65, height: b.height},
    ]),
  ];
}
