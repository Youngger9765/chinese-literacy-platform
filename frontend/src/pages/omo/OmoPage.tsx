/**
 * OmoPage — OMO (Online-Merge-Offline) entry page.
 *
 * Phase 1b flow:
 *   upload  → result (AI identify + confirm + grading poll)
 *          → graded (per-question result page)
 *
 * Route: /omo
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import OmoUpload from '../../components/omo/OmoUpload';
import OmoIdentifyResult from '../../components/omo/OmoIdentifyResult';
import OmoResultPage from '../../components/omo/OmoResultPage';
import type { OmoAnswerItem } from '../../services/omoApi';

type PageState = 'upload' | 'result' | 'graded';

const OmoPage: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [pageState, setPageState] = useState<PageState>('upload');
  const [uploadId, setUploadId] = useState<number | null>(null);
  const [lessonTitle, setLessonTitle] = useState<string | undefined>(undefined);
  const [answers, setAnswers] = useState<OmoAnswerItem[]>([]);
  const [overallScore, setOverallScore] = useState<number | null>(null);

  if (!token) {
    navigate('/login');
    return null;
  }

  const handleUploaded = (id: number) => {
    setUploadId(id);
    setPageState('result');
  };

  const handleRetry = () => {
    setUploadId(null);
    setLessonTitle(undefined);
    setAnswers([]);
    setOverallScore(null);
    setPageState('upload');
  };

  const handleGraded = (
    gradedAnswers: OmoAnswerItem[],
    score: number | null,
    title?: string,
  ) => {
    setAnswers(gradedAnswers);
    setOverallScore(score);
    if (title) setLessonTitle(title);
    setPageState('graded');
  };

  const pageTitle =
    pageState === 'upload'
      ? '上傳學習單'
      : pageState === 'graded'
      ? '批改結果'
      : 'AI 辨識結果';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="返回"
          className="p-1 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-5 h-5"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <h2 className="font-semibold text-gray-900">{pageTitle}</h2>
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
            onRetry={handleRetry}
            onGraded={handleGraded}
          />
        )}

        {pageState === 'graded' && uploadId !== null && (
          <OmoResultPage
            uploadId={uploadId}
            token={token}
            lessonTitle={lessonTitle}
            answers={answers}
            overallScore={overallScore}
            onRetry={handleRetry}
          />
        )}
      </div>
    </div>
  );
};

export default OmoPage;
