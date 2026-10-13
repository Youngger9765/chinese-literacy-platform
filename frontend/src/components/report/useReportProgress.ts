/**
 * useReportProgress — 報告頁的資料，直接從 DB 讀（#3399）
 *
 * 進度（step_progress）：
 *   讀目前這個 session 的 /progress。重新整理報告頁時 layout 會新建一個 session
 *   （ReportPage 掛載時 handleSessionComplete 清掉了 session id），但後端建新
 *   session 時會把同一學生、同一課最近一次的 step_progress 帶過來（#2889，owner
 *   2026-08-23 拍板），所以新 session 的進度跟剛剛那次一樣。
 *
 * 記號（annotation_entries）：
 *   **不會**跟著 #2889 帶過來 —— 它在另一張表。所以目前這個 session 沒有記號時，
 *   往回找這一課最近一次有記號的 session，語意跟 #2889 的 carry-forward 一致
 *   （只看自己的、只看這一課）。沒有這一步，重新整理後讀全文-做記號會顯示 0 個。
 */
import { useEffect, useState } from 'react';
import { API_BASE } from '../../services/apiConfig';
import { loadStepProgress, type StepProgressData } from '../../services/learningApi';
import { loadAnnotations, type AnnotationRecord } from '../../services/learning/annotationApi';

export interface ReportData {
  progress: StepProgressData | null;
  /** null = 還在載入。 */
  annotations: AnnotationRecord[] | null;
  loading: boolean;
}

/** 這一課自己的 session（新到舊），不含 exclude。 */
async function recentSessionIds(token: string, storySlug: string, exclude: number): Promise<number[]> {
  const res = await fetch(
    `${API_BASE}/api/learning/sessions?story_slug=${encodeURIComponent(storySlug)}&limit=10`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: { id: number }[] };
  return (data.items ?? []).map((s) => s.id).filter((id) => id !== exclude);
}

async function loadMarksCarriedForward(
  token: string,
  sessionId: number,
  storySlug: string | undefined,
): Promise<AnnotationRecord[]> {
  const own = await loadAnnotations(sessionId);
  if (own.length || !storySlug) return own;
  for (const id of await recentSessionIds(token, storySlug, sessionId)) {
    const prev = await loadAnnotations(id).catch(() => [] as AnnotationRecord[]);
    if (prev.length) return prev;
  }
  return own;
}

export function useReportProgress(
  dbSessionId: number | null | undefined,
  token: string | null | undefined,
  storySlug: string | undefined,
  /** layout 手上的那份，DB 讀取失敗時退回用它。 */
  fallback: StepProgressData | null | undefined,
): ReportData {
  const [state, setState] = useState<ReportData>({ progress: null, annotations: null, loading: true });

  useEffect(() => {
    if (!dbSessionId || !token) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    Promise.all([
      loadStepProgress(token, dbSessionId)
        .then((r) => r.step_progress)
        .catch((err: Error) => {
          console.warn('Report progress load failed, using layout state:', err.message);
          return null;
        }),
      loadMarksCarriedForward(token, dbSessionId, storySlug).catch((err: Error) => {
        console.warn('Annotation load failed (non-blocking):', err.message);
        return [] as AnnotationRecord[];
      }),
    ]).then(([progress, annotations]) => {
      if (!cancelled) setState({ progress, annotations, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [dbSessionId, token, storySlug]);

  return state.progress || state.loading ? state : { ...state, progress: fallback ?? null };
}
