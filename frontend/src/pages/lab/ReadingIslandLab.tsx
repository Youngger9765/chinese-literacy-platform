import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStory } from '../../services/api';
import { fetchLearningSessions, loadStepProgress } from '../../services/learningApi';
import { stepPath } from '../../config/stepPath';
import { BABIES_20011, OPENING_20011, STOPS_20011 } from './island/islandData';
import { buildStopsFromSequence, buildOpeningForTitle, buildBabiesForVocabulary } from './island/islandTemplate';
import type { IslandBaby, IslandStop } from './island/islandTemplate';
import { createIslandWorld } from './island/createIslandWorld';
import { parseIslandReturnMessage, shouldMarkVisitedOnReturn } from './island/storyMode';
import IslandListMode from './island/IslandListMode';
import { createIslandAudio, readMuted, writeMuted, type IslandAudio } from './island/islandAudio';

interface LessonData {
  title: string;
  stepSequence?: string[];
  vocabulary?: Array<{ word: string }>;
}

type World = ReturnType<typeof createIslandWorld>;

// 開場插畫上慢慢往上飄的光點（位置、速度、起始時間錯開，看起來不像同一批）
const MOTES = Array.from({ length: 18 }, (_, i) => ({ x: (i * 37) % 100, d: 7 + (i % 5) * 1.6, delay: -((i * 1.3) % 9) }));

export default function ReadingIslandLab() {
  const { storyId = '' } = useParams();
  const { token, user } = useAuth();
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const [visited, setVisited] = useState<string[]>([]);
  const [near, setNear] = useState<number | null>(null);
  const [fogHint, setFogHint] = useState(false);
  const [opening, setOpening] = useState(0);
  // 冷開場：先一個暗畫面，學生點一下才出聲（瀏覽器規定），聲音先到、畫面晚 0.45 秒進來
  const [coldOpen, setColdOpen] = useState(true);
  const [titleReveal, setTitleReveal] = useState(false);
  const audioRef = useRef<IslandAudio | null>(null);
  const [door, setDoor] = useState<number | null>(null);
  const doorRef = useRef(door);
  doorRef.current = door;
  const [muted, setMuted] = useState(() => readMuted(typeof localStorage === 'undefined' ? null : localStorage));
  const [module, setModule] = useState<number | null>(null);
  const moduleRef = useRef(module);
  moduleRef.current = module;
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: -3, z: 15 });
  const stickOrigin = useRef<{ x: number; y: number } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageKey = `reading-island-visited:${user?.id ?? 'guest'}:${storyId}`;
  const student = user?.roles.some((role) => role.role_name === 'student') ?? false;
  const sequence = useMemo(() => lesson?.stepSequence ?? [], [lesson]);
  const isHandmade = storyId === '20011';
  const STOPS = useMemo<IslandStop[]>(
    () => (isHandmade ? STOPS_20011 : buildStopsFromSequence(sequence)),
    [isHandmade, sequence],
  );
  const OPENING = useMemo(
    () => (isHandmade ? OPENING_20011 : buildOpeningForTitle(lesson?.title ?? '')),
    [isHandmade, lesson?.title],
  );
  const BABIES = useMemo<IslandBaby[]>(
    () => (isHandmade ? BABIES_20011 : buildBabiesForVocabulary(lesson?.vocabulary)),
    [isHandmade, lesson?.vocabulary],
  );
  const stepFor = useCallback((index: number) => sequence.find((id) => id.split('#')[0] === STOPS[index].step), [sequence, STOPS]);
  const doneIndexes = useMemo(() => STOPS.flatMap((_, index) => {
    const step = stepFor(index);
    return step && (completed.includes(step) || visited.includes(step)) ? [index] : [];
  }), [stepFor, completed, visited, STOPS]);
  // 一區全部讀完才散開下一區的霧：沒去過的地方保持神秘
  const zoneDone = (zone: number) => STOPS.every((stop, index) => stop.zone !== zone || doneIndexes.includes(index));
  const unlockedZone = zoneDone(0) ? (zoneDone(1) ? 2 : 1) : 0;
  const nextIndex = STOPS.findIndex((_, index) => !doneIndexes.includes(index));
  const [mode, setMode] = useState<'first' | 'god'>('first');
  const [listMode, setListMode] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [guide, setGuide] = useState('');
  const prevDone = useRef(0);

  useEffect(() => {
    try { setVisited(JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as string[]); } catch { setVisited([]); }
  }, [storageKey]);

  useEffect(() => {
    if (!storyId || !student) return;
    let alive = true;
    fetchStory(storyId).then((story) => {
      if (alive) setLesson({ title: story.title, stepSequence: story.stepSequence, vocabulary: story.vocabulary });
    }).catch(() => { if (alive) setError('課文載入失敗，請稍後再試'); });
    return () => { alive = false; };
  }, [storyId, student]);

  const refreshProgress = useCallback(async () => {
    if (!token || !storyId) return false;
    try {
      const sessions = await fetchLearningSessions(token, { story_slug: storyId, limit: 30 });
      const matching = sessions.items.filter((session) => session.story_slug === storyId).sort((a, b) => b.id - a.id);
      if (!matching.length) return false;
      const snapshots = await Promise.all(matching.slice(0, 5).map((session) => loadStepProgress(token, session.id)));
      const steps = [...new Set(snapshots.flatMap((snapshot) => snapshot.step_progress?.steps_completed ?? []))];
      setCompleted(steps);
      return true;
    } catch {
      return false;
    }
  }, [token, storyId]);

  useEffect(() => { void refreshProgress(); }, [refreshProgress]);

  useEffect(() => {
    const host = canvasRef.current;
    if (!host || !student || STOPS.length === 0) return;
    const world = createIslandWorld(host, {
      onNear: setNear,
      onFogEdge: () => {
        setFogHint(true);
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setFogHint(false), 2500);
      },
      onMove: (x, z) => setPosition({ x, z }),
      onHover: setHovered,
      onPick: (index) => { setMode('first'); worldRef.current?.travelTo(index); },
      onWantFirstPerson: () => setMode('first'),
      onArrive: (index) => setNear(index),
    }, { stops: STOPS, babies: BABIES });
    worldRef.current = world;
    return () => {
      world.dispose();
      worldRef.current = null;
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, [student, STOPS, BABIES]);

  useEffect(() => { worldRef.current?.setProgress(unlockedZone, doneIndexes); }, [unlockedZone, doneIndexes]);
  useEffect(() => { worldRef.current?.setMode(mode); }, [mode]);
  useEffect(() => {
    if (doneIndexes.length > prevDone.current && prevDone.current > 0 || (doneIndexes.length > 0 && prevDone.current === 0 && module === null && opening < 0)) {
      const zoneOpened = nextIndex >= 0 && STOPS.every((stop, i) => stop.zone !== STOPS[nextIndex].zone || !doneIndexes.includes(i));
      audioRef.current?.cue('sparkle');
      setGuide(nextIndex < 0 ? '整座島都亮起來了！' : `${zoneOpened ? '迷霧散開了！' : ''}跟著金色光柱，下一站：${STOPS[nextIndex].name}`);
      const timer = setTimeout(() => setGuide(''), 7000);
      prevDone.current = doneIndexes.length;
      return () => clearTimeout(timer);
    }
    prevDone.current = doneIndexes.length;
  }, [doneIndexes, nextIndex, module, opening, STOPS]);
  useEffect(() => { worldRef.current?.setPaused(module !== null || opening >= 0); }, [module, opening]);
  useEffect(() => {
    const audio = createIslandAudio(readMuted(typeof localStorage === 'undefined' ? null : localStorage));
    audioRef.current = audio;
    return () => { audio.dispose(); audioRef.current = null; };
  }, []);
  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    audioRef.current?.setMuted(next);
    writeMuted(typeof localStorage === 'undefined' ? null : localStorage, next);
  };
  const enterIsland = () => {
    audioRef.current?.start();
    window.setTimeout(() => setColdOpen(false), 450);
  };
  // 開場結束：鐘聲、鏡頭從海上空推近到主角、標題飛進來
  const finishOpening = (then?: () => void) => {
    setOpening(-1);
    audioRef.current?.cue('chime');
    worldRef.current?.playIntro();
    setTitleReveal(true);
    window.setTimeout(() => setTitleReveal(false), 3600);
    // 開場鏡頭期間已鎖住移動；保險起見，到時候已經有門開著就不再開
    if (then) window.setTimeout(() => { if (doorRef.current === null && moduleRef.current === null) then(); }, 3300);
  };

  // 進入關卡：先暗場、門從中間打開、光透出來，再打開平台原本的教材
  const openModule = (index: number) => {
    if (!stepFor(index)) { setError('這個平台關卡尚未提供'); return; }
    setDoor(index);
    audioRef.current?.cue('door');
    window.setTimeout(() => setModule(index), 1700);
    window.setTimeout(() => setDoor(null), 2300);
  };
  const returnToIsland = async (finished = false) => {
    const index = module;
    setModule(null);
    const reliable = await refreshProgress();
    if (index !== null && shouldMarkVisitedOnReturn({ finished, reliable })) {
      const step = stepFor(index);
      if (step) setVisited((previous) => {
        const next = [...new Set([...previous, step])];
        sessionStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    }
  };
  // 故事模式：關卡做完由學習頁通知，直接帶回島上（不往下一關走）
  const returnRef = useRef(returnToIsland);
  returnRef.current = returnToIsland;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const parsed = parseIslandReturnMessage(event.data);
      if (parsed) void returnRef.current(parsed.finished);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const onStickMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!stickOrigin.current) return;
    const x = Math.max(-1, Math.min(1, (event.clientX - stickOrigin.current.x) / 46));
    const y = Math.max(-1, Math.min(1, (event.clientY - stickOrigin.current.y) / 46));
    setJoystick({ x, y });
    worldRef.current?.setStick(x, y);
  };
  const releaseStick = () => { stickOrigin.current = null; setJoystick({ x: 0, y: 0 }); worldRef.current?.setStick(0, 0); };

  if (!student) return <main className="grid min-h-screen place-items-center bg-slate-900 text-white">請使用學生帳號進入喝采島</main>;
  if (!lesson || STOPS.length === 0) return <main className="grid min-h-screen place-items-center bg-slate-900 text-white">載入中…</main>;
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#bbd6dc] font-sans text-[#284650]">
      <div ref={canvasRef} className="absolute inset-0 [&_canvas]:h-full [&_canvas]:w-full" aria-label="喝采島 3D 世界，使用方向鍵或 WASD 移動" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#d1e4e3]/30 via-transparent to-[#0e3440]/25" />
      <header className="absolute left-4 top-4 z-10 max-w-[calc(100vw-8rem)] rounded-2xl border border-white/70 bg-[#f8f2df]/90 px-4 py-3 shadow-xl backdrop-blur-md md:left-7 md:top-7 md:px-6 md:py-4">
        <p className="text-[10px] font-bold tracking-[0.25em] text-[#a87345] md:text-xs">國語四上 · 故事冒險</p>
        <h1 className="font-serif text-2xl font-black tracking-wider md:text-3xl">喝采島</h1>
        <p className="max-w-72 text-xs font-medium text-[#526969] md:text-sm">{lesson?.title ?? ''} · {BABIES.length} 個字詞寶寶藏在島上</p>
        <div className="mt-2 flex items-center gap-2 text-xs font-bold"><span>{doneIndexes.length} / {STOPS.length} 座亮燈</span><span className="h-2 w-20 overflow-hidden rounded-full bg-[#d9dfd5]"><span className="block h-full rounded-full bg-amber-500 transition-all" style={{ width: `${(doneIndexes.length / Math.max(1, STOPS.length)) * 100}%` }} /></span></div>
      </header>
      <div className="absolute right-4 top-4 z-10 rounded-2xl border border-white/60 bg-[#233e4b]/85 px-3 py-2 text-right text-xs font-bold text-[#fff1d0] shadow-lg md:right-7 md:top-7 md:px-4 md:py-3">
        <div>第一幕 · 發生了什麼</div><div className="mt-1 text-[10px] text-white/70">自由探索{STOPS.filter((s) => s.zone === 0).map((s) => s.name).join('、')}</div>
      </div>
      <div className="absolute bottom-4 left-4 z-10 hidden rounded-xl border border-white/60 bg-[#f9f5e9]/90 px-4 py-2 text-xs font-semibold shadow-lg md:block">WASD / 方向鍵移動　·　空白鍵跳　·　拖曳旋轉視角</div>
      <div className="absolute bottom-5 left-5 z-10 flex items-end gap-4 md:hidden">
        <div role="group" aria-label="虛擬搖桿" className="relative grid h-28 w-28 touch-none place-items-center rounded-full border-4 border-white/70 bg-[#e9ede5]/65 shadow-2xl" onPointerDown={(event) => { stickOrigin.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={onStickMove} onPointerUp={releaseStick} onPointerCancel={releaseStick}>
          <div className="h-12 w-12 rounded-full border-2 border-white bg-[#517c79] shadow-lg" style={{ transform: `translate(${joystick.x * 36}px, ${joystick.y * 36}px)` }} />
        </div>
        <button type="button" onClick={() => worldRef.current?.jump()} className="mb-2 rounded-full border-2 border-white bg-[#f7da9d] px-4 py-3 text-sm font-bold shadow-lg">跳</button>
      </div>
      {near !== null && module === null && opening < 0 && (
        <div className="absolute bottom-5 left-1/2 z-20 w-[min(92vw,440px)] -translate-x-1/2 rounded-2xl border-2 border-white bg-[#fff9e9]/95 p-4 text-center shadow-2xl md:bottom-9">
          <div className="text-xs font-bold tracking-widest text-[#b7794e]">發現新去處</div>
          <h2 className="mt-1 text-xl font-black">{STOPS[near].name}{doneIndexes.includes(near) ? ' · 已亮燈' : ''}</h2>
          <p className="my-2 text-sm">{STOPS[near].line}</p>
          <button type="button" onClick={() => openModule(near)} className="rounded-xl bg-[#32796e] px-8 py-2 font-bold text-white shadow-md">進入</button>
        </div>
      )}
      <button type="button" onClick={() => setMode(mode === 'first' ? 'god' : 'first')} className="absolute bottom-24 right-4 z-20 rounded-full md:bottom-20 border-2 border-white bg-[#233e4b]/90 px-4 py-2 text-sm font-bold text-[#fff1d0] shadow-lg transition hover:scale-105 active:scale-95 md:right-7">{mode === 'first' ? '展開上帝視角' : '回到第一人稱'}</button>
      {opening < 0 && module === null && door === null && !listMode && (
        <button type="button" aria-label="切換清單模式" onClick={() => setListMode(true)} className="absolute bottom-24 left-4 z-20 rounded-full md:bottom-20 border-2 border-white bg-[#233e4b]/90 px-4 py-2 text-sm font-bold text-[#fff1d0] shadow-lg transition hover:scale-105 active:scale-95 md:left-7">清單模式</button>
      )}
      {listMode && (
        <IslandListMode
          stops={STOPS}
          doneIndexes={doneIndexes}
          unlockedZone={unlockedZone}
          onClose={() => setListMode(false)}
          onEnter={(index) => { setListMode(false); openModule(index); }}
        />
      )}
      {mode === 'first' && opening < 0 && module === null && <div className={`pointer-events-none absolute left-1/2 top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition ${hovered !== null ? 'scale-150 border-amber-300 bg-amber-200/40' : 'border-white/80'}`} />}
      {hovered !== null && opening < 0 && module === null && !titleReveal && <div className="pointer-events-none absolute left-1/2 top-[38%] z-20 -translate-x-1/2 animate-pulse rounded-full border-2 border-amber-200 bg-[#233e4b]/90 px-5 py-2 text-lg font-black text-[#ffe9b8] shadow-[0_0_30px_rgba(255,214,120,0.6)]">{STOPS[hovered].name}{doneIndexes.includes(hovered) ? ' ✓' : hovered === nextIndex ? ' · 下一站' : ''}</div>}
      {guide && <div role="status" className="absolute left-1/2 top-20 z-30 -translate-x-1/2 animate-bounce rounded-2xl border-2 border-amber-200 bg-gradient-to-r from-[#f7d48a] to-[#ffe9b8] px-6 py-3 text-base font-black text-[#3b3018] shadow-[0_0_40px_rgba(255,200,90,0.7)]">{guide}</div>}
      {fogHint && <div role="status" className="absolute bottom-40 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-white bg-[#f6f7f2]/95 px-5 py-3 font-bold shadow-xl">這裡還沒讀到</div>}
      {error && <div role="alert" className="absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-xl bg-[#fff1d8] px-4 py-2 text-sm font-bold shadow-lg" onClick={() => setError('')}>{error}</div>}
      <div className="absolute bottom-5 right-5 z-10 hidden rounded-xl border border-white/60 bg-[#f9f5e9]/85 px-3 py-2 text-[11px] font-bold shadow-lg md:block">位置 {position.x.toFixed(0)}, {position.z.toFixed(0)} · 迷霧 {unlockedZone === 0 ? '未散' : '正散開'}</div>
      <aside className="absolute right-4 top-28 z-10 hidden w-28 flex-col gap-1 rounded-2xl border border-white/60 bg-[#f8f3e5]/85 p-2 text-center shadow-lg lg:flex" aria-label="文字寶寶">
        <p className="text-[11px] font-black">文字寶寶</p>
        {BABIES.map((baby) => <div key={baby.name} className="flex items-center gap-1 text-[10px] font-semibold"><img src={`/lab-island/sprites/${baby.art}`} alt="" className={`h-7 w-7 object-contain ${completed.some((step) => step.startsWith('vocab-definition') || step.startsWith('vocab-review')) ? '' : 'grayscale opacity-60'}`} /><span>{baby.name}</span></div>)}
      </aside>
      {coldOpen && (
        <button type="button" onClick={enterIsland} className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-6 overflow-hidden bg-[#03101c] text-[#f6dca6]" aria-label="點一下，進入喝采島">
          <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[70vw] -translate-x-1/2 animate-[islandBand_3.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-[#ffd98f] to-transparent" aria-hidden />
          {MOTES.slice(0, 10).map((m, i) => <span key={i} className="pointer-events-none absolute h-1 w-1 rounded-full bg-[#ffe3a3] shadow-[0_0_8px_2px_rgba(255,214,140,0.8)]" style={{ left: `${10 + m.x * 0.8}%`, top: `${30 + (i * 13) % 40}%`, animation: `islandGather ${2.4 + (i % 3) * 0.5}s ease-in-out ${i * 0.2}s infinite alternate` }} aria-hidden />)}
          <span className="relative mt-24 animate-pulse font-serif text-lg font-bold tracking-[0.4em]">點一下，進入喝采島</span>
          <span className="relative text-xs tracking-widest text-[#f6dca6]/60">建議開啟聲音</span>
          <style>{'@keyframes islandBand{0%,100%{opacity:.25;transform:translate(-50%,-50%) scaleX(.3)}50%{opacity:1;transform:translate(-50%,-50%) scaleX(1)}}@keyframes islandGather{from{transform:translate(0,0);opacity:.2}to{transform:translate(calc(50vw - 50%),0);opacity:1}}'}</style>
        </button>
      )}
      {titleReveal && (
        <div className="pointer-events-none absolute inset-x-0 top-[22%] z-40 flex flex-col items-center" aria-hidden>
          <div className="animate-[islandTitle_3.6s_ease-out_forwards] text-center">
            <p className="font-serif text-6xl font-black tracking-[0.3em] text-[#fff1cf] drop-shadow-[0_4px_24px_rgba(255,190,90,0.9)] md:text-8xl">喝采島</p>
            <p className="mt-3 text-sm font-bold tracking-[0.5em] text-[#ffe3a3] drop-shadow">贏得喝采的輸家</p>
          </div>
          <div className="mt-2 h-1 w-72 animate-[islandSweep_3.6s_ease-out_forwards] rounded-full bg-gradient-to-r from-transparent via-[#ffd98f] to-transparent" />
          <style>{'@keyframes islandTitle{0%{transform:translateY(60px) scale(.9);opacity:0;letter-spacing:.9em}25%{transform:translateY(0) scale(1);opacity:1;letter-spacing:.3em}80%{opacity:1}100%{opacity:0;transform:translateY(-20px)}}@keyframes islandSweep{0%{transform:scaleX(0);opacity:0}30%{transform:scaleX(1);opacity:1}80%{opacity:1}100%{opacity:0}}'}</style>
        </div>
      )}
      <button type="button" onClick={toggleMuted} className="absolute bottom-[4.5rem] left-4 z-[70] rounded-full border-2 border-white bg-[#233e4b]/85 px-3 py-1.5 text-xs font-bold text-[#fff1d0] shadow-lg" aria-pressed={muted}>{muted ? '聲音：關' : '聲音：開'}</button>
      {opening >= 0 && (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-[#071d32] p-4 pb-7 text-white md:pb-12">
          <div key={opening} className="absolute inset-0 animate-[islandKenBurns_9s_ease-out_forwards] bg-cover bg-center" style={{ backgroundImage: `url(/lab-island/opening/op${opening + 1}.jpg)` }} />
          <div className="absolute inset-0 bg-gradient-to-t from-[#071d32]/90 via-transparent to-transparent" />
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {MOTES.map((m, i) => <span key={i} className="absolute h-1.5 w-1.5 rounded-full bg-[#ffe3a3] shadow-[0_0_10px_3px_rgba(255,214,140,0.7)]" style={{ left: `${m.x}%`, bottom: '-4%', animation: `islandMote ${m.d}s linear ${m.delay}s infinite` }} />)}
          </div>
          <style>{'@keyframes islandMote{0%{transform:translateY(0);opacity:0}15%{opacity:.9}100%{transform:translateY(-105vh) translateX(3vw);opacity:0}}@keyframes islandKenBurns{from{transform:scale(1.02);opacity:.2}12%{opacity:1}to{transform:scale(1.12);opacity:1}}'}</style>
          <div className="relative w-full max-w-2xl rounded-3xl border border-[#f8e5bd]/50 bg-[#142f45]/90 p-6 shadow-2xl backdrop-blur-md md:p-8">
            <div className="mb-3 flex justify-between text-xs font-bold tracking-widest text-[#f5cf91]"><span>{opening + 1} / {OPENING.length}</span><span>{OPENING[opening][0]}</span></div>
            <p className="min-h-16 font-serif text-xl font-bold leading-relaxed md:text-2xl">{OPENING[opening][1]}</p>
            {opening === OPENING.length - 1 ? <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => finishOpening(() => openModule(0))} className="rounded-xl bg-[#eac78d] px-6 py-3 font-bold text-[#244653]">聽這句</button><button type="button" onClick={() => finishOpening()} className="rounded-xl border border-white/70 px-6 py-3 font-bold">直接上岸走</button></div> : <button type="button" onClick={() => { audioRef.current?.cue('whoosh'); setOpening(opening + 1); }} className="mt-5 rounded-xl bg-[#eac78d] px-7 py-3 font-bold text-[#244653]">繼續</button>}
          </div>
        </div>
      )}
      {door !== null && (
        <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden bg-black" aria-hidden>
          <style>{'@keyframes islandDoorL{0%,35%{transform:translateX(0)}100%{transform:translateX(-102%)}}@keyframes islandDoorR{0%,35%{transform:translateX(0)}100%{transform:translateX(102%)}}@keyframes islandDoorGlow{0%,30%{opacity:0;transform:scale(.2)}70%{opacity:1}100%{opacity:1;transform:scale(3)}}@keyframes islandDoorIn{0%{opacity:0}15%{opacity:1}100%{opacity:1}}'}</style>
          <div className="absolute inset-0 animate-[islandDoorIn_2.3s_ease-out_forwards]">
            <div className="absolute left-1/2 top-1/2 h-[60vmin] w-[60vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#fffbe8_0%,#ffd98a_35%,rgba(255,200,110,0)_70%)] animate-[islandDoorGlow_2s_ease-in_forwards]" />
            <div className="absolute inset-y-0 left-0 w-1/2 border-r-4 border-[#c9944f] bg-gradient-to-r from-[#2b1a10] to-[#5a3a22] shadow-[inset_-30px_0_60px_rgba(0,0,0,.6)] animate-[islandDoorL_1.8s_cubic-bezier(.7,0,.3,1)_forwards]"><div className="absolute right-6 top-1/2 h-10 w-3 rounded-full bg-[#e7c27d]" /></div>
            <div className="absolute inset-y-0 right-0 w-1/2 border-l-4 border-[#c9944f] bg-gradient-to-l from-[#2b1a10] to-[#5a3a22] shadow-[inset_30px_0_60px_rgba(0,0,0,.6)] animate-[islandDoorR_1.8s_cubic-bezier(.7,0,.3,1)_forwards]"><div className="absolute left-6 top-1/2 h-10 w-3 rounded-full bg-[#e7c27d]" /></div>
            <p className="absolute bottom-[18%] left-1/2 -translate-x-1/2 font-serif text-3xl font-black tracking-widest text-[#ffe9b8] drop-shadow-[0_0_20px_rgba(255,200,100,.9)]">{STOPS[door].name}</p>
          </div>
        </div>
      )}
      {module !== null && (
        <div className="absolute inset-0 z-40 flex flex-col bg-[#0f2535]">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/20 bg-[#172f40] px-4 text-sm font-bold text-white md:px-6"><span>{STOPS[module].name} · 平台原本的關卡</span><button type="button" onClick={() => void returnToIsland()} className="rounded-lg bg-[#e9c68e] px-4 py-2 text-[#244653]">回到島上</button></div>
          <iframe title={`${STOPS[module].name}學習關卡`} src={stepPath(storyId, stepFor(module) ?? '')} className="h-full w-full flex-1 border-0 bg-white" />
        </div>
      )}
    </main>
  );
}
