import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const { speakText, stopPlayback, isTtsLoading } = useTtsPlayback(() => {}, () => {});

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

  const playLesson = useCallback(async (story: StoryListItem, mode: AudioMode) => {
    const key = `${story.id}:${mode}`;
    setPlayingKey(key);
    try {
      const detail = await fetchStoryDetail(story.id, token);
      const fullText = detailToFullText(detail);
      const text = mode === 'key' ? (detail.key_reading?.passage || fullText) : fullText;
      speakText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlayingKey(null);
    }
  }, [speakText, token]);

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-2.5">
        <h2 className="mr-1 text-sm font-semibold text-gray-800">課程音檔總表</h2>
        <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-500">{sortedStories.length} 課</span>
        <button
          type="button"
          onClick={stopPlayback}
          className="ml-auto inline-flex items-center gap-1.5 rounded border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50"
        >
          <Square className="h-3.5 w-3.5" />
          停止播放
        </button>
      </div>

      <div className="grid grid-cols-[minmax(220px,1.5fr)_minmax(112px,0.7fr)_minmax(168px,0.9fr)_minmax(120px,0.6fr)_minmax(120px,0.6fr)] items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500" role="row">
        <span>課程</span>
        <span>全文朗讀</span>
        <span>段落朗讀</span>
        <span>QR（全文）</span>
        <span>QR（段落）</span>
      </div>

      <div className="flex-1 overflow-y-auto" role="grid" aria-label="課程音檔總表">
        {sortedStories.map((story) => (
          <div
            key={story.id}
            role="row"
            className="grid grid-cols-[minmax(220px,1.5fr)_minmax(112px,0.7fr)_minmax(168px,0.9fr)_minmax(120px,0.6fr)_minmax(120px,0.6fr)] items-center gap-3 border-b border-gray-100 px-4 py-3 text-sm [content-visibility:auto] [contain-intrinsic-size:64px]"
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

            <button
              type="button"
              onClick={() => playLesson(story, 'full')}
              disabled={isTtsLoading || playingKey !== null}
              className="inline-flex w-fit items-center gap-1.5 rounded border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
            >
              {playingKey === `${story.id}:full` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              播放全文
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => playLesson(story, 'key')}
                disabled={isTtsLoading || playingKey !== null}
                className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
              >
                {playingKey === `${story.id}:key` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                播放段落
              </button>
              {!story.has_key_reading && (
                <span className="text-xs text-amber-700">無重點段（唸全文）</span>
              )}
            </div>

            <QrDownloadButton lessonId={story.id} step="intro" label="下載" filePrefix="intro-qr" />
            <QrDownloadButton lessonId={story.id} step="full-reading" label="下載" filePrefix="full-reading-qr" />
          </div>
        ))}
        {sortedStories.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-gray-400">沒有課程資料</div>
        )}
      </div>
    </div>
  );
};

export default LessonAudioTable;
