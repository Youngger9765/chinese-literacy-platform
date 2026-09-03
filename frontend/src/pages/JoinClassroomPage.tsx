import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  joinClassroomByCode,
  previewClassroomByCode,
  ClassroomApiError,
  type ClassroomJoinPreview,
} from '../services/classroomApi';
import { useToast } from '../components/ui/Toast';

/**
 * Normalize a raw code into the shape both entry paths must agree on:
 * uppercase, alphanumeric only, max 6 chars. The manual `<input>` already
 * enforced this on every keystroke; a code arriving via `?code=` (#3081) is
 * judged by the exact same rule so the two paths can't silently diverge on
 * what counts as "a code".
 */
function sanitizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

type JoinResult = { kind: 'success' | 'already'; text: string };

const JoinClassroomPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token } = useAuth();
  const { toast, showToast } = useToast();

  const urlCode = sanitizeCode(searchParams.get('code') ?? '');

  // QR-flow state (#3081). `manualOverride` wins over a valid `urlCode` --
  // set either by the preview 404ing (see the effect below) or by the
  // student tapping "改用手動輸入" because the wrong row got projected.
  const [manualOverride, setManualOverride] = useState(false);
  const useQrFlow = urlCode.length === 6 && !manualOverride;

  const [preview, setPreview] = useState<ClassroomJoinPreview | null>(null);
  // Seeded from useQrFlow's *first-render* value on purpose (useState's
  // initializer only runs once): if we're going to attempt a preview at
  // all, start in the loading state so there's no blank flash between
  // mount and the effect below flipping it.
  const [previewLoading, setPreviewLoading] = useState<boolean>(useQrFlow);

  // Manual-entry state -- also doubles as the editable code once the QR
  // flow falls back to it (invalid scanned code, or explicit opt-out).
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<JoinResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect home after a successful join OR an already-enrolled no-op --
  // AC4 wants "不重複加入", and there is nothing left to do on this page
  // in either case.
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => navigate('/'), 2000);
    return () => clearTimeout(timer);
  }, [result, navigate]);

  // AC2: look up the classroom name for a scanned code BEFORE joining, so
  // an old printout or a projector one row over doesn't silently enroll
  // anyone in the wrong class. Read-only -- see `previewClassroomByCode` /
  // `GET /classrooms/join-preview`, which has its own "does not enroll"
  // regression lock on the backend.
  useEffect(() => {
    if (!useQrFlow || !token) return;
    let cancelled = false;
    setPreviewLoading(true);
    previewClassroomByCode(token, urlCode)
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch((err) => {
        if (cancelled) return;
        // Preview failed -- fall back to the manual form with the scanned
        // code already in the box (so a typo is one edit away) instead of
        // a dead end.
        setJoinCode(urlCode);
        setManualOverride(true);
        setError(
          err instanceof ClassroomApiError && err.status === 404
            ? '找不到此加入代碼，請確認代碼是否正確'
            : '查詢班級資訊失敗，請改用手動輸入代碼',
        );
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urlCode is
    // derived from searchParams every render; re-running on every
    // sanitizeCode() call identity would refetch needlessly. token/useQrFlow
    // are the values that actually gate this effect.
  }, [useQrFlow, urlCode, token]);

  const attemptJoin = useCallback(async (code: string) => {
    if (!token) {
      setError('請先登入');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      const joined = await joinClassroomByCode(token, code);
      const text = `成功加入「${joined.name}」！`;
      showToast(text, 'success');
      setResult({ kind: 'success', text });
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        if (err.status === 404) {
          setError('找不到此加入代碼，請確認代碼是否正確');
        } else if (err.status === 409) {
          // Already in the class is not an error -- a student rescanning the
          // projected QR is the expected case, not a mistake to report in red.
          setResult({ kind: 'already', text: '你已經加入這個班級了' });
        } else if (err.status === 400) {
          setError(err.message || '加入代碼無效');
        } else {
          setError(err.message || '加入失敗，請稍後再試');
        }
      } else {
        setError('加入失敗，請稍後再試');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [token, showToast, preview]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setJoinCode(sanitizeCode(e.target.value));
    setError('');
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCode.length !== 6) {
      setError('請輸入完整的 6 碼加入代碼');
      return;
    }
    void attemptJoin(joinCode);
  };

  const switchToManual = () => {
    setJoinCode(urlCode);
    setManualOverride(true);
  };

  const shellHeader = (subtitle: string) => (
    <div className="text-center mb-8">
      <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4">
        <span className="text-white font-black text-2xl">L</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900">加入班級</h1>
      <p className="text-gray-500 text-sm mt-1">{subtitle}</p>
    </div>
  );

  // ---- Result: success or already-enrolled wins over every other view ----
  if (result) {
    const isAlready = result.kind === 'already';
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
        {toast}
        <div className="w-full max-w-sm">
          {shellHeader(isAlready ? '你已經在這個班級了' : '加入成功')}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div
              className={
                isAlready
                  ? 'bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg px-4 py-3'
                  : 'bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3'
              }
            >
              {result.text}
              <p className={`text-xs mt-1 ${isAlready ? 'text-blue-600' : 'text-green-600'}`}>
                2 秒後自動返回首頁...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- QR flow: code prefilled from the URL, nothing to type (AC2) ----
  if (useQrFlow) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
        {toast}
        <div className="w-full max-w-sm">
          {shellHeader('確認要加入的班級')}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}
            {previewLoading ? (
              <p className="text-center text-sm text-gray-400 py-6">確認班級資訊中...</p>
            ) : preview ? (
              <>
                <div className="text-center">
                  <p className="text-xs text-gray-400">即將加入</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">{preview.name}</p>
                  <p className="font-mono text-sm text-gray-400 mt-2 tracking-widest">{urlCode}</p>
                </div>
                <button
                  type="button"
                  onClick={() => attemptJoin(urlCode)}
                  disabled={isSubmitting}
                  className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
                >
                  {isSubmitting ? '加入中...' : '確認加入'}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={switchToManual}
              className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              不是這個班？改用手動輸入
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Manual entry (unchanged shape from before #3081) ----
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
      {toast}
      <div className="w-full max-w-sm">
        {shellHeader('輸入老師提供的加入代碼')}

        <form
          onSubmit={handleManualSubmit}
          className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4"
        >
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="join-code" className="block text-sm font-medium text-gray-700 mb-1">
              加入代碼
            </label>
            <input
              id="join-code"
              type="text"
              value={joinCode}
              onChange={handleCodeChange}
              placeholder="輸入 6 碼加入代碼"
              autoComplete="off"
              autoFocus
              className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            />
            <p className="text-xs text-gray-400 mt-1">由英文字母與數字組成，共 6 碼</p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || joinCode.length !== 6}
            className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
          >
            {isSubmitting ? '加入中...' : '加入班級'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-accent hover:text-accent-hover font-medium transition-colors"
          >
            返回首頁
          </button>
        </p>
      </div>
    </div>
  );
};

export default JoinClassroomPage;
