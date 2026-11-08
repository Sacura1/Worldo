import * as THREE from 'three';
import type {GameSnapshot, StationState, CityId, Position} from '../../shared/game';
import type {Collider} from '../../shared/world-layout';
import {STATION_PLOTS} from '../../shared/city-layout';
import {Builder, createCharacter, createCitizen} from './assets';
import {createTrafficGeometry} from './vehicles';
import {createWorldSign} from './world-sign';
import {advanceTraffic, createMovingDriver, syncMovingDriver, type MovingDriver} from './driver-motion';
export function createStationWorld() {
  const group = new THREE.Group(),
    plots = new Map<
      string,
      {
        root: THREE.Group;
        foundation: THREE.Group;
        scaffold: THREE.Group;
        posts: THREE.Group;
        canopy: THREE.Group;
        pumps: THREE.Group;
        lamps: THREE.Mesh;
        gauge: THREE.Mesh;
        sign: ReturnType<typeof createWorldSign>;
        fuelSign: ReturnType<typeof createWorldSign>;
        crowd: ReturnType<typeof createCharacter>[];
      }
    >(),
    drivers = new Map<string, MovingDriver>();
  let snapshot: GameSnapshot | undefined;
  let translate = (message: string) => message;
  let low = false;
  let dynamicColliders: Collider[] = [];
  let movingCars: Record<CityId, number> = {refinery: 0, motor: 0, harbor: 0};
  const labels: Builder[] = [];
  for (const plot of STATION_PLOTS) {
    const root = new THREE.Group(),
      b = new Builder(),
      f = new Builder(),
      sc = new Builder(),
      p = new Builder(),
      roof = new Builder(),
      pumps = new Builder();
    const {x, z} = plot.position;
    b.box('dirt', x, -0.005, z, plot.w, 0.03, plot.d);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) b.box('cream', x + sx * (plot.w / 2), 0.4, z + sz * (plot.d / 2), 0.12, 0.8, 0.12);
    b.box('darkWood', x + 6, 1.6, z + 5, 0.15, 3.2, 0.15);
    f.box('concrete', x, 0.045, z, plot.w, 0.09, plot.d);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        sc.box('steel', x + sx * 6.6, 2.4, z + sz * 4.2, 0.08, 4.8, 0.08);
        sc.beam(
          'steel',
          new THREE.Vector3(x + sx * 6.6, 0.4, z + sz * 4.2),
          new THREE.Vector3(x - sx * 6.6, 4.5, z + sz * 4.2),
          0.055,
        );
        p.box('steel', x + sx * 5.7, 2, z + sz * 2.9, 0.22, 4, 0.22);
      }
    sc.box('wood', x, 3.9, z - 4.2, 13.4, 0.07, 0.7);
    roof.box(plot.cityId === 'motor' ? 'shirtBlue' : 'rust', x, 4.1, z, 13.4, 0.35, 8);
    roof.box('white', x, 3.88, z, 13, 0.08, 7.6);
    roof.label('INDEPENDENT FUEL', x, 4.1, z + 4.18, 7, 0.3);
    labels.push(roof);
    for (const side of [-1, 1]) {
      pumps.box('cream', x + side * 2.3, 0.85, z + 2, 1.15, 1.7, 0.75);
      pumps.box('darkSteel', x + side * 2.3, 1.45, z + 2.39, 0.77, 0.42, 0.025);
      pumps.box('shirtBlue', x + side * 2.3, 0.75, z + 2.39, 1, 0.32, 0.025);
      const h = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.028, 5, 16),
        new THREE.MeshStandardMaterial({color: '#20252b', roughness: 0.9}),
      );
      h.rotation.y = Math.PI / 2;
      h.position.set(x + side * 2.3 + 0.6, 0.92, z + 2);
      pumps.root.add(h);
    }
    const foundation = f.batch(),
      scaffold = sc.batch(),
      posts = p.batch(),
      canopy = roof.batch(),
      pumpGroup = pumps.batch();
    const lamps = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.06, 5),
      new THREE.MeshStandardMaterial({color: '#e7e2ce', emissive: '#ffe3b2', emissiveIntensity: 0}),
    );
    lamps.position.set(x, 3.82, z);
    const gauge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 1.8, 10),
      new THREE.MeshStandardMaterial({color: '#e6ae50', emissive: '#e6ae50', emissiveIntensity: 0.15}),
    );
    gauge.position.set(x + 6, 1.3, z + 4);
    const sign = createWorldSign();
    sign.mesh.position.set(x + 6, 3.1, z + 5.1);
    const fuelSign = createWorldSign();
    fuelSign.mesh.scale.set(0.9, 0.64, 1);
    fuelSign.mesh.position.set(x + 6, 1.32, z + 5.12);
    root.add(fuelSign.mesh);
    const crowd = [];
    for (let i = 0; i < 5; i++) {
      const actor = createCitizen({
        shirt: i % 2 ? 'ochre' : 'shirtBlue',
        skin: i % 2 ? 'skin' : 'skinDark',
        hat: false,
        backpack: false,
        articulated: true,
      });
      const placard = new Builder();
      placard.box('wood', 0.3, 1.8, -0.48, 0.045, 1.1, 0.045);
      placard.label('FAIR FUEL PRICES', 0.3, 2.35, -0.455, 1.35, 0.6, 0, '#f1e5c8', '#343b42');
      placard.label('FAIR FUEL PRICES', 0.3, 2.35, -0.505, 1.35, 0.6, Math.PI, '#f1e5c8', '#343b42');
      labels.push(placard);
      actor.root.add(placard.batch());
      actor.root.position.set(x - 6 + (i % 3) * 1.5, 0, z - 4 + Math.floor(i / 3) * 1.7);
      actor.root.rotation.y = Math.PI;
      root.add(actor.root);
      actor.root.visible = false;
      crowd.push(actor);
    }
    root.add(b.batch(), foundation, scaffold, posts, canopy, pumpGroup, lamps, gauge, sign.mesh);
    group.add(root);
    plots.set(plot.id, {
      root,
      foundation,
      scaffold,
      posts,
      canopy,
      pumps: pumpGroup,
      lamps,
      gauge,
      sign,
      fuelSign,
      crowd,
    });
  }
  const car = createTrafficGeometry(),
    traffic = new THREE.InstancedMesh(car.geometry, car.material, 32);
  traffic.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  traffic.frustumCulled = false;
  traffic.castShadow = true;
  group.add(traffic);
  const transform = new THREE.Object3D();
  function updateStation(id: string, s: StationState | undefined) {
    const v = plots.get(id)!;
    const progress = s?.progress ?? 0,
      owned = !!s?.ownerId,
      complete = progress >= 100;
    v.foundation.visible = owned;
    v.scaffold.visible = owned && progress > 0 && !complete;
    v.posts.visible = progress > 15;
    v.posts.scale.y = THREE.MathUtils.clamp(progress / 45, 0.1, 1);
    v.canopy.visible = progress >= 55;
    v.pumps.visible = progress >= 85;
    v.lamps.visible = complete;
    v.gauge.visible = complete;
    v.gauge.scale.y = Math.max(0.015, (s?.tank ?? 0) / (s?.tankCapacity ?? 500));
    v.gauge.position.y = 0.4 + 0.9 * v.gauge.scale.y;
    const value = !owned
      ? translate('FOR SALE')
      : !complete
        ? Math.round(progress) + '%'
        : (s?.tank ?? 0) <= 0
          ? translate('NO FUEL')
          : String(s?.effectivePrice ?? s?.price ?? 0);
    v.sign.draw(
      owned ? s!.name : translate('STATION PLOT'),
      value,
      !owned
        ? translate('Build your own station')
        : !complete
          ? translate('Deliver wood to build')
          : translate('coins / litre') + ' · ' + s!.ownerId,
    );
    v.fuelSign.mesh.visible = complete;
    v.fuelSign.draw(
      translate('Tank level'),
      String(s?.tank ?? 0) + ' / ' + String(s?.tankCapacity ?? 500),
      translate('Cars waiting') + ': ' + String(s?.queueLength ?? 0),
    );
  }
  function setState(next: GameSnapshot) {
    snapshot = next;
    for (const plot of STATION_PLOTS) updateStation(plot.id, next.world.stations?.[plot.id]);
    const liveIds = new Set<string>();
    for (const city of Object.values(next.world.cities))
      for (const state of city.drivers ?? []) {
        liveIds.add(state.id);
        let driver = drivers.get(state.id);
        if (!driver) {
          driver = createMovingDriver(state);
          drivers.set(state.id, driver);
        } else syncMovingDriver(driver, state);
      }
    for (const [id] of drivers) if (!liveIds.has(id)) drivers.delete(id);
  }
  return {
    group,
    setState,
    setTranslator(t: (message: string) => string) {
      translate = t;
      labels.forEach(b => b.setTranslator(t));
      for (const plot of STATION_PLOTS) {
        const view = plots.get(plot.id)!;
        view.sign.invalidate();
        view.fuelSign.invalidate();
        updateStation(plot.id, snapshot?.world.stations?.[plot.id]);
      }
    },
    setQuality(q: 'low' | 'high' | 'auto') {
      low = q === 'low';
    },
    getColliders: () => dynamicColliders,
    getMovingCars: () => movingCars,
    tick(dt: number, time: number, player: Position, night: number) {
      dynamicColliders = [];
      const list = [...drivers.values()].sort((a, b) => a.id.localeCompare(b.id));
      movingCars = advanceTraffic(list, dt, player);
      let visible = 0;
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        const close = Math.hypot(player.x - d.position.x, player.z - d.position.z) < (low ? 105 : 180);
        if (close && visible < 32) {
          transform.position.copy(d.position);
          transform.rotation.set(0, d.heading, 0);
          transform.scale.setScalar(1);
          transform.updateMatrix();
          traffic.setMatrixAt(visible, transform.matrix);
          traffic.setColorAt(visible, new THREE.Color(['#c6b597', '#9cb9cc', '#b37965', '#c0c4b6'][i % 4]));
          visible++;
          dynamicColliders.push({
            x: d.position.x,
            z: d.position.z,
            w: 1.8,
            d: 3.3,
            height: 1.6,
            rotation: d.heading,
            kind: 'prop',
          });
        }
      }
      traffic.count = visible;
      traffic.instanceMatrix.needsUpdate = true;
      if (traffic.instanceColor) traffic.instanceColor.needsUpdate = true;
      for (const plot of STATION_PLOTS) {
        const v = plots.get(plot.id)!,
          s = snapshot?.world.stations[plot.id];
        (v.lamps.material as THREE.MeshStandardMaterial).emissiveIntensity =
          s && s.progress >= 100 ? night * 2.8 + 0.15 : 0;
        const close = Math.hypot(player.x - plot.position.x, player.z - plot.position.z) < 85;
        v.crowd.forEach((actor, i) => {
          actor.root.visible = close && i < Math.ceil((s?.protest ?? 0) * 5);
          if (!actor.root.visible) return;
          actor.head.rotation.y = Math.sin(time * 0.6 + i) * 0.14;
          actor.limbs[3].rotation.x = 1.2 + Math.sin(time * 0.9 + i) * 0.1;
          actor.limbs[1].rotation.x = Math.sin(time * 0.7 + i) * 0.07;
          actor.root.position.y = Math.sin(time + i) * 0.005;
        });
      }
    },
  };
}
