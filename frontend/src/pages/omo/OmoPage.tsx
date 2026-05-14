/**
 * OmoPage — OMO (Online-Merge-Offline) entry page.
 *
 * Phase 1b: handles from_cache/already_graded dedup flow + grading result.
 * Phase 2 (future): full result page at /omo/result/:id
 *
 * Route: /omo
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import OmoUpload from '../../components/omo/OmoUpload';
import OmoIdentifyResult from '../../components/omo/OmoIdentifyResult';

type PageState = 'upload' | 'result' | 'graded';

const OmoPage: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [pageState, setPageState] = useState<PageState>('upload');
  const [uploadId, setUploadId] = useState<number | null>(null);
  const [alreadyGraded, setAlreadyGraded] = useState(false);
  const [cachedScore, setCachedScore] = useState<number | null>(null);
  const [gradedUploadId, setGradedUploadId] = useState<number | null>(null);

  if (!token) {
    navigate('/login');
    return null;
  }

  const handleUploaded = (
    id: number,
    opts?: { alreadyGraded?: boolean; cachedScore?: number | null },
  ) => {
    setUploadId(id);
    setAlreadyGraded(opts?.alreadyGraded ?? false);
    setCachedScore(opts?.cachedScore ?? null);
    setPageState('result');
  };

  const handleRetry = () => {
    setUploadId(null);
    setAlreadyGraded(false);
    setCachedScore(null);
    setPageState('upload');
  };

  const handleConfirmed = (_lessonId: number) => {
    // OmoIdentifyResult continues polling until graded
  };

  const handleGraded = (id: number) => {
    setGradedUploadId(id);
    setPageState('graded');
    // Phase 2: navigate(`/omo/result/${id}`)
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Minimal back header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="返回"
          className="p-1 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" aria-hidden="true">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
        </button>
        <h2 className="font-semibold text-gray-900">
          {pageState === 'upload'
            ? '上傳學習單'
            : pageState === 'graded'
            ? '批改結果'
            : 'AI 辨識結果'}
        </h2>
      </div>

      {/* Content */}
      <div className="pb-20">
        {pageState === 'upload' && (
          <OmoUpload token={token} onUploaded={handleUploaded} />
        )}
        {pageState === 'result' && uploadId !== null && (
          <OmoIdentifyResult
            uploadId={uploadId}
            token={token}
            alreadyGraded={alreadyGraded}
            cachedScore={cachedScore}
            onConfirmed={handleConfirmed}
            onRetry={handleRetry}
            onGraded={handleGraded}
          />
        )}
        {pageState === 'graded' && gradedUploadId !== null && (
          <div className="flex flex-col items-center gap-6 px-4 py-12 max-w-md mx-auto">
            <div className="text-5xl" aria-hidden="true">🎉</div>
            <div className="text-center">
              <p className="font-semibold text-gray-800">批改完成！</p>
              <p className="mt-2 text-sm text-gray-500">
                詳細結果頁面即將上線
              </p>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
            >
              上傳另一張
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OmoPage;
