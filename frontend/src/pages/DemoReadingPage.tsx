/**
 * DemoReadingPage — 免登入示範朗讀播放頁 (#2625)
 *
 * A student scans a QR code on a paper worksheet → lands here without logging
 * in. The page plays a pre-generated demo-reading audio file (GCS asset served
 * through the existing /assets proxy). It does NOT call /api/tts/synthesize and
 * does NOT use the useTtsPlayback hook (which requires auth and degrades to
 * speechSynthesis on failure — exactly what a public page must never do).
 *
 * Route: /demo-reading/:lessonId/:kind   (kind = "full" | "passage")
 * Must sit OUTSIDE ProtectedRoute in AppRoutes.tsx.
 */
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE || '';

type Kind = 'full' | 'passage';

interface StoryData {
  id: number;
  title: string;
  paragraphs: string[];
  key_reading?: { passage?: string | null } | null;
}

const DemoReadingPage: React.FC = () => {
  const { lessonId, kind } = useParams<{ lessonId: string; kind: string }>();
  const validKind: Kind = kind === 'passage' ? 'passage' : 'full';

  const [story, setStory] = useState<StoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [audioError, setAudioError] = useState(false);

  useEffect(() => {
    if (!lessonId) return;
    setLoading(true);
    setError('');
    fetch(`${API_BASE}/api/stories/${lessonId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: StoryData) => {
        setStory(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [lessonId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-gray-500">載入中…</p>
      </div>
    );
  }

  if (error || !story) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-red-600">找不到課程資料</p>
      </div>
    );
  }

  const audioSrc = `${API_BASE}/assets/demo-reading/${lessonId}/${validKind}.mp3`;
  const displayText = validKind === 'passage'
    ? (story.key_reading?.passage || story.paragraphs.join('\n'))
    : story.paragraphs.join('\n');

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">{story.title}</h1>

      {/* The text being read */}
      <div className="mb-6 w-full whitespace-pre-line rounded-lg bg-gray-50 p-4 text-lg leading-relaxed">
        {displayText}
      </div>

      {/* Audio player — plain <audio>, no useTtsPlayback, no speechSynthesis */}
      {audioError ? (
        <p className="mb-6 text-center text-amber-700">
          音檔尚未準備好，請稍後再試
        </p>
      ) : (
        <audio
          src={audioSrc}
          controls
          className="mb-6 w-full"
          onError={() => setAudioError(true)}
          controlsList="nodownload"
        />
      )}

      {/* Link to the practice flow — hits ProtectedRoute login wall, which is correct */}
      <Link
        to={`/learn/${lessonId}/full-reading`}
        className="rounded-lg bg-blue-600 px-6 py-3 text-lg font-medium text-white shadow hover:bg-blue-700"
      >
        開始朗讀
      </Link>
    </div>
  );
};

export default DemoReadingPage;
