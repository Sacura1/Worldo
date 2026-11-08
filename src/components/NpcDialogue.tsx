import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ArrowRight, MessageCircle, Send, ShoppingBag, Volume2, VolumeX, LoaderCircle} from 'lucide-react';
import type {GameSnapshot, CityId} from '../../shared/game';
import {MAYORS as SERVICE_NPCS, MAYOR_SUGGESTIONS, type Mayor} from '../../shared/mayors';
import {NpcAudioPlayer, type NpcAudioState} from '../lib/npc-audio';
import {useI18n} from '../lib/i18n';
import type {Locale} from '../../shared/languages';

type Line = {role: 'user' | 'assistant'; content: string; replyId?: string};
type Reply = {
  text: string;
  replyId: string;
  locale: Locale;
  suggestions?: string[];
  source: 'near-ai' | 'scripted';
  voiceAvailable: boolean;
};
type Readiness = {chat: {ready: boolean; reason: string; scripted?: boolean}; voice: {ready: boolean; reason: string}};
const introductions = Object.fromEntries(SERVICE_NPCS.map(n => [n.id, n.introduction]));

/** A small character portrait, using the same clothing and complexion as the world. */
export function NpcPortrait({npcId, className = ''}: {npcId: string; className?: string}) {
  const {t} = useI18n();
  const index = Math.max(
    0,
    SERVICE_NPCS.findIndex(n => n.id === npcId),
  );
  const skin = ['#805139', '#dfaa82', '#84513b'][index],
    shirt = ['#c9793e', '#467d8c', '#a24b45'][index];
  const hair = index === 0 || index === 3 ? '#53372b' : '#272624',
    woman = index === 1 || index === 2;
  return (
    <svg
      className={`npc-portrait ${className}`}
      viewBox="0 0 160 180"
      role="img"
      aria-label={t('{name} portrait', {name: SERVICE_NPCS[index]?.name ?? t('Resident')})}
    >
      <defs>
        <linearGradient id={`portrait-${npcId}`} x2="0" y2="1">
          <stop stopColor="#526a4b" />
          <stop offset="1" stopColor="#24382c" />
        </linearGradient>
      </defs>
      <path
        d="M12 17Q80-8 148 17V164Q80 190 12 164Z"
        fill={`url(#portrait-${npcId})`}
        stroke="#bc9756"
        strokeWidth="3"
      />
      <circle cx="80" cy="69" r="47" fill="#e7c276" opacity=".1" />
      {woman && <path d="M43 60Q40 15 80 20Q122 15 118 72L128 122H33Z" fill={hair} />}
      <path d="M25 168L32 126Q40 111 64 109H96Q122 112 129 128L136 168Z" fill={shirt} />
      <path d="M67 96V115L80 125L94 113V95Z" fill={skin} />
      <path d="M50 48Q80 25 110 48V80Q108 107 81 111Q52 106 50 80Z" fill={skin} />
      <ellipse cx="49" cy="74" rx="6" ry="10" fill={skin} />
      <ellipse cx="111" cy="74" rx="6" ry="10" fill={skin} />
      <path d="M48 59Q40 23 78 24Q114 20 113 59L99 45Q74 56 59 43Z" fill={hair} />
      <path d="M59 65Q66 61 73 65M88 65Q96 61 103 66" stroke={hair} strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="67" cy="72" rx="3" ry="4" fill="#262721" />
      <ellipse cx="96" cy="72" rx="3" ry="4" fill="#262721" />
      <path d="M81 73L77 85H84" stroke="#704a34" strokeWidth="2" opacity=".55" fill="none" strokeLinecap="round" />
      <path d="M69 94Q81 101 94 93" stroke="#714536" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {!woman && index !== 4 && (
        <path d="M57 88Q60 112 81 113Q105 109 107 88Q98 102 81 101Q68 101 57 88Z" fill={hair} opacity=".65" />
      )}
      <path d="M60 111L79 126L68 143L51 116M98 111L81 126L92 143L110 117" fill="#f3dfb4" opacity=".75" />
      <path d="M80 128V174" stroke="#172e2b" opacity=".45" strokeWidth="3" />
      <rect x="101" y="142" width="19" height="18" rx="2" fill="#182e2b" opacity=".25" />
      <circle cx="86" cy="147" r="2" fill="#e8c482" />
      <circle cx="86" cy="160" r="2" fill="#e8c482" />
      {(index === 1 || index === 3) && (
        <>
          <path d="M45 49Q46 20 80 20Q113 21 116 49Z" fill="#e7b956" />
          <path d="M42 49H119" stroke="#a97832" strokeWidth="7" strokeLinecap="round" />
          <path d="M80 23V45" stroke="#f8d786" strokeWidth="8" />
        </>
      )}
    </svg>
  );
}

export function NpcDialogue({
  npc,
  state,
  onTrade,
}: {
  npc: Mayor;
  state: GameSnapshot;
  onTrade: (place: CityId) => void;
}) {
  const {locale, t} = useI18n();
  const [lines, setLines] = useState<Line[]>([{role: 'assistant', content: t(introductions[npc.id])}]);
  const [message, setMessage] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [status, setStatus] = useState<Readiness | null>(null),
    [statusError, setStatusError] = useState('');
  const [suggestions, setSuggestions] = useState(MAYOR_SUGGESTIONS);
  const [voice, setVoice] = useState(() => localStorage.getItem('worldo.npcVoice') !== 'off');
  const [audioState, setAudioState] = useState<NpcAudioState>('idle'),
    [audioError, setAudioError] = useState('');
  const conversation = useRef<HTMLDivElement>(null),
    alive = useRef(true),
    pendingRef = useRef(false),
    generation = useRef(0),
    chatAbort = useRef<AbortController | null>(null),
    voiceRef = useRef(voice);
  const player = useRef<NpcAudioPlayer | null>(null);
  const mode = 'live' as const;
  if (!player.current)
    player.current = new NpcAudioPlayer((phase, problem) => {
      window.dispatchEvent(new CustomEvent('worldo:voice', {detail: {playing: phase === 'playing'}}));
      if (alive.current) {
        setAudioState(phase);
        if (problem) setAudioError(problem);
      }
    });
  useLayoutEffect(() => {
    alive.current = true;
    const version = ++generation.current;
    chatAbort.current?.abort();
    pendingRef.current = false;
    player.current?.dispose();
    setLines([{role: 'assistant', content: t(introductions[npc.id])}]);
    setMessage('');
    setPending(false);
    setError('');
    setAudioError('');
    setStatus(null);
    setStatusError('');
    setSuggestions(MAYOR_SUGGESTIONS);
    const controller = new AbortController();
    void fetch(`/api/npc/status?npcId=${encodeURIComponent(npc.id)}`, {
      credentials: 'same-origin',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Dialogue status is unavailable.');
        if (alive.current && generation.current === version) setStatus(body as Readiness);
      })
      .catch(e => {
        if (alive.current && !controller.signal.aborted && generation.current === version)
          setStatusError(e instanceof Error ? e.message : 'Dialogue status is unavailable.');
      });
    return () => {
      alive.current = false;
      generation.current++;
      controller.abort();
      chatAbort.current?.abort();
      player.current?.dispose();
    };
  }, [npc.id, mode, locale]);
  useEffect(() => {
    conversation.current?.scrollTo({top: conversation.current.scrollHeight, behavior: 'smooth'});
  }, [lines, pending]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) player.current?.stop();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  async function speak(replyId: string) {
    setAudioError('');
    await player.current?.play({npcId: npc.id, replyId, mode, locale});
  }
  async function send(text: string) {
    const clean = text.trim();
    if (!clean || pendingRef.current || !status?.chat.ready) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    setAudioError('');
    setMessage('');
    player.current?.stop();
    const version = generation.current,
      controller = new AbortController();
    chatAbort.current = controller;
    setLines(previous => [...previous, {role: 'user' as const, content: clean}].slice(-40));
    try {
      const response = await fetch('/api/npc/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({npcId: npc.id, message: clean, mode, locale}),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(40000)]),
      });
      const reply = (await response.json()) as Reply & {error?: string};
      if (!response.ok) throw new Error(reply.error ?? 'The conversation is unavailable.');
      if (!alive.current || generation.current !== version) return;
      if (reply.locale !== locale) throw new Error('The reply language changed. Please try again.');
      setLines(
        previous =>
          [
            ...previous,
            {
              role: 'assistant',
              content: reply.source === 'scripted' ? t(reply.text) : reply.text,
              replyId: reply.source === 'scripted' ? undefined : reply.replyId,
            },
          ].slice(-40) as Line[],
      );
      if (reply.suggestions?.length) setSuggestions(reply.suggestions.slice(0, 3));
      // This follows an explicit Send/suggestion click. Browsers that block async autoplay get a Listen button.
      if (voiceRef.current && reply.voiceAvailable) void speak(reply.replyId);
    } catch (e) {
      if (alive.current && generation.current === version && !controller.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Could not finish the conversation. Try again.');
        setMessage(clean);
      }
    } finally {
      if (generation.current === version) {
        pendingRef.current = false;
        chatAbort.current = null;
        if (alive.current) setPending(false);
      }
    }
  }
  const latest = [...lines].reverse().find(line => line.replyId),
    chatReady = !!status?.chat.ready;
  return (
    <div className="npc-dialogue">
      <aside className="npc-character-card">
        <NpcPortrait npcId={npc.id} />
        <span className="npc-nameplate">
          <strong>{npc.name}</strong>
          <small>{t(npc.role)}</small>
        </span>
        <span className="npc-location">
          <MessageCircle size={13} />
          {t(chatReady ? 'Here to talk' : 'Shop is open')}
        </span>
      </aside>
      <div className="npc-conversation">
        <div
          ref={conversation}
          className="dialogue-lines"
          role="log"
          aria-label={t('Conversation with {name}', {name: npc.name})}
          aria-live="polite"
        >
          {lines.map((line, index) => (
            <div key={index} className={`dialogue-line ${line.role}`}>
              <small>{line.role === 'user' ? t('You') : npc.name}</small>
              <p dir="auto">{line.content}</p>
            </div>
          ))}
          {pending && (
            <div className="dialogue-thinking">
              <LoaderCircle size={14} className="spin" />
              {t('{name} is thinking…', {name: npc.name})}
            </div>
          )}
        </div>
        {!chatReady && (
          <p className="dialogue-availability" role="status">
            {t(status?.chat.reason || statusError || 'Checking dialogue availability…')}{' '}
            {t('You can browse goods and services below.')}
          </p>
        )}
        {error && (
          <p role="alert" className="dialogue-error">
            {t(error)}
          </p>
        )}
        <div className="dialogue-suggestions">
          {suggestions.map(text => (
            <button key={text} disabled={pending || !chatReady} onClick={() => void send(t(text))}>
              {t(text)}
              <ArrowRight size={12} />
            </button>
          ))}
        </div>
        <form
          className="dialogue-compose"
          onSubmit={e => {
            e.preventDefault();
            void send(message);
          }}
        >
          <label className="sr-only" htmlFor="npc-message">
            {t('Message {name}', {name: npc.name})}
          </label>
          <input
            id="npc-message"
            value={message}
            maxLength={600}
            autoComplete="off"
            placeholder={chatReady ? t('Ask {name} something…', {name: npc.name}) : t('AI dialogue unavailable')}
            onChange={e => setMessage(e.target.value)}
            disabled={pending || !chatReady}
          />
          <button aria-label={t('Send message')} disabled={pending || !chatReady || !message.trim()} type="submit">
            <Send size={18} />
          </button>
        </form>
        {audioError && (
          <p role="status" className="dialogue-error">
            {t(audioError)}
          </p>
        )}
        <div className="dialogue-footer">
          <button
            className="button primary"
            onClick={() => {
              player.current?.stop();
              onTrade(npc.cityId);
            }}
          >
            <ShoppingBag size={16} />
            {t('Browse goods & services')}
          </button>
          <div className="dialogue-voice">
            {status?.voice.ready && (
              <>
                <button
                  disabled={!status?.voice.ready}
                  aria-label={t(voice ? 'Turn NPC voice off' : 'Turn NPC voice on')}
                  title={t(voice ? 'Turn voice off' : 'Turn voice on')}
                  onClick={() => {
                    const next = !voice;
                    voiceRef.current = next;
                    setVoice(next);
                    localStorage.setItem('worldo.npcVoice', next ? 'on' : 'off');
                    if (!next) player.current?.stop();
                  }}
                >
                  {voice ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>
                <button
                  className="listen-reply"
                  disabled={!latest?.replyId || !status?.voice.ready}
                  onClick={() => {
                    if (audioState !== 'idle') player.current?.stop();
                    else if (latest?.replyId) void speak(latest.replyId);
                  }}
                >
                  {t(audioState === 'loading' ? 'Cancel voice' : audioState === 'playing' ? 'Stop voice' : 'Listen')}
                </button>
              </>
            )}
            <small>
              {status?.chat.scripted
                ? t('Offline mayor replies')
                : t(latest ? 'NEAR AI dialogue' : chatReady ? 'NEAR AI ready' : 'AI unavailable')}
              {status?.voice.ready ? ` · ${t('ElevenLabs voice')}` : ''}
            </small>
          </div>
        </div>
      </div>
    </div>
  );
}
