import {useCallback, useEffect, useRef, useState} from 'react';
import {
  ArrowRight,
  Backpack,
  BookOpen,
  Check,
  ChevronRight,
  CloudRainWind,
  Coins,
  Compass,
  Droplets,
  ExternalLink,
  Flag,
  Fuel,
  Globe,
  Hand,
  LoaderCircle,
  Map as MapIcon,
  MapPin,
  Navigation,
  PartyPopper,
  Pause,
  Play,
  RotateCcw,
  Settings,
  ShieldCheck,
  Snowflake,
  Truck,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from 'lucide-react';
import type {CityId, EconomyEvent, GameAction, GameSnapshot, WorldEventKind} from '../../shared/game';
import {WORLD_EVENT_TEXT} from '../../shared/config/events';
import {currentGoal} from './goals';
import {NEAR_AUTH_AWAITING_APPROVAL} from '../../shared/near-auth';
import {CITIES, CITY_IDS} from '../../shared/config/cities';
import {CARGO_UPGRADES, ITEMS} from '../../shared/config/items';
import {CITY_CENTERS} from '../../shared/city-layout';
import {MAYORS} from '../../shared/mayors';
import {createWorld} from '../world/createWorld';
import type {WorldHandle, WorldInteraction} from '../world/types';
import {
  finishGameplayRevocation,
  getNearIdentity,
  logoutNear,
  revokeGameplaySession,
  type NearIdentity,
} from '../lib/near-auth';
import {takeEntryResume} from '../lib/near-login';
import {enterWorldo, type EntryStage} from '../lib/world-entry';
import {loadWelcomeState, type AppConfig} from '../lib/welcome-startup';
import {
  advancePreview,
  cityAction,
  CityRequestError,
  getCitySession,
  getChainStatus,
  getPreview,
  resetPreview,
  previewPrice,
  type ChainStatus,
  type PreviewPlot,
  type PreviewResponse,
} from '../lib/city-api';
import {GameAudio} from '../lib/game-audio';
import {takeMovement, type MoveAction} from '../lib/city-movement';
import {LANGUAGES, useI18n, type Locale} from '../lib/i18n';
import {TouchControls} from '../components/TouchControls';
import {NpcDialogue} from '../components/NpcDialogue';
import {Funding} from '../components/Funding';
import {CityMap, CITY_COLORS, CITY_ICONS} from './CityMap';
import {CityLedger} from './CityLedger';
import {EquipmentPanel} from './EquipmentPanel';
import {TradeCounter} from './TradeCounter';
import {StationPanel} from './StationPanel';
import {ContractBoard} from './ContractBoard';
import {GoodsIcon, Meter, Modal, Money, RESOURCE_LABELS, CountingMoney} from './ui';
import {CoinBurst} from './CoinBurst';
import {WelcomeCard, PlayPermissionDetails} from './WelcomeCard';
import './city.css';

const EVENT_ICONS: Record<WorldEventKind, typeof Fuel> = {
  storm: CloudRainWind,
  festival: PartyPopper,
  refinery_fault: Wrench,
  oil_boom: Droplets,
  cold_snap: Snowflake,
};
const EVENT_COLORS: Record<WorldEventKind, string> = {
  storm: '#7f9fc4',
  festival: '#e6b35a',
  refinery_fault: '#d0705f',
  oil_boom: '#6fbd8f',
  cold_snap: '#a9d3ee',
};
const NOTICE_TYPES = new Set(['world', 'recovery', 'decision']);
type Panel =
  | 'map'
  | 'inventory'
  | 'cities'
  | 'journal'
  | 'settings'
  | 'account'
  | 'npc'
  | 'trade'
  | 'workshop'
  | 'help'
  | 'station'
  | 'contracts'
  | 'away'
  | 'funding'
  | null;
const REFUSED_STEPS = new Set(['The way is blocked.', 'Movement exceeds your current speed.']);

export default function CityApp() {
  const {t, locale, setLocale, formatNumber} = useI18n();
  const previewMode = new URLSearchParams(window.location.search).get('ff') === '1';
  const [state, setState] = useState<GameSnapshot | null>(null),
    [started, setStarted] = useState(previewMode),
    [ready, setReady] = useState(false),
    [welcomeLoaded, setWelcomeLoaded] = useState(false),
    [panel, setPanel] = useState<Panel>(null),
    [interaction, setInteraction] = useState<WorldInteraction | null>(null);
  const [identity, setIdentity] = useState<NearIdentity | null>(null),
    [authorized, setAuthorized] = useState(false),
    [config, setConfig] = useState<AppConfig | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  const [entryStage, setEntryStage] = useState<EntryStage | null>(null),
    entryController = useRef<AbortController | null>(null);
  const [startupAttempt, setStartupAttempt] = useState(0),
    [startupFailed, setStartupFailed] = useState(false),
    startupGeneration = useRef(0);
  const [cityId, setCityId] = useState<CityId>('refinery'),
    [nearCity, setNearCity] = useState<CityId | null>(null),
    [destination, setDestination] = useState<CityId | null>(null),
    [npcId, setNpcId] = useState('refinery-mayor');
  const [chainStatus, setChainStatus] = useState<ChainStatus | null>(null),
    [stationId, setStationId] = useState('station:refinery:1'),
    [away, setAway] = useState<GameSnapshot['player']['offlineSummary'] | null>(null);
  const [plotDestination, setPlotDestination] = useState<string | null>(null);
  const [quality, setQuality] = useState<'auto' | 'low' | 'high'>('auto'),
    [muted, setMuted] = useState(false),
    [volume, setVolume] = useState(0.65),
    [fps, setFps] = useState(0),
    [gatherProgress, setGatherProgress] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false),
    [supply, setSupply] = useState(true),
    [frames, setFrames] = useState<PreviewPlot[]>([]),
    [elapsed, setElapsed] = useState(0),
    [previewSpeed, setPreviewSpeed] = useState<'fast' | 'live'>('fast'),
    [previewCollapsed, setPreviewCollapsed] = useState(false);
  const mount = useRef<HTMLDivElement>(null),
    world = useRef<WorldHandle | null>(null),
    audio = useRef<GameAudio | null>(null),
    stateRef = useRef<GameSnapshot | null>(null),
    startedRef = useRef(started),
    panelRef = useRef(panel),
    busyRef = useRef(false),
    interactionRef = useRef(interaction);
  const queuedMoves = useRef<MoveAction[]>([]),
    moving = useRef<Promise<boolean> | null>(null),
    gatherHeld = useRef(false),
    gatherTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    action = useRef<(a: GameAction) => Promise<void>>(async () => {});
  const recoveryDelivery = useRef<{cityId: CityId; until: number} | null>(null);
  const [coinBurst, setCoinBurst] = useState<{key: number; amount: number} | null>(null),
    coinPouch = useRef<HTMLButtonElement>(null),
    [stamp, setStamp] = useState<{id: string; number: string; url: string} | null>(null),
    seenBatch = useRef<string | null>(null);
  const [notice, setNotice] = useState<EconomyEvent | null>(null),
    lastNotice = useRef('');
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const apply = useCallback(
    (next: GameSnapshot, preservePosition = false) => {
      const previous = stateRef.current;
      if (
        !previewMode &&
        previous?.player.accountId === next.player.accountId &&
        previous.world.id === next.world.id &&
        previous.world.revision > next.world.revision
      )
        return;
      stateRef.current = next;
      setState(next);
      world.current?.setState(next, {preservePosition});
      const recovery = recoveryDelivery.current;
      if (recovery) {
        if (Date.now() > recovery.until) recoveryDelivery.current = null;
        else if (next.world.cities[recovery.cityId].state !== 'dark') {
          recoveryDelivery.current = null;
          setPanel(null);
          world.current?.focusCity(recovery.cityId, 6500);
        }
      }
    },
    [previewMode],
  );
  const applyPreview = useCallback(
    (next: PreviewResponse) => {
      apply(next.snapshot, true);
      setFrames(next.frames);
      setElapsed(next.elapsedMs);
    },
    [apply],
  );
  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : 'The city connection was interrupted. Please try again.');
    audio.current?.play('error');
  }, []);
  useEffect(() => {
    const engine = new GameAudio();
    audio.current = engine;
    setMuted(engine.muted);
    setVolume(engine.volume);
    const duck = (e: Event) => engine.setVoiceActive(Boolean((e as CustomEvent<{playing: boolean}>).detail?.playing));
    window.addEventListener('worldo:voice', duck);
    return () => {
      window.removeEventListener('worldo:voice', duck);
      engine.dispose();
      audio.current = null;
    };
  }, []);
  useEffect(() => {
    audio.current?.setActive(started);
  }, [started]);
  useEffect(() => () => entryController.current?.abort(), []);
  useEffect(() => {
    startedRef.current = started;
    panelRef.current = panel;
    busyRef.current = busy;
    interactionRef.current = interaction;
    // A short busy moment keeps held keys, so walking carries on straight afterwards.
    world.current?.setPaused(!started || !!panel || busy || previewMode, busy && !panel);
  }, [started, panel, busy, interaction, ready, previewMode]);
  useEffect(() => {
    world.current?.setTranslator(t);
  }, [locale, ready, t]);
  useEffect(() => {
    world.current?.setQuality(quality);
  }, [quality, ready]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  // World news appears once. Events from before this visit stay in the journal.
  useEffect(() => {
    const latest = [...(state?.world.events ?? [])]
      .reverse()
      .find(item => NOTICE_TYPES.has(item.type) && !item.message.startsWith('Steady for now'));
    if (!latest || latest.id === lastNotice.current) return;
    const first = !lastNotice.current;
    lastNotice.current = latest.id;
    if (first || !started) return;
    setNotice(latest);
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [state?.world.events, started]);
  const flushMove = useCallback(
    async (force = false): Promise<boolean> => {
      if (previewMode || (busyRef.current && !force)) return true;
      if (moving.current) {
        const succeeded = await moving.current;
        if (!force || !succeeded) return succeeded;
      }
      if (force) {
        const pose = world.current?.getMovement(),
          last = queuedMoves.current.at(-1) ?? stateRef.current?.player;
        if (
          pose &&
          last &&
          (Math.hypot(pose.position.x - last.position.x, pose.position.z - last.position.z) > 0.005 ||
            Math.abs(pose.heading - last.heading) > 0.01)
        )
          queuedMoves.current.push({type: 'move', ...pose});
      }
      if (!queuedMoves.current.length || !stateRef.current) return true;
      const work = (async () => {
        do {
          const next = takeMovement(queuedMoves.current, stateRef.current!);
          if (!next) break;
          try {
            apply(await cityAction(next), true);
          } catch (e) {
            // A collision, lost connection or stale position must not leave the
            // rendered player permanently ahead of the authoritative game. Held keys
            // stay held, and bumping into something is not worth an error message.
            world.current?.setPaused(true, true);
            queuedMoves.current = [];
            try {
              const saved = await getCitySession();
              if (saved.snapshot) apply(saved.snapshot);
            } catch {
              if (stateRef.current) world.current?.setState(stateRef.current, {preservePosition: false});
            }
            queuedMoves.current = [];
            world.current?.setPaused(!startedRef.current || !!panelRef.current || busyRef.current || previewMode, true);
            if (!(e instanceof Error && REFUSED_STEPS.has(e.message))) fail(e);
            return false;
          }
        } while (force && queuedMoves.current.length);
        return true;
      })();
      moving.current = work;
      try {
        return await work;
      } finally {
        if (moving.current === work) moving.current = null;
      }
    },
    [apply, fail, previewMode],
  );
  useEffect(() => {
    let disposed = false;
    try {
      if (mount.current) {
        world.current = createWorld(mount.current, {
          onReady: () => setReady(true),
          onNear: setNearCity,
          onInteraction: setInteraction,
          onPerformance: fps => setFps(fps),
          onAudioFrame: frame => audio.current?.update(frame),
          onMove: (position, heading) => {
            if (!startedRef.current || panelRef.current || busyRef.current || previewMode) return;
            queuedMoves.current.push({type: 'move', position, heading});
          },
        });
        if (stateRef.current) world.current.setState(stateRef.current);
      }
    } catch (e) {
      fail(e);
    }
    const timer = setInterval(() => {
      if (!disposed) void flushMove();
    }, 400);
    return () => {
      disposed = true;
      clearInterval(timer);
      world.current?.dispose();
      world.current = null;
      queuedMoves.current = [];
    };
  }, [fail, flushMove, previewMode]);
  useEffect(() => {
    let alive = true,
      complete = false,
      lastError = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bootstrap = async () => {
      if (!alive || (!previewMode && startedRef.current)) return;
      const generation = startupGeneration.current;
      const isCurrent = () =>
        alive && generation === startupGeneration.current && !startedRef.current && !busyRef.current;
      try {
        if (!previewMode && (document.hidden || busyRef.current)) return;
        if (previewMode) {
          const p = await getPreview();
          if (alive) {
            applyPreview(p);
            setStarted(true);
          }
          return;
        }
        let savedApplied = false;
        complete = await loadWelcomeState({
          isCurrent,
          onConfig: status => {
            setConfig(status);
            setStartupFailed(false);
          },
          onOverview: snapshot => {
            if (!savedApplied) apply(snapshot);
          },
          onIdentity: setIdentity,
          onPermission: setAuthorized,
          onSaved: saved => {
            setChainStatus(saved.chain);
            if (saved.snapshot) {
              savedApplied = true;
              apply(saved.snapshot);
            }
          },
        });
        if (alive && complete) setWelcomeLoaded(true);
      } catch (e) {
        if (previewMode ? alive : isCurrent()) {
          setStartupFailed(true);
          lastError = e instanceof Error ? e.message : 'The city connection was interrupted. Please try again.';
          fail(e);
        }
      } finally {
        if (alive && complete && lastError) setError(current => (current === lastError ? '' : current));
        if (alive && !complete && !previewMode && !startedRef.current)
          timer = setTimeout(() => void bootstrap(), 10000);
      }
    };
    void bootstrap();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [apply, applyPreview, fail, previewMode, startupAttempt]);
  useEffect(() => {
    if (!started || previewMode) return;
    let disposed = false,
      polling = false;
    const timer = setInterval(() => {
      if (busyRef.current || moving.current || document.hidden || polling) return;
      polling = true;
      void (async () => {
        if (panelRef.current === 'away') {
          const saved = await getCitySession();
          if (!disposed) {
            setChainStatus(saved.chain);
            if (saved.snapshot) apply(saved.snapshot, true);
          }
        } else {
          const [next, chain] = await Promise.all([cityAction({type: 'offline_ack'}), getChainStatus()]);
          if (!disposed) {
            setChainStatus(chain);
            apply(next, true);
          }
        }
      })()
        .catch(fail)
        .finally(() => {
          polling = false;
        });
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [started, previewMode, apply, fail]);
  const perform = useCallback(
    async (a: GameAction) => {
      if (busyRef.current || previewMode) return;
      setError('');
      busyRef.current = true;
      setBusy(true);
      if (!(await flushMove(true))) {
        busyRef.current = false;
        setBusy(false);
        return;
      }
      try {
        const before = stateRef.current;
        const next = await cityAction(a);
        const deliveredCity =
          a.type === 'sell' || a.type === 'donate'
            ? a.cityId
            : a.type === 'contract_deliver'
              ? before?.world.supplyContracts.find(contract => contract.id === a.contractId)?.cityId
              : undefined;
        if (deliveredCity && before?.world.cities[deliveredCity].state === 'dark')
          recoveryDelivery.current = {cityId: deliveredCity, until: Date.now() + 60000};
        apply(next, a.type !== 'vehicle');
        const gained = next.player.coins - (before?.player.coins ?? next.player.coins);
        if (gained > 0 && (a.type === 'sell' || a.type === 'contract_deliver'))
          setCoinBurst({key: Date.now(), amount: gained});
        if (a.type === 'door') audio.current?.play('door');
        else if (a.type === 'gather_finish') audio.current?.play('gather');
        else if (
          [
            'sell',
            'buy',
            'buy_equipment',
            'repair',
            'upgrade',
            'rent_storage',
            'station_buy',
            'station_build',
            'station_stock',
            'station_repair',
            'station_upgrade',
            'contract_accept',
            'contract_deliver',
          ].includes(a.type)
        ) {
          audio.current?.play('trade');
          setToast('Trade complete');
        } else if (a.type === 'vehicle') audio.current?.play(a.driving ? 'vehicle-enter' : 'vehicle-exit');
        else if (a.type === 'refuel') audio.current?.play('refuel');
      } catch (e) {
        if (e instanceof CityRequestError && [401, 403].includes(e.status) && /authoriz/i.test(e.message)) {
          setAuthorized(false);
          setPanel('account');
        }
        fail(e);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [previewMode, flushMove, apply, fail],
  );
  action.current = perform;
  async function enter(guest = false) {
    if (busyRef.current || !config || !ready || (!config.localMode && !config.authConfigured && !guest && !identity))
      return;
    startupGeneration.current++;
    busyRef.current = true;
    setBusy(true);
    setError('');
    void audio.current?.unlock();
    const controller = new AbortController();
    entryController.current = controller;
    try {
      const {snapshot: next} = await enterWorldo({
        localMode: config.localMode,
        guest,
        identity,
        authorized,
        signal: controller.signal,
        onIdentity: setIdentity,
        onPermission: () => setAuthorized(true),
        onStage: setEntryStage,
      });
      apply(next);
      setStarted(true);
      if (next.player.offlineSummary.litresSold > 0 || next.player.offlineSummary.events.length > 0) {
        setAway({...next.player.offlineSummary, events: [...next.player.offlineSummary.events]});
        setPanel('away');
      } else setPanel(null);
    } catch (e) {
      // NEAR Auth has not allowed this site yet, so the player stays here and is told why.
      if (e instanceof Error && e.message === NEAR_AUTH_AWAITING_APPROVAL) {
        setAwaitingApproval(true);
        return;
      }
      if (e instanceof CityRequestError && [401, 403].includes(e.status)) setAuthorized(false);
      const stopped =
        controller.signal.aborted &&
        (e === controller.signal.reason ||
          (e instanceof DOMException && e.name === 'AbortError') ||
          (e instanceof Error && e.message === 'Authorization cancelled.'));
      fail(stopped ? new Error('Setup stopped. Continue to check your account.') : e);
      // Refresh the verified identity after a failed setup; never replace it with
      // a client-supplied account or mark permission active because login succeeded.
      if (!config.localMode)
        try {
          const current = await getNearIdentity();
          setIdentity(current);
          if (!current) setAuthorized(false);
        } catch {}
    } finally {
      entryController.current = null;
      busyRef.current = false;
      setBusy(false);
      setEntryStage(null);
    }
  }
  // Sign-in and approval return to this tab, so finish the click that started them.
  // The identity check stops a lost session from sending the player straight back out.
  useEffect(() => {
    if (!welcomeLoaded || !ready) return;
    void finishGameplayRevocation()
      .then(revoked => {
        if (!revoked) return;
        setAuthorized(false);
        setToast('Play session revoked');
      })
      .catch(fail);
    if (takeEntryResume() && identity) void enter();
  }, [welcomeLoaded, ready]);
  useEffect(() => {
    if (!coinBurst) return;
    const timer = setTimeout(() => setCoinBurst(null), 1800);
    return () => clearTimeout(timer);
  }, [coinBurst]);
  // A small stamp shows each real batch landing on NEAR, linked to the explorer.
  const settled = chainStatus?.lastSettledBatch;
  useEffect(() => {
    const id = settled?.operationId;
    if (!id || !settled) return;
    if (seenBatch.current && seenBatch.current !== id)
      setStamp({id, number: id.split(':')[1] ?? '', url: settled.explorerUrl});
    seenBatch.current = id;
  }, [settled]);
  useEffect(() => {
    if (!stamp) return;
    const timer = setTimeout(() => setStamp(null), 6000);
    return () => clearTimeout(timer);
  }, [stamp]);
  const beginGather = useCallback(async () => {
    const target = interactionRef.current;
    if (!target || target.kind !== 'resource' || gatherHeld.current || busyRef.current) return;
    gatherHeld.current = true;
    // Holding keeps gathering, one unit after another, until release or a full cart.
    while (gatherHeld.current) {
      await action.current({type: 'gather_start', nodeId: target.id});
      const gathering = stateRef.current?.player.gathering;
      if (!gatherHeld.current || !gathering) {
        gatherHeld.current = false;
        if (gathering) await action.current({type: 'gather_cancel'});
        setGatherProgress(0);
        return;
      }
      const finished = await new Promise<boolean>(resolve => {
        const localStart = performance.now();
        const update = () => {
          if (!gatherHeld.current) {
            resolve(false);
            return;
          }
          const progress = Math.min(1, (performance.now() - localStart) / gathering.durationMs);
          setGatherProgress(progress);
          if (progress < 1) gatherTimer.current = setTimeout(update, 40);
          else resolve(true);
        };
        update();
      });
      if (!finished) return;
      setGatherProgress(0);
      await action.current({type: 'gather_finish'});
    }
  }, []);
  const endGather = useCallback(() => {
    if (!gatherHeld.current) return;
    gatherHeld.current = false;
    setGatherProgress(0);
    if (stateRef.current?.player.gathering) void action.current({type: 'gather_cancel'});
  }, []);
  const interact = useCallback(() => {
    const target = interactionRef.current;
    if (!target || busyRef.current) return;
    void audio.current?.unlock();
    if (target.kind === 'resource') {
      setToast('Hold E or the gather button to collect materials.');
      return;
    }
    if (target.kind === 'door') {
      void action.current({type: 'door', doorId: target.id, open: !stateRef.current?.world.doors[target.id]});
      return;
    }
    if (target.kind === 'vehicle') {
      const p = stateRef.current?.player;
      if (p) void action.current({type: 'vehicle', equipmentId: target.id || p.activeVehicleId, driving: !p.driving});
      return;
    }
    setCityId(target.cityId ?? target.city ?? 'refinery');
    if (target.kind === 'station') {
      setStationId(target.id);
      setPanel('station');
      return;
    }
    if (target.kind === 'npc') {
      setNpcId(target.npcId ?? target.id);
      setPanel('npc');
    } else setPanel('trade');
  }, []);
  const vehicle = useCallback(() => {
    const p = stateRef.current?.player;
    if (p) void action.current({type: 'vehicle', equipmentId: p.activeVehicleId, driving: !p.driving});
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'Escape') {
        setPanel(null);
        endGather();
        return;
      }
      if (!startedRef.current || panelRef.current || previewMode) return;
      void audio.current?.unlock();
      if (e.repeat) return;
      if (e.code === 'KeyE') {
        e.preventDefault();
        if (interactionRef.current?.kind === 'resource') void beginGather();
        else interact();
      }
      if (e.code === 'KeyF') vehicle();
      if (e.code === 'KeyM') setPanel('map');
      if (e.code === 'KeyI') setPanel('inventory');
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyE') endGather();
    };
    const blur = () => endGather();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      endGather();
    };
  }, [beginGather, endGather, interact, vehicle, previewMode]);
  useEffect(() => {
    if (!previewPlaying) return;
    let cancelled = false,
      working = false;
    const timer = setInterval(() => {
      if (working || document.hidden) return;
      working = true;
      void advancePreview(1, supply, previewSpeed)
        .then(p => {
          if (!cancelled) applyPreview(p);
        })
        .catch(e => {
          setPreviewPlaying(false);
          fail(e);
        })
        .finally(() => {
          working = false;
        });
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [previewPlaying, supply, previewSpeed, applyPreview, fail]);
  const navigate = (id: CityId) => {
    setDestination(id);
    setPlotDestination(null);
    setPanel(null);
    if (previewMode) world.current?.focusCity(id, 100000);
  };
  const player = state?.player,
    active = player?.equipment.find(e => e.id === player.activeVehicleId),
    capacity =
      (active ? ITEMS[active.kind].capacity : 20) +
      (player ? (CARGO_UPGRADES[player.cargoLevel - 1]?.capacity ?? 0) : 0),
    cargo = player ? Object.values(player.inventory).reduce((a, b) => a + b, 0) : 0;
  const currentCity = nearCity ?? destination ?? 'refinery',
    targetPosition =
      plotDestination && state?.world.stations[plotDestination]
        ? state.world.stations[plotDestination].position
        : destination
          ? CITY_CENTERS[destination]
          : null,
    distance =
      player && targetPosition
        ? Math.round(Math.hypot(player.position.x - targetPosition.x, player.position.z - targetPosition.z))
        : 0;
  const locateStation = () => {
    const selected = state?.world.stations[stationId];
    if (selected) {
      setDestination(selected.cityId);
      setPlotDestination(stationId);
      setPanel(null);
      if (previewMode) world.current?.focusCity(selected.cityId, 100000);
    }
  };
  const openStation = (id: string) => {
    setStationId(id);
    setPanel('station');
    if (previewMode) world.current?.focusStation(id, 100000);
  };
  const simulatedStationAction = async (a: GameAction) => {
    if (a.type !== 'station_price') return;
    setBusy(true);
    try {
      applyPreview(await previewPrice(a.stationId, a.price));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const closePanel = () => {
    if (panel === 'away') {
      void perform({type: 'offline_ack'});
      setAway(null);
    }
    setPanel(null);
  };
  const mayor = MAYORS.find(m => m.id === npcId) ?? MAYORS[0];
  const guestAccount = identity?.authMethod === 'guest',
    goal = started && !previewMode && state ? currentGoal(state) : null,
    goalDistance =
      goal?.target && player
        ? Math.round(Math.hypot(player.position.x - goal.target.x, player.position.z - goal.target.z))
        : 0,
    worldEvent = state?.world.event ?? null,
    EventIcon = worldEvent ? EVENT_ICONS[worldEvent.kind] : null;
  useEffect(() => {
    world.current?.setGoal(goal?.target ?? null, goal?.route ?? null);
  }, [goal?.target?.x, goal?.target?.z, goal?.route]);
  return (
    <main
      className={`worldo-game ${started ? 'playing' : 'welcome'} ${previewMode ? 'preview-mode' : ''}`}
      onPointerDown={() => void audio.current?.unlock()}
    >
      <div className="world-canvas" ref={mount} />
      <div className="screen-vignette" />
      {!started && (
        <WelcomeCard
          localMode={!!config?.localMode}
          authConfigured={!!config?.authConfigured}
          guestPlay={!!config?.guestPlay}
          configLoaded={!!config}
          connectionFailed={!config && startupFailed}
          hasIdentity={!!identity}
          authorized={authorized}
          busy={busy}
          ready={ready}
          onPlay={() => void enter()}
          onGuest={() => {
            setAwaitingApproval(false);
            void enter(true);
          }}
          awaitingApproval={awaitingApproval}
          onDismissApproval={() => setAwaitingApproval(false)}
          onRetry={() => {
            startupGeneration.current++;
            setStartupFailed(false);
            setError('');
            setStartupAttempt(value => value + 1);
          }}
        />
      )}
      {started && state && (
        <>
          <header className="hud-top">
            <button className="worldo-mark" onClick={() => setPanel('help')} aria-label={t('Worldo guide')}>
              <img src="/brand/worldo-logo.png" alt="Worldo" />
            </button>
            <div className="world-time">
              <span className="eyebrow">{t('Day {number}', {number: state.world.day})}</span>
              <span>{t(nearCity ? CITIES[nearCity].name : 'Open country')}</span>
            </div>
            <div className="hud-top-right">
              {!previewMode && (
                <button
                  ref={coinPouch}
                  className={`coin-pouch ${coinBurst ? 'paid' : ''}`}
                  onClick={() => setPanel('account')}
                >
                  <CountingMoney value={player!.coins} />
                </button>
              )}
              <button className="icon-button" aria-label={t('Settings')} onClick={() => setPanel('settings')}>
                <Settings />
              </button>
            </div>
          </header>
          {(goal || worldEvent) && (
            <div className="hud-center">
              {goal && (
                <div className="goal-strip">
                  <span className="goal-arrow">
                    <Navigation size={18} />
                  </span>
                  <div>
                    <span className="eyebrow">{t('Step {step} of {total}', {step: goal.step, total: goal.total})}</span>
                    <strong>{t(goal.title)}</strong>
                    <small>{t(goal.detail)}</small>
                  </div>
                  {goal.target && (
                    <b>
                      <bdi dir="ltr">{goalDistance} m</bdi>
                    </b>
                  )}
                </div>
              )}
              {worldEvent && EventIcon && (
                <div className="event-chip" style={{borderColor: EVENT_COLORS[worldEvent.kind]}}>
                  <EventIcon size={18} color={EVENT_COLORS[worldEvent.kind]} />
                  <div>
                    <strong>{t(WORLD_EVENT_TEXT[worldEvent.kind].title)}</strong>
                    <small>{t(WORLD_EVENT_TEXT[worldEvent.kind].detail)}</small>
                  </div>
                </div>
              )}
            </div>
          )}
          {notice && (
            <div className={`world-notice ${notice.type}`} role="status">
              <span className="eyebrow">{t(CITIES[notice.cityId].name)}</span>
              <p dir="auto">{t(notice.message)}</p>
            </div>
          )}
          {coinBurst && <CoinBurst key={coinBurst.key} amount={coinBurst.amount} target={coinPouch.current} />}
          {stamp && (
            <a key={stamp.id} className="chain-stamp" href={stamp.url} target="_blank" rel="noreferrer">
              <Check size={15} />
              {t('Settled on NEAR')}
              <small>{t('Batch {number}', {number: stamp.number})}</small>
            </a>
          )}
          <aside className="city-pulse">
            {CITY_IDS.map(id => {
              const c = state.world.cities[id],
                Icon = CITY_ICONS[id];
              return (
                <button
                  key={id}
                  className={`pulse-card ${destination === id ? 'selected' : ''} ${c.state}`}
                  onClick={() => navigate(id)}
                >
                  <Icon size={19} color={CITY_COLORS[id]} />
                  <div>
                    <strong>{t(CITIES[id].name)}</strong>
                    <Meter value={c.fuelPercent} label={t('City fuel')} />
                    <small>{c.protest > 0 ? t('Delivery needed') : t(c.state)}</small>
                  </div>
                  <b>
                    {Math.round(c.fuelPercent)}
                    <small>%</small>
                  </b>
                </button>
              );
            })}
          </aside>
          <div className="mini-map-shell">
            <CityMap state={state} compact onSelect={navigate} />
            <button onClick={() => setPanel('map')}>
              <MapPin size={13} />
              {t(CITIES[currentCity].name)}
              <kbd>M</kbd>
            </button>
          </div>
          {destination && !previewMode && (
            <div className="destination-marker">
              <Compass size={18} />
              {plotDestination
                ? t(
                    state.world.stations[plotDestination]?.ownerId
                      ? state.world.stations[plotDestination].name
                      : 'Station plot',
                  )
                : t(CITIES[destination].name)}
              <strong>{distance} m</strong>
              <button
                aria-label={t('Clear destination')}
                onClick={() => {
                  setDestination(null);
                  setPlotDestination(null);
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {!previewMode && (
            <>
              <div className="cargo-status">
                <div>
                  <Backpack size={16} />
                  {t('Cargo')}
                  <strong>
                    <bdi dir="ltr">
                      {cargo} / {capacity}
                    </bdi>
                  </strong>
                </div>
                <Meter value={(cargo / capacity) * 100} label={t('Cargo')} />
                {active && ITEMS[active.kind].fuelCapacity > 0 && (
                  <>
                    <div>
                      <Fuel size={16} />
                      {t('Fuel')}
                      <strong>{Math.floor(active.fuel)}%</strong>
                    </div>
                    <Meter value={active.fuel} label={t('Fuel')} />
                  </>
                )}
              </div>
              <nav className="game-toolbar" aria-label={t('Game menu')}>
                {(
                  [
                    ['inventory', Backpack, 'Cargo & equipment'],
                    ['map', MapIcon, 'Map'],
                    ['cities', Globe, 'City economies'],
                    ['journal', BookOpen, 'World journal'],
                  ] as const
                ).map(([id, Icon, label]) => (
                  <button key={id} aria-label={t(label)} title={t(label)} onClick={() => setPanel(id)}>
                    <Icon />
                    <span>{t(label)}</span>
                  </button>
                ))}
              </nav>
              {interaction && !panel && (
                <div className="interaction-callout">
                  {interaction.kind === 'resource' ? (
                    <button
                      className="gather-button"
                      onPointerDown={e => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        void beginGather();
                      }}
                      onPointerUp={endGather}
                      onPointerCancel={endGather}
                      onLostPointerCapture={endGather}
                      disabled={busy && !gatherHeld.current}
                    >
                      <span className="gather-fill" style={{width: `${gatherProgress * 100}%`}} />
                      <GoodsIcon resource={interaction.resource ?? 'crude_oil'} />
                      <span>
                        {t('Hold to gather')}
                        <strong>{t(RESOURCE_LABELS[interaction.resource ?? 'crude_oil'])}</strong>
                      </span>
                      <kbd>E</kbd>
                    </button>
                  ) : (
                    <button onClick={interact} disabled={busy}>
                      <Hand size={20} />
                      <span>{t(interaction.label)}</span>
                      <kbd>E</kbd>
                    </button>
                  )}
                </div>
              )}
              {!panel && (
                <TouchControls
                  world={world}
                  driving={!!player?.driving}
                  canInteract={!!interaction && interaction.kind !== 'resource'}
                  onInteract={interact}
                  onVehicle={vehicle}
                />
              )}
              <div className="desktop-controls">
                <kbd>WASD</kbd>
                {t('Move')}
                <kbd>E</kbd>
                {t('Interact')}
                <kbd>F</kbd>
                {t('Vehicle')}
                <span>{t('Drag to look')}</span>
              </div>
            </>
          )}
          {previewMode && (
            <section className={`preview-controls ${previewCollapsed ? 'collapsed' : ''}`}>
              <button
                className="preview-collapse icon-button"
                aria-label={t(previewCollapsed ? 'Show observatory controls' : 'Hide observatory controls')}
                onClick={() => setPreviewCollapsed(value => !value)}
              >
                <ChevronRight size={17} style={{transform: `rotate(${previewCollapsed ? -90 : 90}deg)`}} />
              </button>
              <span className="eyebrow">{t('Economy observatory')}</span>
              <h2>{t('A week in a minute')}</h2>
              <p>{t('Isolated simulation · no live balances or transactions')}</p>
              <div className="preview-actions">
                <button className="button primary" onClick={() => setPreviewPlaying(v => !v)}>
                  {previewPlaying ? <Pause size={17} /> : <Play size={17} />} {t(previewPlaying ? 'Pause' : 'Run')}
                </button>
                <button
                  className="icon-button"
                  aria-label={t('Reset simulation')}
                  onClick={() => {
                    setPreviewPlaying(false);
                    void resetPreview().then(applyPreview).catch(fail);
                  }}
                >
                  <RotateCcw size={18} />
                </button>
                <strong>{t('Day {number}', {number: Math.floor(elapsed / (20 * 60 * 1000)) + 1})}</strong>
              </div>
              <label className="supply-switch">
                <input type="checkbox" checked={supply} onChange={e => setSupply(e.target.checked)} />
                <span>
                  {t('Simulated supply deliveries')}
                  <small>{t('Off: watch shortages. On: watch recovery.')}</small>
                </span>
              </label>
              <div className="preview-speed">
                <button className={previewSpeed === 'fast' ? 'active' : ''} onClick={() => setPreviewSpeed('fast')}>
                  {t('Week per minute')}
                </button>
                <button className={previewSpeed === 'live' ? 'active' : ''} onClick={() => setPreviewSpeed('live')}>
                  {t('Real time')}
                </button>
              </div>
              <button
                className="quiet-button"
                onClick={() => {
                  const owned = Object.values(state.world.stations).find(s => s.ownerId === state.player.accountId);
                  if (owned) openStation(owned.id);
                }}
              >
                {t('Manage simulated station')}
                <Fuel size={14} />
              </button>
              <PreviewChart frames={frames} />
              <button className="quiet-button" onClick={() => setPanel('cities')}>
                {t('Inspect city accounts')}
                <ArrowRight size={14} />
              </button>
              <a className="back-to-game" href="/">
                {t('Back to game')}
              </a>
            </section>
          )}
          <footer className="network-caption">
            <span className="network-dot" />
            {previewMode
              ? t('Simulation')
              : config?.localMode
                ? t('Local save')
                : state.network === 'testnet'
                  ? t('Test world · items have no cash value')
                  : null}
          </footer>
        </>
      )}
      {busy && !started && (
        <div className="pending-ribbon" role="status">
          <LoaderCircle className="spin" size={15} />
          {t(
            entryStage === 'signing-in'
              ? 'Creating your account…'
              : entryStage === 'preparing'
                ? 'Preparing your world…'
                : 'Opening your world…',
          )}
          {entryStage && entryStage !== 'entering' && (
            <button className="quiet-button" onClick={() => entryController.current?.abort()}>
              {t('Cancel setup')}
            </button>
          )}
        </div>
      )}
      {toast && (
        <div className="game-toast" role="status">
          <Check size={17} />
          {t(toast)}
        </div>
      )}
      {error && (
        <div className="game-error" role="alert">
          <span>{t(error)}</span>
          <button aria-label={t('Dismiss')} onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {panel && state && (
        <Modal
          title={
            panel === 'funding'
              ? 'Fund NEAR account'
              : panel === 'station'
                ? 'Petrol station'
                : panel === 'contracts'
                  ? 'Supply contracts'
                  : panel === 'away'
                    ? 'While you were away'
                    : panel === 'trade'
                      ? CITIES[cityId].name
                      : panel === 'npc'
                        ? mayor.name
                        : panel === 'workshop'
                          ? 'Motor City workshop'
                          : panel === 'map'
                            ? 'World map'
                            : panel === 'inventory'
                              ? 'Cargo & equipment'
                              : panel === 'cities'
                                ? 'City economies'
                                : panel === 'journal'
                                  ? 'World journal'
                                  : panel === 'account'
                                    ? 'Account & permissions'
                                    : panel === 'help'
                                      ? 'Field guide'
                                      : 'Settings'
          }
          eyebrow={panel === 'npc' ? mayor.role : 'Worldo'}
          onClose={closePanel}
          wide={['cities', 'map', 'inventory', 'workshop', 'npc', 'station'].includes(panel)}
        >
          {panel === 'map' && (
            <CityMap
              state={state}
              onSelect={navigate}
              onStation={openStation}
              onContracts={id => {
                setCityId(id);
                setPanel('contracts');
              }}
            />
          )}
          {panel === 'cities' && (
            <CityLedger
              state={state}
              onNavigate={navigate}
              onStation={openStation}
              onContracts={id => {
                setCityId(id);
                setPanel('contracts');
              }}
            />
          )}
          {(panel === 'inventory' || panel === 'workshop') && (
            <EquipmentPanel state={state} busy={busy || previewMode} onAction={perform} shop={panel === 'workshop'} />
          )}
          {panel === 'trade' && (
            <>
              <TradeCounter state={state} cityId={cityId} busy={busy} onAction={perform} />
              <button className="button workshop-link" onClick={() => setPanel('contracts')}>
                <BookOpen size={17} />
                {t('Supply contract board')}
              </button>
              {cityId === 'motor' && (
                <button className="button workshop-link" onClick={() => setPanel('workshop')}>
                  <Truck size={17} />
                  {t('Browse tools & vehicles')}
                </button>
              )}
              {cityId === 'harbor' && (
                <button className="button workshop-link" onClick={() => setPanel('inventory')}>
                  <Backpack size={17} />
                  {t('Warehouse & cargo upgrades')}
                </button>
              )}
            </>
          )}
          {panel === 'station' && (
            <StationPanel
              key={stationId}
              state={state}
              stationId={stationId}
              busy={busy}
              onAction={previewMode ? simulatedStationAction : perform}
              onLocate={locateStation}
              allowSimulatedPricing={previewMode}
            />
          )}
          {panel === 'contracts' && <ContractBoard state={state} cityId={cityId} busy={busy} onAction={perform} />}
          {panel === 'away' && away && (
            <div className="away-card">
              <Fuel size={40} />
              {away.litresSold > 0 && <p>{t('Your stations kept serving the city while you were away.')}</p>}
              <div>
                <strong>{formatNumber(away.litresSold)} L</strong>
                <Money value={away.coinsEarned} />
              </div>
              <ul>
                {away.events.slice(-6).map((event, i) => (
                  <li key={i}>{t(event)}</li>
                ))}
              </ul>
              <ul className="away-tanks">
                {Object.values(state.world.stations)
                  .filter(station => station.ownerId === state.player.accountId)
                  .map(station => (
                    <li key={station.id}>
                      <strong>{station.name}</strong>
                      <small>
                        {t('Tank level')}:{' '}
                        <bdi dir="ltr">
                          {formatNumber(station.tank)} / {formatNumber(station.tankCapacity)} L
                        </bdi>
                      </small>
                    </li>
                  ))}
              </ul>
              <p>{t('Check your station tanks before the next rush.')}</p>
              <button className="button primary" onClick={closePanel}>
                {t('Back to work')}
                <ArrowRight size={16} />
              </button>
            </div>
          )}
          {panel === 'npc' && (
            <NpcDialogue
              npc={mayor}
              state={state}
              onTrade={id => {
                setCityId(id);
                setPanel('trade');
              }}
            />
          )}
          {panel === 'journal' && (
            <div className="journal-list">
              {[...state.world.events]
                .reverse()
                .slice(0, 30)
                .map(e => (
                  <article key={e.id}>
                    <span className="eyebrow">{t(CITIES[e.cityId].name)}</span>
                    <p>{t(e.message)}</p>
                  </article>
                ))}
              {state.world.events.length === 0 && <p>{t('The first deliveries are still to come.')}</p>}
            </div>
          )}
          {panel === 'settings' && (
            <div className="settings-list">
              <label>
                <Globe />
                {t('Language')}
                <select value={locale} onChange={e => setLocale(e.target.value as Locale)}>
                  {LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Graphics quality')}
                <select value={quality} onChange={e => setQuality(e.target.value as typeof quality)}>
                  <option value="auto">{t('Automatic')}</option>
                  <option value="high">{t('High')}</option>
                  <option value="low">{t('Low')}</option>
                </select>
              </label>
              <div>
                <button
                  className="button"
                  onClick={() => {
                    audio.current?.setMuted(!muted);
                    setMuted(!muted);
                    if (muted) void audio.current?.unlock();
                  }}
                >
                  {muted ? <VolumeX /> : <Volume2 />}
                  {t(muted ? 'Sound off' : 'Sound on')}
                </button>
                <label>
                  {t('Volume')}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={volume}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      audio.current?.setVolume(v);
                    }}
                  />
                </label>
              </div>
              <small>
                {formatNumber(fps, {maximumFractionDigits: 0})} FPS · {t('Available in 10 languages')}
              </small>
            </div>
          )}
          {panel === 'funding' && <Funding />}
          {panel === 'account' && (
            <div className="account-details">
              {config?.chainSyncEnabled ? <img src="/brand/near.svg" alt="NEAR" width="32" /> : <Coins size={32} />}
              <span className="eyebrow">{t(config?.localMode ? 'Local save' : 'Automatic in-game trades')}</span>
              <h3>{guestAccount ? t('Guest player') : <bdi>{identity?.accountId ?? player?.accountId}</bdi>}</h3>
              <Money value={player?.coins ?? 0} />
              <p>
                {t(
                  'Coins circulate between players, drivers and cities. Game actions update immediately; background batches record them on NEAR when chain sync is enabled.',
                )}
              </p>
              <p>{t('Game-token authorization cannot transfer native NEAR or call other contracts.')}</p>
              {guestAccount && <p>{t('Guest accounts are for trying Worldo. They live on the test network.')}</p>}
              {config?.chainSyncEnabled && !guestAccount && <PlayPermissionDetails />}
              {(player?.receipt ?? chainStatus?.lastSettledBatch) && (
                <a
                  className="button"
                  href={(player?.receipt ?? chainStatus?.lastSettledBatch)!.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('View latest transaction')}
                  <ExternalLink size={16} />
                </a>
              )}
              {config?.chainSyncEnabled && config.network === 'mainnet' && (
                <button className="button" onClick={() => setPanel('funding')}>
                  {t('Fund NEAR account')}
                  <ExternalLink size={16} />
                </button>
              )}
              {config?.chainSyncEnabled && !authorized && (
                <button className="button primary" disabled={busy} onClick={() => void enter()}>
                  {t('Continue to play')}
                  <ShieldCheck size={16} />
                </button>
              )}
              {config?.chainSyncEnabled && !guestAccount && (
                <>
                  <button className="button" onClick={() => void revokeGameplaySession().catch(fail)}>
                    {t('Revoke play session')}
                  </button>
                  <button
                    className="quiet-button"
                    onClick={() =>
                      void logoutNear()
                        .then(() => {
                          setIdentity(null);
                          setAuthorized(false);
                          setStarted(false);
                          setPanel(null);
                        })
                        .catch(fail)
                    }
                  >
                    {t('Sign out')}
                  </button>
                </>
              )}
              <p className="fine-print">
                {chainStatus?.enabled
                  ? t('{count} actions awaiting background settlement', {count: chainStatus.queuedActions})
                  : t('This local world makes no blockchain transactions and has no monetary value.')}
              </p>
            </div>
          )}
          {panel === 'help' && (
            <div className="field-guide">
              <h3>{t('Keep three cities moving')}</h3>
              <ol>
                <li>
                  {t('Walk to the oil field, rubber jungle or forest. Hold E to gather with your starter tools.')}
                </li>
                <li>{t('Enter a city exchange and talk to its mayor. Sell useful cargo for coins.')}</li>
                <li>
                  {t(
                    'Deliver crude to Refinery City, rubber and wood to Motor City, and construction supplies to Harbor City.',
                  )}
                </li>
                <li>{t('Buy petrol for your vehicles and powered tools. Upgrade transport to carry more.')}</li>
                <li>{t('Buy a station plot, build with wood, haul petrol and set a price that attracts drivers.')}</li>
                <li>{t('Watch fuel, shortages and funded bounties. Your deliveries bring cities back to life.')}</li>
              </ol>
              <p>
                {t('WASD moves. E interacts or gathers. F enters your vehicle. M opens the map. I opens your cargo.')}
              </p>
            </div>
          )}
        </Modal>
      )}
    </main>
  );
}
function PreviewChart({frames}: {frames: PreviewPlot[]}) {
  const {t} = useI18n(),
    [metric, setMetric] = useState<'fuel' | 'prices' | 'share'>('fuel'),
    recent = frames.slice(-90),
    seenEvents = [...new Set(recent.flatMap(f => (f.event ? [f.event] : [])))],
    maximum =
      metric === 'fuel'
        ? 100
        : metric === 'share'
          ? 1
          : Math.max(1, ...recent.flatMap(f => [...Object.values(f.prices), ...Object.values(f.stationPrices ?? {})]));
  return (
    <div className="preview-chart">
      <div className="chart-tabs">
        <button className={metric === 'fuel' ? 'active' : ''} onClick={() => setMetric('fuel')}>
          {t('Fuel reserves')}
        </button>
        <button className={metric === 'prices' ? 'active' : ''} onClick={() => setMetric('prices')}>
          {t('Pump prices')}
        </button>
        <button className={metric === 'share' ? 'active' : ''} onClick={() => setMetric('share')}>
          {t('City market share')}
        </button>
      </div>
      <svg
        viewBox="0 0 300 90"
        role="img"
        aria-label={t(
          metric === 'fuel'
            ? 'City fuel reserves over time'
            : metric === 'share'
              ? 'City station market share over time'
              : 'Petrol prices over time',
        )}
      >
        <path d="M0 5H300M0 45H300M0 85H300" stroke="#ffffff12" fill="none" />
        {recent.map((f, i) =>
          f.event ? (
            <rect
              key={i}
              x={(i / Math.max(1, recent.length - 1)) * 300 - 2.5}
              y="0"
              width="5"
              height="90"
              fill={EVENT_COLORS[f.event]}
              opacity=".2"
            />
          ) : null,
        )}
        {CITY_IDS.map(id => (
          <g key={id}>
            <polyline
              points={recent
                .map(
                  (f, i) =>
                    `${(i / Math.max(1, recent.length - 1)) * 300},${85 - ((metric === 'fuel' ? f.fuel[id] : metric === 'share' ? (f.marketShare?.[id] ?? 1) : f.prices[id]) / maximum) * 80}`,
                )
                .join(' ')}
              fill="none"
              stroke={CITY_COLORS[id]}
              strokeWidth="2"
            />
            {metric === 'prices' && recent.some(f => (f.stationPrices?.[id] ?? 0) > 0) && (
              <polyline
                points={recent
                  .map(
                    (f, i) =>
                      `${(i / Math.max(1, recent.length - 1)) * 300},${85 - ((f.stationPrices?.[id] ?? 0) / maximum) * 80}`,
                  )
                  .join(' ')}
                fill="none"
                stroke={CITY_COLORS[id]}
                strokeDasharray="4 3"
                strokeWidth="1.5"
              />
            )}
          </g>
        ))}
      </svg>
      <div>
        {CITY_IDS.map(id => (
          <span key={id} style={{color: CITY_COLORS[id]}}>
            {t(CITIES[id].name)}
          </span>
        ))}
      </div>
      {metric === 'prices' && <small>{t('Solid: city pumps · dashed: player pumps')}</small>}
      {seenEvents.length > 0 && (
        <div className="chart-events" aria-label={t('World events')}>
          {seenEvents.map(kind => {
            const Icon = EVENT_ICONS[kind];
            return (
              <span key={kind} style={{color: EVENT_COLORS[kind]}}>
                <Icon size={12} />
                {t(WORLD_EVENT_TEXT[kind].title)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
