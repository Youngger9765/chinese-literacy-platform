import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStory } from '../../services/api';
import { fetchLearningSessions, loadStepProgress } from '../../services/learningApi';
import { stepPath } from '../../config/stepPath';
import { BABIES_20011, OPENING_20011, STOPS_20011 } from './island/islandData';
import { buildStopsFromSequence, buildOpeningForTitle, buildBabiesForVocabulary, actInfoForZone } from './island/islandTemplate';
import type { IslandBaby, IslandStop } from './island/islandTemplate';
import { createIslandWorld } from './island/createIslandWorld';
import { parseIslandReturnMessage, shouldMarkVisitedOnReturn } from './island/storyMode';
import IslandListMode from './island/IslandListMode';
import { createIslandAudio, readMuted, writeMuted, type IslandAudio } from './island/islandAudio';
import { isCoarsePointerDevice, isFinePointerDevice } from './island/inputMode';

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
  const navigate = useNavigate();
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
  // #3780 P0-1（playtest 2026-10-26）：原本用 `md:hidden` 的螢幕寬度斷點判斷
  // 「是不是手機」——iPad（820px 寬）被歸類成桌機，搖桿被藏起來，畫面卻顯示
  // 鍵盤操作提示「WASD / 方向鍵移動」，孩子在 iPad 上完全走不動。改成在
  // mount 時只判斷一次「輸入方式」（觸控 vs 滑鼠鍵盤），不隨螢幕寬度變。
  const [isTouchInput] = useState(() => isCoarsePointerDevice());
  // #3780 P0-1 退件（審查員）：觸控 Chromebook 這種混合裝置 `isTouchInput`
  // 會是 true（確實有觸控螢幕），但同時也接了滑鼠／觸控板，鍵盤照樣能用，
  // 只是沒有提示告訴學生。`isFineInput` 獨立判斷「有沒有精準輸入裝置」，
  // 跟 isTouchInput 不是互斥——混合裝置兩個提示都要顯示。
  const [isFineInput] = useState(() => isFinePointerDevice());
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
  // 右上角「第一幕」資訊卡要跟著 unlockedZone 走，不能永遠釘在 zone 0
  // （team-lead 2026-10-26 截圖抓到：全島亮完還是顯示「第一幕」）。
  const actInfo = actInfoForZone(unlockedZone, STOPS);
  const nextIndex = STOPS.findIndex((_, index) => !doneIndexes.includes(index));
  const [mode, setMode] = useState<'first' | 'god'>('first');
  const [listMode, setListMode] = useState(false);
  const [showActInfo, setShowActInfo] = useState(false); // 手機版「第一幕」卡片收合狀態
  const [hovered, setHovered] = useState<number | null>(null);
  const [guide, setGuide] = useState('');
  // 全島亮完那一刻的光柱／粒子效果——只短暫播放一次，不是常駐動畫
  // （結尾慶祝層本身用 finaleOpen 控制開關，見下方 JSX；這個只管那陣視覺flourish）。
  const [finaleBurst, setFinaleBurst] = useState(false);
  // 結尾慶祝全螢幕層開關（審查員 2026-10-26 二次審查訂正：原本用 isFinale 這個
  // 衍生值直接常駐顯示一張卡片，沒有「關掉」的概念，玩家按「回遊戲區」以外沒有
  // 別的路離開；改成獨立 state，可以用「留在島上看看」關掉，關掉後不會自己又
  // 跳出來）。
  const [finaleOpen, setFinaleOpen] = useState(false);
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
    // `lesson` 在 deps 裡是必要的，不是多餘的：20011 走手刻覆蓋分支時，STOPS/BABIES
    // 在 `lesson` 還沒載入（`fetchStory` resolve 之前）就已經是 STOPS_20011/
    // BABIES_20011 這兩個穩定參照，值不會因為 `lesson` 從 null 變成真正的課程資料
    // 而改變。但上面的 `if (!lesson || STOPS.length === 0) return <main>載入中…` 這個
    // render-gate 在 `lesson` 還是 null 時完全不渲染 `<div ref={canvasRef}>`，所以
    // 這個 effect 第一次執行時 `host` 一定是 null、提早 return。如果 deps 只有
    // `[student, STOPS, BABIES]`，`lesson` 從 null 變成真正資料的那次重新渲染，
    // 三個 deps 的值完全沒變（同一顆 STOPS_20011 參照），effect 不會重跑，canvasRef
    // 雖然這時候已經真的掛上 DOM，但再也沒有人去建立 3D 世界——整頁看起來正常、
    // 沒有任何錯誤，只是畫布永遠是空的。資料來得快（fetchStory 命中快取/熱啟動）
    // 時這個 race 不會發生，所以不是每次都能重現。
  }, [student, STOPS, BABIES, lesson]);

  useEffect(() => { worldRef.current?.setProgress(unlockedZone, doneIndexes); }, [unlockedZone, doneIndexes]);
  useEffect(() => { worldRef.current?.setMode(mode); }, [mode]);
  useEffect(() => {
    // 兩種情況都要處理，但結尾慶祝只能在第一種發生：
    // ① justCompletedWithinSession：這次 session 裡親眼看著完成數字往上跳
    //    （`prevDone.current > 0` 代表之前至少量過一次「還沒全部做完」）。
    // ② justMountedAlreadyDone：掛載當下 `refreshProgress()` 一回來就直接
    //    報告「全部做完」——`prevDone.current` 還是初始值 0，不代表「剛剛
    //    完成」，只是「本來就是這樣」。
    // 審查員 2026-10-26 二次審查抓到：原本的條件把這兩種混在一起判斷，
    // 重新整理一座早就全亮的島、或退出又回來，都會被誤判成「剛完成」，
    // 鐘聲跟光柱/粒子又放一次。結尾慶祝只能用 ① 觸發。
    const justCompletedWithinSession = doneIndexes.length > prevDone.current && prevDone.current > 0;
    const justMountedAlreadyDone = doneIndexes.length > 0 && prevDone.current === 0 && module === null && opening < 0;
    if (justCompletedWithinSession || justMountedAlreadyDone) {
      if (nextIndex < 0) {
        if (!justCompletedWithinSession) {
          // 掛載時就已經全部完成：安靜記錄進度，不重播鐘聲/光柱/慶祝層。
          prevDone.current = doneIndexes.length;
          return undefined;
        }
        // 清掉上一條還沒消失的提示（例如「迷霧散開了」）：避免跟剛打開的
        // 慶祝層同時出現一團字（雖然慶祝層現在是全螢幕蓋住一切，理論上
        // 不會疊到，但提示框本身還留著等 7 秒自己消失也很奇怪）。
        setGuide('');
        audioRef.current?.cue('chime');
        setFinaleOpen(true);
        setFinaleBurst(true);
        const timer = setTimeout(() => setFinaleBurst(false), 3600);
        prevDone.current = doneIndexes.length;
        return () => clearTimeout(timer);
      }
      const zoneOpened = STOPS.every((stop, i) => stop.zone !== STOPS[nextIndex].zone || !doneIndexes.includes(i));
      audioRef.current?.cue('sparkle');
      setGuide(`${zoneOpened ? '迷霧散開了！' : ''}跟著金色光柱，下一站：${STOPS[nextIndex].name}`);
      const timer = setTimeout(() => setGuide(''), 7000);
      prevDone.current = doneIndexes.length;
      return () => clearTimeout(timer);
    }
    prevDone.current = doneIndexes.length;
    return undefined;
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
    // 防護：已經在開門或已經在關卡裡，再呼叫一次直接忽略（team-lead
    // 2026-10-26 明令）。沒有這道防護時，3D 世界在開門動畫期間
    // （door !== null、module 還是 null）仍然沒被 setPaused 暫停，
    // 學生可以移動到別站、對它的「進入」卡片或清單再點一次——會疊出
    // 第二組 1700ms/2300ms 的 setTimeout，兩個 setModule 最後都會觸發，
    // 時間較晚的那次蓋過先點的那一站，實際打開的會是「別站」不是先點的。
    if (doorRef.current !== null || moduleRef.current !== null) return;
    if (!stepFor(index)) { setError('這個平台關卡尚未提供'); return; }
    setDoor(index);
    audioRef.current?.cue('door'); // 門聲先播——這時 context 還沒暫停
    // 門真的打開、iframe 出現的時候才暫停環境音（team-lead 2026-10-26 明令）：
    // 學生要專心讀課文，而「重點朗讀」那一關會錄音，海浪跟底墊和弦被錄進去
    // 會影響朗讀評分。放在 setModule 同一個 timeout，不要提早到 openModule
    // 一開始就暫停——提早暫停會連上面那句「door」音效都被 ctx.suspend() 悶掉。
    window.setTimeout(() => { setModule(index); audioRef.current?.pause(); }, 1700);
    window.setTimeout(() => setDoor(null), 2300);
  };
  const returnToIsland = async (finished = false) => {
    const index = module;
    setModule(null);
    audioRef.current?.resume(); // 回到島上：恢復環境音（尊重學生目前的靜音狀態）
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
      {/* 標題卡 + 工具列（清單模式/聲音）共用一個 flex-col 容器——team-lead
          2026-10-26 二次訂正：原本工具列在手機版用 `top-40` 這種猜出來的像素
          數字卡在標題卡下方，`islandPanelOverlap.spec.ts` 證明了這個數字會
          過期：範本模式下任何一課都會長出自己的島，課名長度不同、標題卡
          高度就會不同（字幕可能多繞一行），猜出來的緩衝遲早又被吃掉。改成
          讓工具列真的「排在標題卡下面」而不是「蓋一個夠高的座標」——手機版
          這個外層 div 是真的 `flex flex-col`，工具列不再自己 `absolute` 定
          位，不管標題卡多高都會自動被推到它下面。
          桌機/iPad（≥768px）兩者本來就不相鄰（標題卡在左上、工具列在左下），
          用 `md:contents` 讓這層外殼在那個斷點直接消失，不產生任何版面效果，
          裡面兩個元素各自用自己的 `md:absolute md:...` 回到原本的位置
          （跟這層外殼的 flex 完全無關）。*/}
      <div className="absolute left-4 top-4 flex flex-col items-start gap-3 md:contents">
        <header aria-label="喝采島標題卡" className="relative z-10 max-w-[calc(100vw-8rem)] rounded-2xl border border-white/70 bg-[#f8f2df]/90 px-4 py-3 shadow-xl backdrop-blur-md md:absolute md:left-7 md:top-7 md:px-6 md:py-4">
          <p className="text-[10px] font-bold tracking-[0.25em] text-[#a87345] md:text-xs">國語四上 · 故事冒險</p>
          <h1 className="font-serif text-2xl font-black tracking-wider md:text-3xl">喝采島</h1>
          <p className="max-w-72 text-xs font-medium text-[#526969] md:text-sm">{lesson?.title ?? ''} · {BABIES.length} 個字詞寶寶藏在島上</p>
          <div className="mt-2 flex items-center gap-2 text-xs font-bold"><span>{doneIndexes.length} / {STOPS.length} 座亮燈</span><span className="h-2 w-20 overflow-hidden rounded-full bg-[#d9dfd5]"><span className="block h-full rounded-full bg-amber-500 transition-all" style={{ width: `${(doneIndexes.length / Math.max(1, STOPS.length)) * 100}%` }} /></span></div>
        </header>
        {/* 「第一幕」劇情說明——手機版（<768px）第三次訂正：原本是獨立
            `absolute right-4 top-4`、跟標題卡各佔一角，但展開狀態的卡片
            `max-w-[calc(100vw-8rem)]` 幾乎吃滿整個寬度，390px 螢幕上
            右上角一展開就蓋到左上角的標題卡（量到交集 1295~1552px²，課名
            越長標題卡越高、重疊越大）。跟標題卡、工具列一樣收進同一個
            flex-col，收合或展開都只會把下面的元素往下推，不會再跟標題卡
            搶同一塊畫面。桌機/iPad 維持原本右上角常駐卡片，不受影響。*/}
        <div className="md:hidden">
          {showActInfo ? (
            <div aria-label="劇情說明卡" className="relative z-10 max-w-[calc(100vw-8rem)] rounded-2xl border border-white/60 bg-[#233e4b]/90 px-3 py-2 text-left text-xs font-bold text-[#fff1d0] shadow-lg">
              <button type="button" aria-label="收合劇情說明" onClick={() => setShowActInfo(false)} className="mb-1 text-[10px] font-normal underline underline-offset-2">收合</button>
              <div>{actInfo.actName} · 發生了什麼</div>
              <div className="mt-1 text-[10px] text-white/70">自由探索{actInfo.stationNames}</div>
            </div>
          ) : (
            <button type="button" aria-label="展開劇情說明" onClick={() => setShowActInfo(true)} className="relative z-10 rounded-full border border-white/60 bg-[#233e4b]/85 px-3 py-1.5 text-xs font-bold text-[#fff1d0] shadow-lg">{actInfo.actName}</button>
          )}
        </div>
        {opening < 0 && (
          <div aria-label="工具列" className="relative z-20 flex flex-col items-start gap-2 md:absolute md:left-7 md:bottom-28">
            {module === null && door === null && !listMode && (
              <button type="button" aria-label="切換清單模式" onClick={() => setListMode(true)} className="rounded-full border-2 border-white bg-[#233e4b]/90 px-4 py-2 text-sm font-bold text-[#fff1d0] shadow-lg transition hover:scale-105 active:scale-95">清單模式</button>
            )}
            <button type="button" onClick={toggleMuted} className="rounded-full border-2 border-white bg-[#233e4b]/85 px-3 py-1.5 text-xs font-bold text-[#fff1d0] shadow-lg" aria-pressed={muted}>{muted ? '聲音：關' : '聲音：開'}</button>
          </div>
        )}
        {/* 「下一站」/「迷霧散開了」提示——第三次訂正（審查員 2026-10-26）：
            原本跟桌機版共用 `absolute left-1/2 top-20` 置中，手機版左欄現在
            疊了標題卡＋劇情說明＋工具列三層，高度隨課名長度變動，量到實際
            會長到 y≈263，跟 top-20（80px）那條固定線重疊。改成跟標題卡／
            劇情說明／工具列收進同一個 flex-col：不管左欄多高，這則提示永遠
            排在最下面，不用猜任何像素。桌機/iPad 版維持原本獨立置中的位置
            （那裡從沒被抓到過重疊，不用跟著改）。*/}
        {guide && <div role="status" className="relative z-30 max-w-[calc(100vw-2rem)] animate-bounce rounded-2xl border-2 border-amber-200 bg-gradient-to-r from-[#f7d48a] to-[#ffe9b8] px-5 py-2.5 text-sm font-black text-[#3b3018] shadow-[0_0_40px_rgba(255,200,90,0.7)] md:hidden">{guide}</div>}
      </div>
      {/* 桌機/iPad 右上角常駐「第一幕」卡片——獨立 DOM 節點，不受上面那層
          flex-col 影響，維持原本位置不變。*/}
      <div aria-label="劇情說明卡" className="absolute right-4 top-4 z-10 hidden rounded-2xl border border-white/60 bg-[#233e4b]/85 px-3 py-2 text-right text-xs font-bold text-[#fff1d0] shadow-lg md:right-7 md:top-7 md:block md:px-4 md:py-3">
        <div>{actInfo.actName} · 發生了什麼</div><div className="mt-1 text-[10px] text-white/70">自由探索{actInfo.stationNames}</div>
      </div>
      {/* 桌機/iPad 版「下一站」提示：維持原本獨立置中位置，不受手機版那層
          flex-col 影響。*/}
      {guide && <div role="status" className="absolute left-1/2 top-20 z-30 hidden -translate-x-1/2 animate-bounce rounded-2xl border-2 border-amber-200 bg-gradient-to-r from-[#f7d48a] to-[#ffe9b8] px-6 py-3 text-base font-black text-[#3b3018] shadow-[0_0_40px_rgba(255,200,90,0.7)] md:block">{guide}</div>}
      {/* #3780 P0-1（退件後第三版，審查員 2026-10-26）：原本用 `md:hidden` /
          `md:block`（螢幕寬度）二選一，第一版改成用 `isTouchInput`（輸入方式）
          二選一，第二版把兩個提示＋搖桿收進同一個 flex-col（解決了「兩個
          提示疊在一起」）——但 flex-col 本身沒有寬度上限，混合裝置在手機
          390px 寬時 WASD 那行長文字撐到 324px 寬，跟右下角「展開上帝視角」
          橫向重疊 3601px²。team-lead 明令不要再猜 `max-w-[calc(...)]` 這種
          像素數字（同一個檔案第四次犯）——改成讓兩邊共用同一條 flex row：
          操作提示給 `min-w-0 flex-1`（flex item 預設 `min-width:auto` 不會
          縮小到比內容窄，沒有 `min-w-0` 就無法觸發文字換行；`flex-1` 讓它
          只佔「扣掉展開上帝視角按鈕之後」的剩餘寬度），展開上帝視角給
          `shrink-0`（固定寬度不被擠壓），`justify-between` 把兩邊推到各自
          的邊——不管文字多長，可用寬度有限，瀏覽器自己換行，兩邊各自佔
          各自的空間，不會疊。*/}
      <div className="absolute inset-x-4 bottom-4 z-20 flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          {/* #3780 e2e panel-overlap 退件修正：`aria-label="操作提示"` 原本
              貼在整個外層容器（連搖桿/跳都包在裡面），panel-overlap 測試把
              它當一塊面板去跟「虛擬搖桿」「跳」比對 boundingBox，量到的
              「重疊」其實是父子包含關係，不是真的視覺衝突——縮小到只包文字
              提示本身，才是測試真正該比對的那塊。*/}
          <div aria-label="操作提示" className="flex flex-col items-start gap-2">
            {(!isTouchInput || isFineInput) && (
              <div className="rounded-xl border border-white/60 bg-[#f9f5e9]/90 px-4 py-2 text-xs font-semibold shadow-lg">WASD / 方向鍵移動　·　空白鍵跳　·　拖曳旋轉視角</div>
            )}
            {isTouchInput && (
              <div className="rounded-xl border border-white/60 bg-[#f9f5e9]/90 px-4 py-2 text-xs font-semibold shadow-lg">用搖桿走、拖曳轉頭</div>
            )}
          </div>
          {isTouchInput && (
            <div className="flex items-end gap-4">
              <div role="group" aria-label="虛擬搖桿" className="relative grid h-28 w-28 touch-none place-items-center rounded-full border-4 border-white/70 bg-[#e9ede5]/65 shadow-2xl" onPointerDown={(event) => { stickOrigin.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={onStickMove} onPointerUp={releaseStick} onPointerCancel={releaseStick}>
                <div className="h-12 w-12 rounded-full border-2 border-white bg-[#517c79] shadow-lg" style={{ transform: `translate(${joystick.x * 36}px, ${joystick.y * 36}px)` }} />
              </div>
              <button type="button" onClick={() => worldRef.current?.jump()} className="mb-2 rounded-full border-2 border-white bg-[#f7da9d] px-4 py-3 text-sm font-bold shadow-lg">跳</button>
            </div>
          )}
        </div>
        <button type="button" onClick={() => setMode(mode === 'first' ? 'god' : 'first')} className="shrink-0 rounded-full border-2 border-white bg-[#233e4b]/90 px-4 py-2 text-sm font-bold text-[#fff1d0] shadow-lg transition hover:scale-105 active:scale-95">{mode === 'first' ? '展開上帝視角' : '回到第一人稱'}</button>
      </div>
      {near !== null && module === null && opening < 0 && (
        <div className="absolute bottom-5 left-1/2 z-20 w-[min(92vw,440px)] -translate-x-1/2 rounded-2xl border-2 border-white bg-[#fff9e9]/95 p-4 text-center shadow-2xl md:bottom-9">
          <div className="text-xs font-bold tracking-widest text-[#b7794e]">發現新去處</div>
          <h2 className="mt-1 text-xl font-black">{STOPS[near].name}{doneIndexes.includes(near) ? ' · 已亮燈' : ''}</h2>
          <p className="my-2 text-sm">{STOPS[near].line}</p>
          {/* disabled 是 UI 層的防呆，真正擋重複開站的是 openModule 自己
              的 doorRef/moduleRef 檢查——兩層都做：這顆按鈕本來就不該讓人
              以為點了有用（team-lead 2026-10-26 明令）。*/}
          <button type="button" disabled={door !== null} onClick={() => openModule(near)} className="rounded-xl bg-[#32796e] px-8 py-2 font-bold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50">進入</button>
        </div>
      )}
      {/* 聲音：開場／旁白期間的特例位置（team-lead 2026-10-26 二次審查訂正）。
          ⚠️ 第一版把這段時間的「聲音」整個拿掉，被退回——z-[70] 不是順手加的，
          是上一輪審查特地要求的：冷開場「建議開啟聲音」之後、旁白播放期間
          （海浪／和弦／咻聲）正是學生最需要關掉聲音的時候（例如在教室裡），
          不能因為跟「繼續」重疊就連功能一起拿掉，要移位置不是刪掉。
          右上角（right-4/top-4，跟桌機/iPad 的「第一幕」資訊卡同座標）這段
          期間不會撞到東西：冷開場（z-60）跟旁白全螢幕遮罩（z-30，不透明
          底色）都會把「第一幕」資訊卡（z-10）整個蓋住，所以兩者視覺上從不
          同時出現；旁白對話框本身用 `items-end justify-center`，上緣是淨空的。*/}
      {(coldOpen || opening >= 0) && (
        <button type="button" onClick={toggleMuted} className="absolute right-4 top-4 z-[70] rounded-full border-2 border-white bg-[#233e4b]/85 px-3 py-1.5 text-xs font-bold text-[#fff1d0] shadow-lg md:right-7 md:top-7" aria-pressed={muted}>{muted ? '聲音：關' : '聲音：開'}</button>
      )}
      {listMode && (
        <IslandListMode
          stops={STOPS}
          doneIndexes={doneIndexes}
          unlockedZone={unlockedZone}
          disabled={door !== null}
          onClose={() => setListMode(false)}
          onEnter={(index) => { setListMode(false); openModule(index); }}
        />
      )}
      {mode === 'first' && opening < 0 && module === null && <div className={`pointer-events-none absolute left-1/2 top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition ${hovered !== null ? 'scale-150 border-amber-300 bg-amber-200/40' : 'border-white/80'}`} />}
      {hovered !== null && opening < 0 && module === null && !titleReveal && <div className="pointer-events-none absolute left-1/2 top-[38%] z-20 -translate-x-1/2 animate-pulse rounded-full border-2 border-amber-200 bg-[#233e4b]/90 px-5 py-2 text-lg font-black text-[#ffe9b8] shadow-[0_0_30px_rgba(255,214,120,0.6)]">{STOPS[hovered].name}{doneIndexes.includes(hovered) ? ' ✓' : hovered === nextIndex ? ' · 下一站' : ''}</div>}
      {/* 結尾慶祝（#3780 §3「全島亮完→結尾」）——審查員 2026-10-26 二次審查
          訂正：原本沿用 `guide` 那個 top-20 置中位置常駐顯示，手機版左欄
          （標題卡＋劇情說明＋工具列）量到實際高度會長到 y≈263，跟 top-20
          整個疊在一起（交集 8315px²）。改成全螢幕慶祝層（遮罩＋置中卡片）
          ——蓋住整個 HUD 本來就是設計上要的效果，不是重疊 bug，不用再去找
          一個「夾縫」座標。光柱／粒子只播 `finaleBurst` 那 3.6 秒，卡片跟
          兩顆按鈕常駐到玩家自己關掉或離開。*/}
      {finaleOpen && module === null && (
        <div role="dialog" aria-label="結尾慶祝" className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/60 p-4">
          {finaleBurst && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <div className="absolute left-1/2 top-0 h-full w-24 -translate-x-1/2 bg-gradient-to-b from-[#fff6da] via-[#ffe3a3]/50 to-transparent animate-[islandFinaleBeam_3.6s_ease-out_forwards]" />
              {MOTES.map((m, i) => <span key={i} className="absolute h-1.5 w-1.5 rounded-full bg-[#ffe9b8] shadow-[0_0_12px_4px_rgba(255,220,150,0.8)]" style={{ left: `${m.x}%`, bottom: '-4%', animation: `islandFinaleMote ${Math.max(1.8, m.d * 0.5)}s ease-out ${m.delay}s 1` }} />)}
              <style>{'@keyframes islandFinaleBeam{0%{opacity:0;transform:scaleY(.1)}20%{opacity:1}75%{opacity:1}100%{opacity:0;transform:scaleY(1)}}@keyframes islandFinaleMote{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(-105vh) translateX(2vw);opacity:0}}'}</style>
            </div>
          )}
          <div className="relative w-full max-w-sm rounded-3xl border-2 border-amber-200 bg-gradient-to-r from-[#f7d48a] to-[#ffe9b8] p-6 text-center shadow-[0_0_60px_rgba(255,200,90,0.8)]">
            <p className="text-lg font-black text-[#3b3018]">整座島都亮起來了！</p>
            <p className="mt-1 text-xs font-semibold text-[#6b5a2e]">{lesson?.title ?? '這篇課文'}，你全部讀完了</p>
            <div className="mt-4 flex flex-col gap-2">
              <button type="button" onClick={() => navigate('/game-hub')} className="rounded-full bg-[#244653] px-6 py-3 text-sm font-bold text-white shadow-md active:scale-95">回遊戲區</button>
              <button type="button" onClick={() => setFinaleOpen(false)} className="rounded-full border border-[#244653]/50 px-6 py-2 text-sm font-bold text-[#244653] active:scale-95">留在島上看看</button>
            </div>
          </div>
        </div>
      )}
      {fogHint && <div role="status" className="absolute bottom-40 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-white bg-[#f6f7f2]/95 px-5 py-3 font-bold shadow-xl">這裡還沒讀到</div>}
      {error && <div role="alert" className="absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-xl bg-[#fff1d8] px-4 py-2 text-sm font-bold shadow-lg" onClick={() => setError('')}>{error}</div>}
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
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/20 bg-[#172f40] px-4 text-sm font-bold text-white md:px-6"><span>{STOPS[module].name}</span><button type="button" onClick={() => void returnToIsland()} className="rounded-lg bg-[#e9c68e] px-4 py-2 text-[#244653]">回到島上</button></div>
          <iframe title={`${STOPS[module].name}學習關卡`} src={stepPath(storyId, stepFor(module) ?? '')} className="h-full w-full flex-1 border-0 bg-white" />
        </div>
      )}
    </main>
  );
}
