import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Play, QrCode, Square } from 'lucide-react';
// Static, top-level, literal specifier — this is what makes Vite bundle the
// library. Do not turn this back into a dynamic import with the module name in
// a variable; that silently drops it from the bundle (see qrCodeToDataUrl).
import QRCode from 'qrcode';
import { useAuth } from '../../../contexts/AuthContext';
import { useTtsPlayback } from '../../../hooks/useTtsPlayback';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

type LessonQrStep = 'intro' | 'full-reading';
type AudioMode = 'full' | 'key';

interface StoryListItem {
  id: number;
  lesson_number: number;
  title: string;
  grade: number;
  grade_code: string;
  char_count: number;
  has_key_reading: boolean;
}

interface StoryListResponse {
  stories: StoryListItem[];
  total: number;
}

interface StoryDetailResponse {
  paragraphs?: string[];
  content?: string[];
  key_reading?: { passage?: string | null } | null;
}

interface QrButtonProps {
  lessonId: number;
  step: LessonQrStep;
  label: string;
  filePrefix: string;
}

function getAuthHeaders(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function lessonTitle(story: StoryListItem): string {
  return `L${String(story.lesson_number).padStart(2, '0')}`;
}

export type PlaybackState = 'idle' | 'working' | 'playing';

/**
 * Pure derivation of a single row-button's playback state.
 *
 * `activeKey` is this component's own record of which `{storyId}:{mode}` it
 * last targeted; `isFetchingDetail` covers the pre-audio `/api/stories/{id}`
 * round trip (this component's own state); `isTtsLoading`/`isTtsSpeaking`
 * come straight from useTtsPlayback and reflect what the browser's actual
 * <audio> element (or Web Speech fallback) is really doing.
 *
 * `working` covers both the detail fetch and the hook's isTtsLoading window
 * (speakText() called, no audio byte yet) — from the user's point of view
 * both look identical (a spinner, no sound), so they are not split further.
 * `playing` only becomes true once the hook confirms audio is flowing.
 *
 * Deliberately reads BOTH isTtsLoading and isTtsSpeaking rather than just the
 * latter: once a clip finishes naturally (or errors, or is stopped) the hook
 * drives both back to false on its own, and this function then falls through
 * to 'idle' even though `activeKey` still equals `key` — nothing has to
 * remember to reset activeKey for that to happen. Losing either read would
 * either flash 'idle' during the detail fetch (the original "dead button"
 * complaint) or strand a finished row showing 'working' forever.
 */
export function derivePlaybackState(
  key: string,
  activeKey: string | null,
  isFetchingDetail: boolean,
  isTtsLoading: boolean,
  isTtsSpeaking: boolean,
): PlaybackState {
  if (activeKey !== key) return 'idle';
  if (isTtsSpeaking) return 'playing';
  return isFetchingDetail || isTtsLoading ? 'working' : 'idle';
}

interface PlaybackButtonContent {
  icon: React.ReactNode;
  label: string;
}

function playbackButtonContent(state: PlaybackState, idleLabel: string): PlaybackButtonContent {
  if (state === 'working') {
    return { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, label: '準備中…' };
  }
  if (state === 'playing') {
    return { icon: <Square className="h-3.5 w-3.5" />, label: '停止' };
  }
  return { icon: <Play className="h-3.5 w-3.5" />, label: idleLabel };
}

function detailToFullText(detail: StoryDetailResponse): string {
  const paragraphs = detail.paragraphs ?? detail.content ?? [];
  return paragraphs.join('\n\n');
}

export function buildLessonQrValue(origin: string, lessonId: number, step: LessonQrStep): string {
  return `${origin}/learn/${lessonId}/${step}`;
}

async function fetchStoryList(token: string | null | undefined): Promise<StoryListResponse> {
  const res = await fetch(`${API_BASE}/api/stories?page_size=300`, {
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as StoryListResponse;
  if (data.stories.length !== data.total) {
    throw new Error(`課程清單分頁不完整：收到 ${data.stories.length} / ${data.total}`);
  }
  return data;
}

async function fetchStoryDetail(lessonId: number, token: string | null | undefined): Promise<StoryDetailResponse> {
  const res = await fetch(`${API_BASE}/api/stories/${lessonId}`, {
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<StoryDetailResponse>;
}

async function qrCodeToDataUrl(value: string): Promise<string> {
  // Plain static import (see the top of this file). This was previously
  // `await import(/* @vite-ignore */ moduleName)` with the name held in a
  // variable, which tells Vite not to analyse or bundle the module: the build
  // succeeded with the package absent, the unit test passed because it mocks
  // 'qrcode', and in a real browser the bare specifier could not be resolved,
  // so every QR download threw. Verified by grepping the build output for the
  // library's own strings — zero hits before, present after.
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
  });
}

const QrDownloadButton: React.FC<QrButtonProps> = ({ lessonId, step, label, filePrefix }) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const downloadQr = useCallback(async () => {
    setIsGenerating(true);
    try {
      const value = buildLessonQrValue(window.location.origin, lessonId, step);
      const dataUrl = await qrCodeToDataUrl(value);
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${filePrefix}-L${String(lessonId).padStart(2, '0')}.png`;
      link.click();
    } finally {
      setIsGenerating(false);
    }
  }, [filePrefix, lessonId, step]);

  return (
    <button
      type="button"
      onClick={downloadQr}
      disabled={isGenerating}
      className="inline-flex items-center justify-center gap-1.5 rounded border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
      title={buildLessonQrValue(window.location.origin, lessonId, step)}
    >
      {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
};

const LessonAudioTable: React.FC = () => {
  const { token } = useAuth();
  const [stories, setStories] = useState<StoryListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  // Playback failures (TTS backend down, empty audio, etc.) are a different
  // failure mode from "the lesson list failed to load" — the latter replaces
  // this whole view with a full-page retry screen (see `error` below), which
  // must not happen just because one row's synthesis failed.
  const [playbackError, setPlaybackError] = useState('');
  // Which `{storyId}:{mode}` this component last targeted. Distinct from the
  // hook's isTtsLoading/isTtsSpeaking (see derivePlaybackState above) because
  // those two only turn on *after* speakText() is called — activeKey also
  // covers the `/api/stories/{id}` round trip that happens before that.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Every <audio> that has actually started playing while this panel is open.
  // Filled by the play() patch in the effect below; drained by
  // stopCurrentPlayback. The elements are created inside the TTS layer and are
  // never attached to the document, so querySelectorAll cannot find them —
  // patching play() is the only way to get a handle on them.
  const startedAudioRef = useRef<Set<HTMLMediaElement>>(new Set());
  const [isFetchingDetail, setIsFetchingDetail] = useState(false);
  // Guards against an old click's detail-fetch response landing after a
  // newer click has already moved on to a different lesson (out-of-order
  // network responses) — without this, switching rows quickly could still
  // start the *stale* lesson's audio after the new one, re-creating the
  // overlap bug through a different path than "click while already playing".
  const activeRequestRef = useRef(0);
  const { speakText, stopTts, isTtsLoading, isTtsSpeaking, ttsError } = useTtsPlayback(() => {}, () => {});

  const sortedStories = useMemo(
    () => [...stories].sort((a, b) => a.lesson_number - b.lesson_number),
    [stories],
  );

  const loadStories = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await fetchStoryList(token);
      setStories(data.stories);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // Surface a failure from *inside* speakText's own pipeline (e.g. the TTS
  // backend itself errors after the detail fetch already succeeded) as the
  // same inline banner a detail-fetch failure uses, instead of leaving the
  // row silently drop back to idle with no explanation.
  useEffect(() => {
    if (ttsError) setPlaybackError(ttsError);
  }, [ttsError]);

  const stopCurrentPlayback = useCallback(() => {
    activeRequestRef.current += 1;
    stopTts();
    // Belt and braces: pause the element directly as well.
    //
    // Measured on staging 2026-08-08 — clicking this row's own stop control
    // flipped the UI back to idle while the audio kept going, currentTime
    // advancing 13s → 18s → 41s across two clicks. Which is worse than the
    // original bug: the screen now claims it stopped.
    //
    // stopTts() reaches the clip through utteranceRef / the ttsApi module's
    // _currentAudio, and on this single-shot path there is a window where
    // neither points at the element that is actually sounding. The hook hands
    // utteranceRef back to us, so pausing it here closes that window without
    // touching the shared hook (which every student reading step also uses).
    // Pause every element that has actually played while this panel was open.
    //
    // Three attempts reached staging before this one, and each failed the same
    // way: currentTime kept advancing while the button showed idle. stopTts()
    // reaches the clip through utteranceRef, and cancelTts() through ttsApi's
    // module-level _currentAudio — measured on staging, neither of them is
    // holding the element that is actually sounding by the time the user
    // clicks stop, so both pause something else and report success.
    //
    // Rather than keep guessing which handle is the live one, track the
    // elements themselves. startedAudioRef is filled by the play() patch
    // installed in the effect below, which is the same technique that proved
    // in the browser that these elements are reachable and pausable.
    startedAudioRef.current.forEach((el) => {
      if (!el.paused) {
        el.pause();
        el.currentTime = 0;
      }
    });
    startedAudioRef.current.clear();
    setActiveKey(null);
    setIsFetchingDetail(false);
  }, [stopTts]);

  const playLesson = useCallback(async (story: StoryListItem, mode: AudioMode) => {
    const key = `${story.id}:${mode}`;
    const requestId = ++activeRequestRef.current;
    // Always stop whatever is currently loading/playing *first*. The hook's
    // single-shot playback path (used here, since no lessonId/paragraphIdx is
    // passed) has no built-in "only one clip at a time" guard: calling
    // speakText() again does not stop a previous single-shot <audio> that is
    // still playing. Without this line, a second click just layers a second
    // <audio> on top of the first (the reported "同時播其他的就會一堆聲音").
    stopTts();
    setActiveKey(key);
    setIsFetchingDetail(true);
    setPlaybackError('');
    try {
      const detail = await fetchStoryDetail(story.id, token);
      if (activeRequestRef.current !== requestId) return; // superseded by a later click
      const fullText = detailToFullText(detail);
      const text = mode === 'key' ? (detail.key_reading?.passage || fullText) : fullText;
      setIsFetchingDetail(false);
      speakText(text);
    } catch (err) {
      if (activeRequestRef.current !== requestId) return;
      setIsFetchingDetail(false);
      setActiveKey(null);
      setPlaybackError(err instanceof Error ? err.message : String(err));
    }
  }, [speakText, stopTts, token]);

  useEffect(() => {
    const started = startedAudioRef.current;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function patchedPlay(this: HTMLMediaElement, ...args) {
      started.add(this);
      return originalPlay.apply(this, args);
    };
    return () => {
      HTMLMediaElement.prototype.play = originalPlay;
      started.forEach((el) => { if (!el.paused) el.pause(); });
      started.clear();
    };
  }, []);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-gray-200 bg-white px-5 py-3">
          <p className="text-sm text-gray-500">載入課程音檔總表中...</p>
        </div>
        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 16 }).map((_, index) => (
            <div key={index} className="flex animate-pulse items-center gap-3 border-b border-gray-100 px-4 py-3">
              <div className="h-3 w-20 rounded bg-gray-200" />
              <div className="h-3 flex-1 rounded bg-gray-100" />
              <div className="h-8 w-24 rounded bg-gray-100" />
              <div className="h-8 w-24 rounded bg-gray-100" />
              <div className="h-8 w-24 rounded bg-gray-100" />
              <div className="h-8 w-24 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-600">載入失敗：{error}</p>
        <button
          type="button"
          onClick={loadStories}
          className="text-xs text-blue-600 underline hover:text-blue-800"
        >
          重試
        </button>
      </div>
    );
  }

  const hasActivePlayback = activeKey !== null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-2.5">
        <h2 className="mr-1 text-sm font-semibold text-gray-800">課程音檔總表</h2>
        <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-500">{sortedStories.length} 課</span>
        <button
          type="button"
          onClick={stopCurrentPlayback}
          disabled={!hasActivePlayback}
          className="ml-auto inline-flex items-center gap-1.5 rounded border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Square className="h-3.5 w-3.5" />
          停止播放
        </button>
      </div>

      {playbackError && (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          播放失敗：{playbackError}
        </div>
      )}

      <div className="grid grid-cols-[minmax(220px,1.5fr)_minmax(112px,0.7fr)_minmax(168px,0.9fr)_minmax(120px,0.6fr)_minmax(120px,0.6fr)] items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500" role="row">
        <span>課程</span>
        <span>全文朗讀</span>
        <span>段落朗讀</span>
        <span>QR（全文）</span>
        <span>QR（段落）</span>
      </div>

      <div className="flex-1 overflow-y-auto" role="grid" aria-label="課程音檔總表">
        {sortedStories.map((story) => {
          const fullKey = `${story.id}:full`;
          const keyKey = `${story.id}:key`;
          const fullState = derivePlaybackState(fullKey, activeKey, isFetchingDetail, isTtsLoading, isTtsSpeaking);
          const keyState = derivePlaybackState(keyKey, activeKey, isFetchingDetail, isTtsLoading, isTtsSpeaking);
          const fullContent = playbackButtonContent(fullState, '播放全文');
          const keyContent = playbackButtonContent(keyState, '播放段落');
          const isRowPlaying = fullState === 'playing' || keyState === 'playing';

          return (
            <div
              key={story.id}
              role="row"
              className={`grid grid-cols-[minmax(220px,1.5fr)_minmax(112px,0.7fr)_minmax(168px,0.9fr)_minmax(120px,0.6fr)_minmax(120px,0.6fr)] items-center gap-3 border-b border-gray-100 px-4 py-3 text-sm [content-visibility:auto] [contain-intrinsic-size:64px] ${isRowPlaying ? 'bg-blue-50' : ''}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                    {lessonTitle(story)}
                  </span>
                  <span className="truncate font-medium text-gray-900">{story.title}</span>
                </div>
                <div className="mt-1 text-xs text-gray-400">{story.grade} 年級 · {story.grade_code}</div>
              </div>

              {/*
                No `disabled` gate tied to other rows/keys here on purpose:
                being unable to switch clips is its own annoyance. Clicking a
                *different* row/mode always just switches (playLesson calls
                stopTts() first); clicking *this same* button while it is
                already working/playing stops it instead of restarting it —
                this row's own control is the primary way to stop it.
              */}
              <button
                type="button"
                onClick={() => (fullState === 'idle' ? playLesson(story, 'full') : stopCurrentPlayback())}
                className="inline-flex w-fit items-center gap-1.5 rounded border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50"
              >
                {fullContent.icon}
                {fullContent.label}
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => (keyState === 'idle' ? playLesson(story, 'key') : stopCurrentPlayback())}
                  className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                >
                  {keyContent.icon}
                  {keyContent.label}
                </button>
                {!story.has_key_reading && (
                  <span className="text-xs text-amber-700">無重點段（唸全文）</span>
                )}
              </div>

              <QrDownloadButton lessonId={story.id} step="intro" label="下載" filePrefix="intro-qr" />
              <QrDownloadButton lessonId={story.id} step="full-reading" label="下載" filePrefix="full-reading-qr" />
            </div>
          );
        })}
        {sortedStories.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-gray-400">沒有課程資料</div>
        )}
      </div>
    </div>
  );
};

export default LessonAudioTable;
