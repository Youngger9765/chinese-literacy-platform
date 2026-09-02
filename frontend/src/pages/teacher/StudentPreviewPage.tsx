/**
 * StudentPreviewPage — teacher "preview as student" read-only view (Issue #3027).
 *
 * Hans's on-site teacher feedback: a fully-shipped student feature (AI story
 * recommendations) was reported missing because teachers have no way to see
 * what a student sees. This page is the entry point that fixes that.
 *
 * Security note: the preview token this page uses is passed via React
 * Router navigation `state` (from StudentProgressTab's "以學生身分預覽"
 * button), NOT stored in localStorage and NOT written into the shared
 * `authToken` used by the rest of the app (see utils/storage.ts). That is
 * what guarantees previewing a student can never clobber — or be confused
 * with — the teacher's own logged-in session. The actual "cannot write"
 * guarantee is enforced server-side by PreviewModeWriteGuardMiddleware
 * (backend/app/main.py); this page's banner is a UX affordance, not the
 * security boundary. See docs/prd/2026-09-hans-feedback-teacher-visibility.md.
 */
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getStoryRecommendations, type StoryRecommendationItem } from '../../services/progressApi';
import { gradeLabel } from '../../utils/gradeLabel';

export interface StudentPreviewLocationState {
  previewToken: string;
  studentId: number;
  studentName: string;
  expiresInMinutes: number;
}

const StudentPreviewPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as StudentPreviewLocationState | null;

  const [recs, setRecs] = useState<StoryRecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state?.previewToken) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getStoryRecommendations(state.previewToken, state.studentId, 5);
        if (!cancelled) setRecs(data.recommendations);
      } catch {
        if (!cancelled) setError('載入預覽失敗，預覽權杖可能已過期，請重新進入預覽');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state]);

  // Reached directly by URL (no mint flow ran) — there is no token to use.
  if (!state?.previewToken) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-gray-600">
          此頁面需要從「班級學生列表」點擊「以學生身分預覽」進入，無法直接開啟。
        </p>
        <button
          type="button"
          onClick={() => navigate('/teacher-home')}
          className="mt-4 text-accent underline"
        >
          回教師首頁
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div
        role="status"
        className="sticky top-0 z-40 mb-4 flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-sm text-amber-800">
          <span className="font-bold">預覽模式（唯讀）</span>
          {'　'}你正在以「{state.studentName}」的身分預覽，不會寫入這位學生的任何資料
          {typeof state.expiresInMinutes === 'number' && (
            <span className="ml-1 text-amber-600">
              （{state.expiresInMinutes} 分鐘後自動失效）
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="shrink-0 self-start rounded-full bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 sm:self-auto"
        >
          結束預覽
        </button>
      </div>

      {loading && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-bold text-gray-900">
            AI 為「{state.studentName}」推薦的課文
          </h3>
          {recs.length === 0 ? (
            <p className="text-sm text-gray-500">目前沒有推薦課文，這位學生尚未累積足夠的學習紀錄。</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recs.map((rec) => (
                <div
                  key={rec.story_slug}
                  className="flex flex-col gap-2 rounded-xl border border-gray-200 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">
                      {gradeLabel(String(rec.grade))}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {rec.genre}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-gray-900">{rec.title}</h4>
                  <p className="text-xs text-gray-500">{rec.reason}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StudentPreviewPage;
