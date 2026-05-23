import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import OmoResultPage from '../../components/omo/OmoResultPage';
import { useAuth } from '../../contexts/AuthContext';
import { getOmoStatus, OmoApiError } from '../../services/omoApi';
import type { OmoStatusResponse } from '../../services/omoApi';

type LoadState =
  | 'loading'
  | 'ready'
  | 'invalid'
  | 'not-found'
  | 'forbidden'
  | 'not-graded'
  | 'error';

interface MessageStateProps {
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const MessageState: React.FC<MessageStateProps> = ({
  title,
  detail,
  actionLabel,
  onAction,
}) => (
  <div className="flex flex-col items-center gap-5 px-4 py-12 max-w-md mx-auto text-center">
    <div>
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      {detail && <p className="mt-2 text-sm text-gray-500">{detail}</p>}
    </div>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

const LoadingState: React.FC = () => (
  <div className="flex flex-col items-center gap-5 px-4 py-12 max-w-md mx-auto">
    <div
      className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin"
      aria-label="載入批改結果中"
      role="status"
    />
    <p className="text-sm font-medium text-gray-600">載入批改結果中…</p>
  </div>
);

const OmoResultStandalonePage: React.FC = () => {
  const { uploadId } = useParams<{ uploadId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [result, setResult] = useState<OmoStatusResponse | null>(null);

  const numericUploadId = useMemo(() => {
    if (!uploadId) return null;
    const parsed = Number(uploadId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [uploadId]);

  useEffect(() => {
    if (!token) return;
    if (numericUploadId === null) {
      setLoadState('invalid');
      return;
    }

    let cancelled = false;
    setLoadState('loading');
    setResult(null);

    getOmoStatus(numericUploadId, token)
      .then((data) => {
        if (cancelled) return;
        setResult(data);
        setLoadState(data.status === 'graded' ? 'ready' : 'not-graded');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof OmoApiError) {
          if (err.status === 404) {
            setLoadState('not-found');
            return;
          }
          if (err.status === 401 || err.status === 403) {
            setLoadState('forbidden');
            return;
          }
        }
        setLoadState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [numericUploadId, token]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const lessonTitle = result?.candidates?.[0]?.title || undefined;
  const pageContent = (() => {
    if (loadState === 'loading') return <LoadingState />;

    if (loadState === 'ready' && result) {
      return (
        <OmoResultPage
          uploadId={result.upload_id}
          token={token}
          lessonTitle={lessonTitle}
          answers={result.answers ?? []}
          overallScore={result.overall_score ?? null}
          onRetry={() => navigate('/omo')}
          candidates={result.candidates ?? []}
        />
      );
    }

    if (loadState === 'not-found') {
      return (
        <MessageState
          title="找不到此學習單"
          detail="這份學習單不存在，或已被刪除"
          actionLabel="回到上傳學習單"
          onAction={() => navigate('/omo')}
        />
      );
    }

    if (loadState === 'forbidden') {
      return (
        <MessageState
          title="無權限查看"
          detail="請確認你使用的是上傳這份學習單的帳號"
          actionLabel="回到上傳學習單"
          onAction={() => navigate('/omo')}
        />
      );
    }

    if (loadState === 'not-graded') {
      const isProcessing =
        result?.status === 'pending' ||
        result?.status === 'identifying' ||
        result?.status === 'grading';
      return (
        <MessageState
          title={isProcessing ? 'AI 還在處理這份學習單' : '這份學習單尚未完成批改'}
          detail={result?.error_message ?? '請稍後再回來查看批改結果'}
          actionLabel="回到上傳學習單"
          onAction={() => navigate('/omo')}
        />
      );
    }

    if (loadState === 'invalid') {
      return (
        <MessageState
          title="找不到此學習單"
          detail="網址中的學習單編號不正確"
          actionLabel="回到上傳學習單"
          onAction={() => navigate('/omo')}
        />
      );
    }

    return (
      <MessageState
        title="無法載入批改結果"
        detail="請稍後再試一次"
        actionLabel="回到上傳學習單"
        onAction={() => navigate('/omo')}
      />
    );
  })();

  return (
    <div className="min-h-screen bg-gray-50">
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
        <h2 className="font-semibold text-gray-900">批改結果</h2>
      </div>
      <div className="pb-20">{pageContent}</div>
    </div>
  );
};

export default OmoResultStandalonePage;
