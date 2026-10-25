import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStory } from '../../services/api';
import { fetchLearningSessions, loadStepProgress } from '../../services/learningApi';
import { stepPath } from '../../config/stepPath';
import { BABIES, OPENING, STOPS } from './island/islandData';
import { createIslandWorld } from './island/createIslandWorld';

interface LessonData {
  title: string;
  stepSequence?: string[];
}

type World = ReturnType<typeof createIslandWorld>;

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
  const [module, setModule] = useState<number | null>(null);
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: -3, z: 15 });
  const stickOrigin = useRef<{ x: number; y: number } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageKey = `reading-island-visited:${user?.id ?? 'guest'}:${storyId}`;
  const student = user?.roles.some((role) => role.role_name === 'student') ?? false;
  const sequence = useMemo(() => lesson?.stepSequence ?? [], [lesson]);
  const stepFor = useCallback((index: number) => sequence.find((id) => id.split('#')[0] === STOPS[index].step), [sequence]);
  const doneIndexes = useMemo(() => STOPS.flatMap((_, index) => {
    const step = stepFor(index);
    return step && (completed.includes(step) || visited.includes(step)) ? [index] : [];
  }), [stepFor, completed, visited]);
  // 一區全部讀完才散開下一區的霧：沒去過的地方保持神秘
  const zoneDone = (zone: number) => STOPS.every((stop, index) => stop.zone !== zone || doneIndexes.includes(index));
  const unlockedZone = zoneDone(0) ? (zoneDone(1) ? 2 : 1) : 0;
  const nextIndex = STOPS.findIndex((_, index) => !doneIndexes.includes(index));
  const [mode, setMode] = useState<'first' | 'god'>('first');
  const [hovered, setHovered] = useState<number | null>(null);
  const [guide, setGuide] = useState('');
  const prevDone = useRef(0);

  useEffect(() => {
    try { setVisited(JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as string[]); } catch { setVisited([]); }
  }, [storageKey]);

  useEffect(() => {
    if (storyId !== '20011' || !student) return;
    let alive = true;
    fetchStory(storyId).then((story) => {
      if (alive) setLesson({ title: story.title, stepSequence: story.stepSequence });
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
    if (!host || !student || storyId !== '20011') return;
    const world = createIslandWorld(host, {
      onNear: setNear,
      onFogEdge: () => {
        setFogHint(true);
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setFogHint(false), 2500);
      },
      onMove: (x, z) => setPosition({ x, z }),
      onHover: setHovered,
    });
    worldRef.current = world;
    return () => {
      world.dispose();
      worldRef.current = null;
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, [student, storyId]);

  useEffect(() => { worldRef.current?.setProgress(unlockedZone, doneIndexes); }, [unlockedZone, doneIndexes]);
  useEffect(() => { worldRef.current?.setMode(mode); }, [mode]);
  useEffect(() => {
    if (doneIndexes.length > prevDone.current && prevDone.current > 0 || (doneIndexes.length > 0 && prevDone.current === 0 && module === null && opening < 0)) {
      const zoneOpened = nextIndex >= 0 && STOPS.every((stop, i) => stop.zone !== STOPS[nextIndex].zone || !doneIndexes.includes(i));
      setGuide(nextIndex < 0 ? '整座島都亮起來了！' : `${zoneOpened ? '迷霧散開了！' : ''}跟著金色光柱，下一站：${STOPS[nextIndex].name}`);
      const timer = setTimeout(() => setGuide(''), 7000);
      prevDone.current = doneIndexes.length;
      return () => clearTimeout(timer);
    }
    prevDone.current = doneIndexes.length;
  }, [doneIndexes, nextIndex, module, opening]);
  useEffect(() => { worldRef.current?.setPaused(module !== null || opening >= 0); }, [module, opening]);

  const openModule = (index: number) => {
    if (!stepFor(index)) { setError('這個平台關卡尚未提供'); return; }
    setModule(index);
  };
  const returnToIsland = async () => {
    const index = module;
    setModule(null);
    const reliable = await refreshProgress();
    if (index !== null && !reliable) {
      const step = stepFor(index);
      if (step) setVisited((previous) => {
        const next = [...new Set([...previous, step])];
        sessionStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    }
  };
  const onStickMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!stickOrigin.current) return;
    const x = Math.max(-1, Math.min(1, (event.clientX - stickOrigin.current.x) / 46));
    const y = Math.max(-1, Math.min(1, (event.clientY - stickOrigin.current.y) / 46));
    setJoystick({ x, y });
    worldRef.current?.setStick(x, y);
  };
  const releaseStick = () => { stickOrigin.current = null; setJoystick({ x: 0, y: 0 }); worldRef.current?.setStick(0, 0); };

  if (storyId !== '20011') return <main className="grid min-h-screen place-items-center bg-slate-900 text-white">喝采島目前只開放課文 20011</main>;
  if (!student) return <main className="grid min-h-screen place-items-center bg-slate-900 text-white">請使用學生帳號進入喝采島</main>;
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#bbd6dc] font-sans text-[#284650]">
      <div ref={canvasRef} className="absolute inset-0 [&_canvas]:h-full [&_canvas]:w-full" aria-label="喝采島 3D 世界，使用方向鍵或 WASD 移動" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#d1e4e3]/30 via-transparent to-[#0e3440]/25" />
      <header className="absolute left-4 top-4 z-10 max-w-[calc(100vw-8rem)] rounded-2xl border border-white/70 bg-[#f8f2df]/90 px-4 py-3 shadow-xl backdrop-blur-md md:left-7 md:top-7 md:px-6 md:py-4">
        <p className="text-[10px] font-bold tracking-[0.25em] text-[#a87345] md:text-xs">國語四上 · 故事冒險</p>
        <h1 className="font-serif text-2xl font-black tracking-wider md:text-3xl">喝采島</h1>
        <p className="max-w-72 text-xs font-medium text-[#526969] md:text-sm">{lesson?.title ?? '贏得喝采的輸家'} · 掌聲藏在六個詞裡</p>
        <div className="mt-2 flex items-center gap-2 text-xs font-bold"><span>{doneIndexes.length} / 10 座亮燈</span><span className="h-2 w-20 overflow-hidden rounded-full bg-[#d9dfd5]"><span className="block h-full rounded-full bg-amber-500 transition-all" style={{ width: `${doneIndexes.length * 10}%` }} /></span></div>
      </header>
      <div className="absolute right-4 top-4 z-10 rounded-2xl border border-white/60 bg-[#233e4b]/85 px-3 py-2 text-right text-xs font-bold text-[#fff1d0] shadow-lg md:right-7 md:top-7 md:px-4 md:py-3">
        <div>第一幕 · 發生了什麼</div><div className="mt-1 text-[10px] text-white/70">自由探索港口、長廊、劇場</div>
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
      {mode === 'first' && opening < 0 && module === null && <div className={`pointer-events-none absolute left-1/2 top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition ${hovered !== null ? 'scale-150 border-amber-300 bg-amber-200/40' : 'border-white/80'}`} />}
      {hovered !== null && opening < 0 && module === null && <div className="pointer-events-none absolute left-1/2 top-[38%] z-20 -translate-x-1/2 animate-pulse rounded-full border-2 border-amber-200 bg-[#233e4b]/90 px-5 py-2 text-lg font-black text-[#ffe9b8] shadow-[0_0_30px_rgba(255,214,120,0.6)]">{STOPS[hovered].name}{doneIndexes.includes(hovered) ? ' ✓' : hovered === nextIndex ? ' · 下一站' : ''}</div>}
      {guide && <div role="status" className="absolute left-1/2 top-20 z-30 -translate-x-1/2 animate-bounce rounded-2xl border-2 border-amber-200 bg-gradient-to-r from-[#f7d48a] to-[#ffe9b8] px-6 py-3 text-base font-black text-[#3b3018] shadow-[0_0_40px_rgba(255,200,90,0.7)]">{guide}</div>}
      {fogHint && <div role="status" className="absolute bottom-40 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-white bg-[#f6f7f2]/95 px-5 py-3 font-bold shadow-xl">這裡還沒讀到</div>}
      {error && <div role="alert" className="absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-xl bg-[#fff1d8] px-4 py-2 text-sm font-bold shadow-lg" onClick={() => setError('')}>{error}</div>}
      <div className="absolute bottom-5 right-5 z-10 hidden rounded-xl border border-white/60 bg-[#f9f5e9]/85 px-3 py-2 text-[11px] font-bold shadow-lg md:block">位置 {position.x.toFixed(0)}, {position.z.toFixed(0)} · 迷霧 {unlockedZone === 0 ? '未散' : '正散開'}</div>
      <aside className="absolute right-4 top-28 z-10 hidden w-28 flex-col gap-1 rounded-2xl border border-white/60 bg-[#f8f3e5]/85 p-2 text-center shadow-lg lg:flex" aria-label="文字寶寶">
        <p className="text-[11px] font-black">文字寶寶</p>
        {BABIES.map((baby, index) => <div key={baby.name} className="flex items-center gap-1 text-[10px] font-semibold"><img src={`/lab-island/sprites/${baby.art}`} alt="" className={`h-7 w-7 object-contain ${completed.some((step) => step.startsWith(index === 5 ? 'vocab-review' : 'vocab-definition')) ? '' : 'grayscale opacity-60'}`} /><span>{baby.name}</span></div>)}
      </aside>
      {opening >= 0 && (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-[#071d32] p-4 pb-7 text-white md:pb-12">
          <div key={opening} className="absolute inset-0 animate-[islandKenBurns_9s_ease-out_forwards] bg-cover bg-center" style={{ backgroundImage: `url(/lab-island/opening/op${opening + 1}.jpg)` }} />
          <div className="absolute inset-0 bg-gradient-to-t from-[#071d32]/90 via-transparent to-transparent" />
          <style>{'@keyframes islandKenBurns{from{transform:scale(1.02);opacity:.2}12%{opacity:1}to{transform:scale(1.12);opacity:1}}'}</style>
          <div className="relative w-full max-w-2xl rounded-3xl border border-[#f8e5bd]/50 bg-[#142f45]/90 p-6 shadow-2xl backdrop-blur-md md:p-8">
            <div className="mb-3 flex justify-between text-xs font-bold tracking-widest text-[#f5cf91]"><span>{opening + 1} / 6</span><span>{OPENING[opening][0]}</span></div>
            <p className="min-h-16 font-serif text-xl font-bold leading-relaxed md:text-2xl">{OPENING[opening][1]}</p>
            {opening === 5 ? <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => { setOpening(-1); openModule(0); }} className="rounded-xl bg-[#eac78d] px-6 py-3 font-bold text-[#244653]">聽這句</button><button type="button" onClick={() => setOpening(-1)} className="rounded-xl border border-white/70 px-6 py-3 font-bold">直接上岸走</button></div> : <button type="button" onClick={() => setOpening(opening + 1)} className="mt-5 rounded-xl bg-[#eac78d] px-7 py-3 font-bold text-[#244653]">繼續</button>}
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
