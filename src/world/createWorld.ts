import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import type {GameSnapshot, CityId, EquipmentInstance, Position} from '../../shared/game';
import {ITEMS, WALK_SPEED} from '../../shared/config/items';
import {
  CITY_IDS,
  CITY_CENTERS,
  CITY_START_POSITION,
  CITY_DOORS,
  CITY_NPCS,
  CITY_PUMPS,
  STATION_PLOTS,
  RESOURCE_NODES,
  cityInterior,
  getCityColliders,
} from '../../shared/city-layout';
import {Builder, createCharacter, disposeAssets} from './assets';
import {createCityEnvironment} from './city-environment';
import {createVehicle, type VehicleKind} from './vehicles';
import {
  clipCameraToWorld,
  clearLineOfSight,
  parkedVehicleCollider,
  resolveWorldMotion,
  turnBody,
  walkingDirection,
  walkingPace,
  walkingReferenceYaw,
} from '../../shared/world-physics';
import type {WorldHandle, WorldInput, WorldOptions, WorldInteraction} from './types';
import {cityAmbienceAt} from '../lib/game-audio';
import {RenderSurface, lowerPixelRatio} from './render-surface';
import {boundPredictionStep} from './movement-prediction';
import {createGoalBeacon, createWeather} from './weather';
import {createRouteGuide} from './route-guide';
/** Held A and D turn a walker at about 130 degrees a second. */
const WALK_TURN_RATE = 2.3;
/** Below this the player is not holding the touch stick. */
const STICK_DEAD_ZONE = 0.08;

/** Real-time rendering only. The server owns inventory, prices, time and resource awards. */
export function createWorld(container: HTMLElement, options: WorldOptions): WorldHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cbd6e0');
  scene.fog = new THREE.Fog('#cbd6e0', 140, 480);
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false, powerPreference: 'high-performance'});
  renderer.setClearColor('#cbd6e0');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Worldo interactive 3D world');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.tabIndex = -1;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  container.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 530);
  const hemi = new THREE.HemisphereLight('#eef4ff', '#8d8883', 1.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff5e9', 3.1);
  sun.position.set(-35, 55, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 150;
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.00015;
  scene.add(sun, sun.target);
  const environment = createCityEnvironment();
  scene.add(environment.group);
  const character = createCharacter({articulated: true});
  scene.add(character.root);
  let vehicle = createVehicle('hand_cart'),
    vehicleKind: VehicleKind = 'hand_cart';
  scene.add(vehicle.root);
  const parkedVehicles = new Map<string, ReturnType<typeof createVehicle>>();
  const handTools = new Map<string, THREE.Group>();
  for (const kind of ['crude_oil', 'rubber', 'wood']) {
    const b = new Builder();
    b.cyl('wood', 0, -0.1, -0.05, 0.025, 0.65);
    if (kind === 'wood') b.box('steel', 0, -0.35, -0.12, 0.06, 0.23, 0.33);
    else if (kind === 'rubber') b.box('steel', 0, -0.34, -0.05, 0.03, 0.23, 0.08);
    else b.box('darkSteel', 0, -0.4, -0.05, 0.3, 0.08, 0.08);
    const g = b.batch();
    g.position.set(0, -0.5, -0.04);
    g.visible = false;
    character.limbs[3].add(g);
    handTools.set(kind, g);
  }
  const workerShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 20),
    new THREE.MeshBasicMaterial({color: '#222a20', transparent: true, opacity: 0.12, depthWrite: false}),
  );
  workerShadow.rotation.x = -Math.PI / 2;
  workerShadow.position.y = 0.04;
  scene.add(workerShadow);
  // Ground-level haze softens the distant tree line without post-processing cost.
  const skyGeometry = new THREE.SphereGeometry(510, 20, 12);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {top: {value: new THREE.Color('#83b8df')}, bottom: {value: new THREE.Color('#e8edf3')}},
    vertexShader:
      'varying vec3 vWorld; void main(){vWorld=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:
      'varying vec3 vWorld;uniform vec3 top;uniform vec3 bottom;void main(){float h=clamp(normalize(vWorld+vec3(0.,22.,0.)).y,0.,1.);gl_FragColor=vec4(mix(bottom,top,pow(h,0.55)),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.renderOrder = -1;
  scene.add(sky);
  const weather = createWeather(scene),
    goalBeacon = createGoalBeacon(scene),
    routeGuide = createRouteGuide(scene);
  const stormSky = new THREE.Color('#566372'),
    coldSky = new THREE.Color('#b9d0e6'),
    moonlight = new THREE.Color('#a9c2ee'),
    duskLight = new THREE.Color('#ffbc83'),
    noonLight = new THREE.Color('#fff6eb');
  let goalTarget: Position | null = null;
  let state: GameSnapshot | undefined,
    initialized = false,
    paused = true,
    hasStarted = false,
    disposed = false,
    contextLost = false,
    quality: 'low' | 'high' | 'auto' = 'auto';
  let translateText = (message: string) => message;
  const refreshWorldText = () => {
    if (!disposed) environment.setTranslator(translateText);
  };
  // Canvas textures must be redrawn after a web font loads; the browser cannot
  // reflow painted text as it does ordinary HTML labels.
  document.fonts.addEventListener('loadingdone', refreshWorldText);
  void document.fonts.ready.then(refreshWorldText);
  let playerPosition = new THREE.Vector3(CITY_START_POSITION.x, 0, CITY_START_POSITION.z),
    heading = 0,
    driving = false,
    speed = 0;
  const external: WorldInput = {forward: 0, turn: 0, lookX: 0, lookY: 0, running: false};
  const keys = new Set<string>();
  let cameraYaw = 0,
    cameraPitch = 0.03,
    orbitOffset = 0,
    cameraDistance = 5.8,
    walkCycle = 0,
    walkTurn = 0,
    near: CityId | null = null,
    interactionKey = '',
    inputYaw: number | null = null,
    lastManualLook = 0,
    lastFootMovement = -Infinity;
  let colliders = getCityColliders(),
    walkingColliders = colliders;
  let focus: {city: CityId; stationId?: string; startedAt?: number; until: number; cut?: boolean} | null = null;
  let activeEquipment: EquipmentInstance | undefined;
  let width = 1,
    height = 1,
    mobile = false,
    ratio = 1.4,
    frame = 0,
    last = performance.now(),
    lastSync = 0,
    lastStats = performance.now(),
    statFrames = 0,
    lowFrames = 0,
    lastMoved = false,
    resizePending = false,
    resetRatio = true;
  const renderSurface = new RenderSurface();
  let composer: EffectComposer | null = null;
  let bloomSize = '';
  let lastSent = new THREE.Vector3(999, 0, 999),
    lastSentHeading = 999;
  const desiredCamera = new THREE.Vector3(),
    lookTarget = new THREE.Vector3();
  let audioElapsed = 0,
    audioDistance = 0,
    audioCollision = 0;
  const updateSize = () => {
    width = Math.max(container.clientWidth, 1);
    height = Math.max(container.clientHeight, 1);
    mobile = width < 700;
    camera.aspect = width / height;
    camera.fov = mobile ? 66 : 58;
    camera.updateProjectionMatrix();
    const limit = Math.min(window.devicePixelRatio || 1, mobile ? 1.3 : 1.6);
    ratio = quality === 'low' ? 1 : quality === 'high' || resetRatio ? limit : Math.min(ratio, limit);
    resetRatio = false;
    resizePending = false;
    renderSurface.queue({width, height, pixelRatio: ratio});
  };
  // ResizeObserver runs after paint/layout. It must never clear a finished frame.
  const resizeObserver = new ResizeObserver(() => {
    resizePending = true;
  });
  resizeObserver.observe(container);
  updateSize();
  renderSurface.apply(renderer);
  const ignoreKeyboard = (target: EventTarget | null) =>
    target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  const onKeyDown = (e: KeyboardEvent) => {
    if (ignoreKeyboard(e.target)) return;
    if (
      [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'ShiftLeft',
        'ShiftRight',
      ].includes(e.code)
    ) {
      if (!paused) e.preventDefault();
      keys.add(e.code);
    }
  };
  let pointer: {id: number; x: number; y: number} | null = null;
  const resetReleasedGesture = () => {
    if (Math.hypot(external.forward, external.turn) < 0.08 && ![...keys].some(key => !key.startsWith('Shift')))
      inputYaw = null;
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    resetReleasedGesture();
  };
  const clear = () => {
    keys.clear();
    external.forward = external.turn = external.lookX = external.lookY = 0;
    speed = 0;
    pointer = null;
    inputYaw = null;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clear);
  const pointerDown = (e: PointerEvent) => {
    if (paused || e.button > 0) return;
    pointer = {id: e.pointerId, x: e.clientX, y: e.clientY};
    renderer.domElement.setPointerCapture(e.pointerId);
  };
  const pointerMove = (e: PointerEvent) => {
    if (!pointer || e.pointerId !== pointer.id || paused) return;
    const yaw = (e.clientX - pointer.x) * 0.004;
    if (driving) orbitOffset -= yaw;
    else {
      cameraYaw -= yaw;
      if (inputYaw !== null) inputYaw -= yaw;
    }
    lastManualLook = performance.now();
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + (e.clientY - pointer.y) * 0.0025, -0.08, 0.65);
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  };
  const pointerUp = (e: PointerEvent) => {
    if (pointer?.id === e.pointerId) pointer = null;
  };
  const wheel = (e: WheelEvent) => {
    if (paused) return;
    e.preventDefault();
    cameraDistance = THREE.MathUtils.clamp(cameraDistance + e.deltaY * 0.004, 4.5, 11);
  };
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointercancel', pointerUp);
  renderer.domElement.addEventListener('lostpointercapture', pointerUp);
  renderer.domElement.addEventListener('wheel', wheel, {passive: false});
  const onContextLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
    container.dataset.contextLost = 'true';
    options.onAudioFrame?.({
      elapsed: 0,
      distance: 0,
      speed: 0,
      throttle: 0,
      driving,
      engineOn: false,
      paused: true,
      indoors: false,
      collision: 0,
      x: playerPosition.x,
      z: playerPosition.z,
    });
  };
  const onContextRestored = () => {
    contextLost = false;
    delete container.dataset.contextLost;
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
  function nearPlace() {
    let closest: CityId | null = null,
      min = Infinity;
    for (const id of CITY_IDS) {
      const c = CITY_CENTERS[id],
        d = Math.hypot(playerPosition.x - c.x, playerPosition.z - c.z);
      if (d < 65 && d < min) {
        min = d;
        closest = id;
      }
    }
    if (closest !== near) {
      near = closest;
      options.onNear?.(near);
    }
    const candidates: WorldInteraction[] = [];
    if (!driving) {
      for (const door of CITY_DOORS)
        if (Math.hypot(playerPosition.x - door.position.x, playerPosition.z - door.position.z) < 3)
          candidates.push({
            kind: 'door',
            id: door.id,
            label: state?.world.doors[door.id] ? 'Close door' : 'Open door',
            cityId: door.cityId,
            city: door.cityId,
            position: door.position,
          });
      const interior = cityInterior(playerPosition);
      for (const npc of CITY_NPCS)
        if (
          Math.hypot(playerPosition.x - npc.position.x, playerPosition.z - npc.position.z) < 3.5 &&
          interior?.cityId === npc.cityId &&
          clearLineOfSight(
            playerPosition,
            npc.position,
            colliders.filter(c => (c.height ?? 6) > 1.5),
          )
        )
          candidates.push({
            kind: 'npc',
            id: npc.id,
            npcId: npc.id,
            label: 'Talk to ' + npc.name,
            cityId: npc.cityId,
            city: npc.cityId,
            position: npc.position,
          });
      for (const node of RESOURCE_NODES)
        if (Math.hypot(playerPosition.x - node.position.x, playerPosition.z - node.position.z) < 3)
          candidates.push({
            kind: 'resource',
            id: node.id,
            label: 'Gather ' + (node.resource === 'crude_oil' ? 'crude oil' : node.resource),
            position: node.position,
            resource: node.resource,
          });
      for (const equipment of state?.player.equipment ?? [])
        if (
          ITEMS[equipment.kind].category === 'vehicle' &&
          equipment.kind !== 'hand_cart' &&
          equipment.position &&
          Math.hypot(playerPosition.x - equipment.position.x, playerPosition.z - equipment.position.z) < 3.5
        )
          candidates.push({
            kind: 'vehicle',
            id: equipment.id,
            label: 'Drive ' + ITEMS[equipment.kind].name,
            position: equipment.position,
          });
    }
    for (const plot of STATION_PLOTS)
      if (Math.hypot(playerPosition.x - plot.pump.x, playerPosition.z - plot.pump.z) < (driving ? 5 : 4))
        candidates.push({
          kind: 'station',
          id: plot.id,
          label: 'Visit petrol station',
          cityId: plot.cityId,
          city: plot.cityId,
          position: plot.pump,
        });
    for (const pump of CITY_PUMPS)
      if (Math.hypot(playerPosition.x - pump.position.x, playerPosition.z - pump.position.z) < (driving ? 4.5 : 2.6))
        candidates.push({
          kind: 'fuel',
          id: pump.id,
          label: 'Use petrol pump',
          cityId: pump.cityId,
          city: pump.cityId,
          position: pump.position,
        });
    candidates.sort(
      (a, b) =>
        Math.hypot(playerPosition.x - a.position.x, playerPosition.z - a.position.z) -
        Math.hypot(playerPosition.x - b.position.x, playerPosition.z - b.position.z),
    );
    const target = candidates[0] ?? null,
      key = target ? target.kind + ':' + target.id + ':' + target.label : '';
    if (key !== interactionKey) {
      interactionKey = key;
      options.onInteraction?.(target);
      container.dataset.interactionId = target?.id ?? '';
    }
  }
  function animate(now: number) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
    last = now;
    if (contextLost) return;
    if (resizePending) updateSize();
    renderSurface.apply(renderer);
    const keyTurn = paused
      ? 0
      : (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const forward = paused
      ? 0
      : THREE.MathUtils.clamp(
          external.forward +
            (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
            (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
          -1,
          1,
        );
    const turn = paused ? 0 : THREE.MathUtils.clamp(external.turn + keyTurn, -1, 1);
    const stickSideways = paused ? 0 : THREE.MathUtils.clamp(external.turn, -1, 1);
    const running = external.running || keys.has('ShiftLeft') || keys.has('ShiftRight');
    let maxSpeed = driving
      ? ITEMS[vehicleKind].speed
      : vehicleKind === 'hand_cart'
        ? ITEMS.hand_cart.speed
        : WALK_SPEED;
    if (driving && vehicleKind !== 'hand_cart' && (activeEquipment?.fuel ?? 0) <= 0) maxSpeed = 0;
    if (activeEquipment && activeEquipment.durability <= 0 && driving) maxSpeed = 0;
    if (forward || turn || pointer) focus = null;
    walkTurn = THREE.MathUtils.damp(walkTurn, driving ? 0 : keyTurn, 12, dt);
    if (!driving) {
      // Held keys turn the person and the view together, so any direction is one hold
      // away and W always walks where the view points. A touch stick already points anywhere.
      const turned = walkTurn * WALK_TURN_RATE * dt;
      cameraYaw -= turned;
      if (inputYaw !== null) inputYaw -= turned;
      inputYaw = walkingReferenceYaw(inputYaw, forward, stickSideways, cameraYaw);
      if (external.lookX) {
        const delta = external.lookX * 0.003;
        cameraYaw -= delta;
        if (inputYaw !== null) inputYaw -= delta;
        lastManualLook = now;
      }
    }
    const walking = walkingDirection(forward, stickSideways, inputYaw ?? cameraYaw),
      desiredSpeed = driving
        ? forward * maxSpeed * (forward < 0 ? 0.5 : 1)
        : walking.strength * maxSpeed * walkingPace(heading, walking.heading);
    speed = THREE.MathUtils.damp(speed, desiredSpeed, driving ? 2.6 : 10, dt);
    if (paused) speed = 0;
    const previousHeading = heading;
    let movementX = 0,
      movementZ = 0;
    if (driving) {
      heading -= turn * 1.65 * Math.min(Math.abs(speed) / 3, 1) * dt * (speed < -0.2 ? -1 : 1);
      movementX = -Math.sin(heading) * speed * dt;
      movementZ = -Math.cos(heading) * speed * dt;
      orbitOffset -= external.lookX * 0.003;
    } else {
      if (walking.strength > 0.001 || Math.abs(walkTurn) > 0.02) heading = turnBody(heading, walking.heading, dt);
      if (walking.strength > 0.001) {
        movementX = walking.x * speed * dt;
        movementZ = walking.z * speed * dt;
      } else speed = 0;
    }
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + external.lookY * 0.003, -0.08, 0.65);
    external.lookX = external.lookY = 0;
    const activeColliders = [...(driving ? colliders : walkingColliders), ...environment.getNpcColliders()];
    const intended = {x: playerPosition.x + movementX, z: playerPosition.z + movementZ};
    const predicted = state ? boundPredictionStep(playerPosition, intended, state.player.position, maxSpeed) : intended;
    let motion = resolveWorldMotion(playerPosition, predicted, previousHeading, heading, driving, activeColliders);
    // Sliding can remove the inward component of a step. Do not let that move
    // around the prediction boundary while waiting for acknowledgement.
    if (state) {
      const bounded = boundPredictionStep(playerPosition, motion.position, state.player.position, maxSpeed);
      if (Math.hypot(bounded.x - motion.position.x, bounded.z - motion.position.z) > 0.0001)
        motion = resolveWorldMotion(playerPosition, playerPosition, previousHeading, heading, driving, activeColliders);
    }
    const moved = Math.hypot(motion.position.x - playerPosition.x, motion.position.z - playerPosition.z) > 0.0001;
    if (!moved && Math.hypot(movementX, movementZ) > 0.0001) speed = 0;
    const travelled = Math.hypot(motion.position.x - playerPosition.x, motion.position.z - playerPosition.z);
    audioElapsed += dt;
    if (!paused) audioDistance += travelled;
    if (driving && motion.blocked && Math.abs(speed) > 1.2)
      audioCollision = Math.max(audioCollision, Math.min(1, Math.abs(speed) / 10));
    playerPosition.set(motion.position.x, 0, motion.position.z);
    heading = motion.heading;
    if (driving && motion.blocked) speed *= 0.65;
    character.root.visible = !driving;
    character.root.position.copy(playerPosition);
    character.root.rotation.y = heading;
    if (driving) {
      vehicle.root.position.copy(playerPosition);
      vehicle.root.rotation.set(0, heading, 0);
    } else if (vehicleKind === 'hand_cart') {
      vehicle.root.position.set(
        playerPosition.x + Math.sin(heading) * 1.8,
        0,
        playerPosition.z + Math.cos(heading) * 1.8,
      );
      vehicle.root.rotation.y = heading;
    }
    for (const wheel of vehicle.wheels) wheel.rotation.x -= (speed * dt) / 0.44;
    // Turning on the spot still takes small steps.
    const stride = Math.max(Math.abs(speed), Math.abs(walkTurn) * 2.4);
    walkCycle += stride * dt * 2.8;
    for (let i = 0; i < character.limbs.length; i++) {
      const phase = i < 2 ? 0 : Math.PI;
      const side = i % 2 === 0 ? 1 : -1;
      const amp = (i % 2 === 0 ? 0.65 : 0.45) * Math.min(stride / 4, 1);
      character.limbs[i].rotation.x = THREE.MathUtils.damp(
        character.limbs[i].rotation.x,
        Math.sin(walkCycle + phase) * amp * side,
        12,
        dt,
      );
    }
    character.root.position.y = driving ? 0 : Math.abs(Math.sin(walkCycle)) * Math.min(stride / 4, 1) * 0.025;
    for (let i = 0; i < character.knees.length; i++)
      character.knees[i].rotation.x = THREE.MathUtils.damp(
        character.knees[i].rotation.x,
        -Math.max(0, -Math.sin(walkCycle + i * Math.PI)) * 0.65 * (driving ? 0 : Math.min(stride / 4, 1)),
        12,
        dt,
      );
    for (const [kind, tool] of handTools) tool.visible = state?.player.gathering?.resource === kind;
    if (state?.player.gathering && !driving) {
      character.limbs[3].rotation.x = 1.1 + Math.sin(now * 0.012) * 0.55;
      character.head.rotation.x = -0.15;
      character.limbs[1].rotation.x = 0.4;
    } else character.head.rotation.x = 0;
    workerShadow.visible = !driving;
    workerShadow.position.x = playerPosition.x;
    workerShadow.position.z = playerPosition.z;
    const dayFraction = state?.world.dayFraction ?? 0.34,
      daylight = THREE.MathUtils.clamp(Math.sin((dayFraction - 0.23) * Math.PI * 2) * 2 + 0.4, 0, 1),
      night = 1 - daylight;
    // Night stays readable: nearly half of every game day is dark, so a blue moon keeps
    // the streets visible. Full daylight is the same as before.
    hemi.intensity = 0.95 + daylight * 0.8;
    sun.intensity = 0.7 + daylight * 2.22;
    sun.color
      .copy(moonlight)
      .lerp(duskLight, Math.min(daylight * 3, 1))
      .lerp(noonLight, Math.max(daylight * 2 - 1, 0));
    skyMaterial.uniforms.top.value.set('#1c2c52').lerp(new THREE.Color('#80b4d9'), daylight);
    skyMaterial.uniforms.bottom.value.set('#45567a').lerp(new THREE.Color('#e8dfd0'), daylight);
    const skies = weather.tick(dt, state?.world.event?.kind ?? null, camera.position, now / 1000);
    if (skies.storm > 0.01 || skies.cold > 0.01) {
      hemi.intensity *= 1 - skies.storm * 0.25;
      sun.intensity *= 1 - skies.storm * 0.5;
      skyMaterial.uniforms.top.value.lerp(stormSky, skies.storm * 0.85).lerp(coldSky, skies.cold * 0.5);
      skyMaterial.uniforms.bottom.value.lerp(stormSky, skies.storm * 0.75).lerp(coldSky, skies.cold * 0.6);
    }
    const fog = scene.fog as THREE.Fog;
    fog.near = 140 - 85 * skies.storm;
    fog.far = 480 - 230 * skies.storm;
    fog.color.copy(skyMaterial.uniforms.bottom.value);
    goalBeacon.tick(now, playerPosition);
    routeGuide.tick(now, playerPosition);
    const observerCity = focus && (!hasStarted || now < focus.until) ? focus.city : !hasStarted ? 'refinery' : null,
      visualPosition = observerCity ? CITY_CENTERS[observerCity] : playerPosition;
    environment.tick(dt, now / 1000, visualPosition, night);
    // Follow the avatar without feeding the rotating view back into a held input.
    if (driving) {
      if (!pointer && Math.abs(speed) > 0.3) orbitOffset = THREE.MathUtils.damp(orbitOffset, 0, 1.2, dt);
      const targetYaw = heading + orbitOffset;
      cameraYaw +=
        Math.atan2(Math.sin(targetYaw - cameraYaw), Math.cos(targetYaw - cameraYaw)) * (1 - Math.exp(-5 * dt));
    } else {
      // Keys already turn the view, so only the touch stick needs the camera to follow.
      if (Math.hypot(external.forward, external.turn) >= STICK_DEAD_ZONE) lastFootMovement = now;
      if (!paused && !pointer && now - lastManualLook > 1000 && now - lastFootMovement < 1000)
        cameraYaw +=
          Math.atan2(Math.sin(heading - cameraYaw), Math.cos(heading - cameraYaw)) * (1 - Math.exp(-4.5 * dt));
    }
    const interior = environment.getInterior(playerPosition),
      distance =
        (driving ? cameraDistance * 1.6 : interior ? Math.min(cameraDistance, mobile ? 3.4 : 3.1) : cameraDistance) *
        (mobile ? 1.08 : 1),
      heightOffset = driving ? 2.1 : interior ? 0.55 : 1.25;
    if (audioElapsed >= 1 / 15) {
      options.onAudioFrame?.({
        elapsed: audioElapsed,
        distance: audioDistance,
        speed: audioDistance / audioElapsed,
        throttle: forward,
        driving,
        engineOn: driving && vehicleKind !== 'hand_cart' && (activeEquipment?.fuel ?? 0) > 0,
        paused,
        indoors: !!interior,
        collision: audioCollision,
        x: visualPosition.x,
        z: visualPosition.z,
        ambience: cityAmbienceAt(
          visualPosition.x,
          visualPosition.z,
          state?.world.cities ?? {},
          environment.getMovingCars(),
        ),
        ambientWhilePaused: !!state?.world.preview,
      });
      audioElapsed = audioDistance = audioCollision = 0;
    }
    // The swept sphere encloses all four near-plane corners, even on wide desktops.
    const halfNearHeight = camera.near * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
      clearance = Math.max(0.24, Math.hypot(camera.near, halfNearHeight, halfNearHeight * camera.aspect) + 0.09);
    lookTarget.set(playerPosition.x, driving ? 1.2 : 1.25, playerPosition.z);
    desiredCamera.set(
      playerPosition.x + Math.sin(cameraYaw) * distance,
      lookTarget.y + heightOffset + cameraPitch * distance,
      playerPosition.z + Math.cos(cameraYaw) * distance,
    );
    if (interior) desiredCamera.y = Math.min(desiredCamera.y, interior.ceiling - clearance - 0.2);
    const cameraColliders = [
      ...environment.getCameraColliders(),
      ...environment.getNpcColliders(),
      ...walkingColliders.filter(c => c.id === 'parked-vehicle'),
    ];
    if (!hasStarted || (focus && now < focus.until)) {
      const c = CITY_CENTERS[focus?.city ?? 'refinery'];
      const plot = focus?.stationId ? STATION_PLOTS.find(p => p.id === focus!.stationId) : undefined;
      if (plot) {
        const pump = CITY_PUMPS.find(p => p.cityId === plot.cityId)!.position,
          mid = {x: (pump.x + plot.pump.x) / 2, z: (pump.z + plot.pump.z) / 2},
          span = Math.abs(pump.x - plot.pump.x);
        desiredCamera.set(mid.x + (mobile ? span + 35 : 12), mobile ? 38 : 29, mid.z + (mobile ? 32 : 44));
        lookTarget.set(mid.x, 1.4, mid.z);
      } else {
        // A recovery shot starts low on the crowd in the square, then cranes up over the
        // whole city while its lights come back.
        const rise = focus?.startedAt ? THREE.MathUtils.smoothstep(now, focus.startedAt + 1200, focus.until) : 1;
        desiredCamera.set(
          c.x + THREE.MathUtils.lerp(9, 49, rise) + Math.sin(now * 0.000025) * 5 * rise,
          THREE.MathUtils.lerp(5.5, 31, rise),
          c.z + THREE.MathUtils.lerp(17, 48, rise),
        );
        lookTarget.set(
          c.x + THREE.MathUtils.lerp(-7, 0, rise),
          THREE.MathUtils.lerp(2.2, 5, rise),
          c.z + THREE.MathUtils.lerp(2, -12, rise),
        );
      }
      if (focus?.cut) {
        camera.position.copy(desiredCamera);
        focus.cut = false;
      } else camera.position.lerp(desiredCamera, 1 - Math.exp(-1.8 * dt));
      camera.lookAt(lookTarget);
    } else {
      const clipped = clipCameraToWorld(lookTarget, desiredCamera, cameraColliders, clearance);
      desiredCamera.set(clipped.x, clipped.y, clipped.z);
      camera.position.lerp(desiredCamera, 1 - Math.exp(-7 * dt));
      const safe = clipCameraToWorld(lookTarget, camera.position, cameraColliders, clearance);
      camera.position.set(safe.x, safe.y, safe.z);
      camera.lookAt(lookTarget);
    }
    // Keep the sky inside the camera far plane everywhere in the large world.
    // Its gradient uses local sphere directions, so translation cannot move the horizon.
    sky.position.copy(camera.position);
    if (goalTarget) {
      const facing = Math.atan2(-Math.sin(cameraYaw), -Math.cos(cameraYaw)),
        bearing = Math.atan2(goalTarget.x - playerPosition.x, goalTarget.z - playerPosition.z);
      container.parentElement?.style.setProperty(
        '--goal-bearing',
        (((facing - bearing) * 180) / Math.PI).toFixed(1) + 'deg',
      );
    }
    // In a very tight corner the lens becomes first-person instead of showing the
    // inside of the avatar's head. Buildings and gameplay collisions stay solid.
    character.root.visible = !driving && camera.position.distanceTo(lookTarget) > 0.8;
    if (now - lastSync > 200) {
      lastSync = now;
      nearPlace();
      if (
        !paused &&
        (playerPosition.distanceToSquared(lastSent) > 0.001 ||
          Math.abs(heading - lastSentHeading) > 0.015 ||
          lastMoved !== moved)
      ) {
        options.onMove({x: playerPosition.x, z: playerPosition.z}, heading, driving);
        lastSent.copy(playerPosition);
        lastSentHeading = heading;
        lastMoved = moved;
      }
    }
    sun.position.set(playerPosition.x - 35, 55, playerPosition.z + 25);
    sun.target.position.set(playerPosition.x, 0, playerPosition.z);
    container.dataset.cameraYaw = String(cameraYaw);
    container.dataset.inputYaw = String(inputYaw ?? cameraYaw);
    container.dataset.cameraX = String(camera.position.x);
    container.dataset.cameraY = String(camera.position.y);
    container.dataset.cameraZ = String(camera.position.z);
    container.dataset.cameraClearance = String(clearance);
    container.dataset.interior = interior?.id ?? '';
    container.dataset.playerX = String(playerPosition.x);
    container.dataset.playerZ = String(playerPosition.z);
    container.dataset.playerHeading = String(heading);
    container.dataset.driving = String(driving);
    if (quality === 'high' && !mobile) {
      if (!composer) {
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.28, 0.35, 1.05));
        composer.addPass(new OutputPass());
      }
      const size = width + ':' + height + ':' + ratio;
      if (size !== bloomSize) {
        composer.setPixelRatio(ratio);
        composer.setSize(width, height);
        bloomSize = size;
      }
      composer.render();
    } else renderer.render(scene, camera);
    statFrames++;
    if (now - lastStats > 1800) {
      const fps = Math.round((statFrames * 1000) / (now - lastStats));
      options.onPerformance?.(fps, renderer.info.render.calls);
      container.dataset.fps = String(fps);
      container.dataset.drawCalls = String(renderer.info.render.calls);
      container.dataset.triangles = String(renderer.info.render.triangles);
      container.dataset.playerX = playerPosition.x.toFixed(2);
      container.dataset.playerZ = playerPosition.z.toFixed(2);
      statFrames = 0;
      lastStats = now;
      if (quality === 'auto') {
        if (fps < 28) {
          lowFrames++;
          if (lowFrames >= 2) {
            const next = lowerPixelRatio(ratio);
            if (next < ratio) {
              ratio = next;
              renderSurface.queue({width, height, pixelRatio: ratio});
            }
            if (ratio <= 1) {
              renderer.shadowMap.enabled = false;
              environment.setQuality('low');
            }
            lowFrames = 0;
          }
        } else lowFrames = 0;
      }
    }
  }
  camera.position.set(-51, 31, -22);
  camera.lookAt(-100, 5, -82);
  sky.position.copy(camera.position);
  nearPlace();
  renderer.render(scene, camera);
  frame = requestAnimationFrame(animate);
  queueMicrotask(() => {
    if (!disposed) options.onReady();
  });
  return {
    setState(next, setOptions) {
      const entering = next.player.driving !== driving;
      state = next;
      driving = next.player.driving;
      environment.setState(next);
      activeEquipment = next.player.equipment.find(e => e.id === next.player.activeVehicleId);
      const nextKind = (activeEquipment?.kind ?? 'hand_cart') as VehicleKind;
      if (vehicleKind !== nextKind) {
        scene.remove(vehicle.root);
        vehicle.root.traverse(o => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        vehicle = createVehicle(nextKind);
        scene.add(vehicle.root);
        vehicleKind = nextKind;
      }
      colliders = environment.getColliders();
      const parked = [];
      for (const e of next.player.equipment) {
        if (
          ITEMS[e.kind].category !== 'vehicle' ||
          e.kind === 'hand_cart' ||
          (e.id === next.player.activeVehicleId && driving) ||
          !e.position
        )
          continue;
        parked.push({...parkedVehicleCollider(e.position, e.heading ?? 0), id: 'parked-vehicle'});
        if (e.id === next.player.activeVehicleId) {
          vehicle.root.position.set(e.position.x, 0, e.position.z);
          vehicle.root.rotation.y = e.heading ?? 0;
          continue;
        }
        let mesh = parkedVehicles.get(e.id);
        if (!mesh) {
          mesh = createVehicle(e.kind as VehicleKind);
          scene.add(mesh.root);
          parkedVehicles.set(e.id, mesh);
        }
        mesh.root.position.set(e.position.x, 0, e.position.z);
        mesh.root.rotation.y = e.heading ?? 0;
      }
      for (const [id, mesh] of parkedVehicles) {
        mesh.root.visible = next.player.equipment.some(e => e.id === id) && id !== next.player.activeVehicleId;
      }
      walkingColliders = [...colliders, ...parked];
      if (!initialized || entering || !setOptions?.preservePosition) {
        playerPosition.set(next.player.position.x, 0, next.player.position.z);
        heading = next.player.heading;
        if (!initialized || entering) {
          cameraYaw = heading;
          orbitOffset = 0;
          inputYaw = null;
        }
        speed = 0;
        initialized = true;
      }
      vehicle.cargo.visible = Object.values(next.player.inventory).some(v => v > 0);
      nearPlace();
    },
    setInput(input) {
      Object.assign(external, input);
      resetReleasedGesture();
    },
    getMovement() {
      return {position: {x: playerPosition.x, z: playerPosition.z}, heading};
    },
    setTranslator(translate) {
      translateText = translate;
      environment.setTranslator(translate);
      renderer.domElement.setAttribute('aria-label', translate('Worldo interactive 3D world'));
    },
    setPrices(prices) {
      environment.setPrices(prices);
    },
    setGoal(target, route) {
      goalTarget = target;
      // With arrows to follow, the light stands where they end, at the door, not inside.
      goalBeacon.set(target && route?.length ? route[route.length - 1] : target);
      routeGuide.set(target ? (route ?? null) : null);
    },
    focusStation(id, durationMs = 6000) {
      const plot = STATION_PLOTS.find(p => p.id === id);
      if (plot)
        focus = {city: plot.cityId, stationId: id, until: performance.now() + Math.min(15000, Math.max(0, durationMs))};
    },
    // A recovery view cuts out of an indoor trade scene without travelling
    // through its roof. Returning to the player still uses collision clipping.
    focusCity(city, durationMs = 3500) {
      const now = performance.now();
      focus = {
        city,
        startedAt: now,
        until: now + Math.min(7000, Math.max(0, durationMs)),
        cut: hasStarted && !state?.world.preview,
      };
    },
    setPaused(value, keepInput = false) {
      paused = value;
      if (value) {
        if (keepInput) speed = 0;
        else clear();
        audioDistance = audioCollision = 0;
        options.onAudioFrame?.({
          elapsed: 0,
          distance: 0,
          speed: 0,
          throttle: 0,
          driving,
          engineOn: driving && vehicleKind !== 'hand_cart' && (activeEquipment?.fuel ?? 0) > 0,
          paused: true,
          indoors: !!environment.getInterior(playerPosition),
          collision: 0,
          x: playerPosition.x,
          z: playerPosition.z,
        });
      } else hasStarted = true;
    },
    setQuality(value) {
      if (value === quality) return;
      quality = value;
      environment.setQuality(value);
      renderer.shadowMap.enabled = value !== 'low';
      resetRatio = true;
      resizePending = true;
      lowFrames = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      document.fonts.removeEventListener('loadingdone', refreshWorldText);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      renderer.domElement.removeEventListener('lostpointercapture', pointerUp);
      renderer.domElement.removeEventListener('wheel', wheel);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      const geos = new Set<THREE.BufferGeometry>(),
        mats = new Set<THREE.Material>(),
        texs = new Set<THREE.Texture>();
      scene.traverse(o => {
        if (o instanceof THREE.Mesh) {
          geos.add(o.geometry);
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            mats.add(m);
            if ((m as THREE.MeshStandardMaterial).map) texs.add((m as THREE.MeshStandardMaterial).map!);
          }
        }
      });
      geos.forEach(g => g.dispose());
      texs.forEach(t => t.dispose());
      mats.forEach(m => m.dispose());
      disposeAssets();
      composer?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
