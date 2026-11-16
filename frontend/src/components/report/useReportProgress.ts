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
 *
 *   ⚠️ 這個 carry-forward 只對「正在進行中、剛被 #2889 重新整理分裂成新 session」
 *   的情境成立 —— 那個新 session 跟剛完成的那次其實是同一次嘗試。歷史紀錄頁
 *   （SessionHistoryReportPage）看的是使用者從清單裡點進來的**某一筆指定紀錄**，
 *   跟它同一課的其他 session 可能是更早或更晚、完全不相干的另一次嘗試 —— 往回找
 *   會把「更新一次嘗試」的記號誤植到「正在看的這一筆」上面。歷史頁要傳
 *   `carryForwardMarks=false`，只看這個 session 自己的記號（#3749）。
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
  /**
   * 記號要不要往回找同一課其他 session 的 carry-forward（見檔頭說明）。
   * 預設 true：學習流程內的 ReportPage.tsx 重新整理時要靠它才看得到剛做的記號。
   * 歷史紀錄頁在看一筆指定的過去 session，傳 false 只看這個 session 自己的。
   */
  carryForwardMarks: boolean = true,
): ReportData {
  const [state, setState] = useState<ReportData>({ progress: null, annotations: null, loading: true });

  useEffect(() => {
    if (!dbSessionId || !token) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const marksPromise = carryForwardMarks
      ? loadMarksCarriedForward(token, dbSessionId, storySlug)
      : loadAnnotations(dbSessionId);
    Promise.all([
      loadStepProgress(token, dbSessionId)
        .then((r) => r.step_progress)
        .catch((err: Error) => {
          console.warn('Report progress load failed, using layout state:', err.message);
          return null;
        }),
      marksPromise.catch((err: Error) => {
        console.warn('Annotation load failed (non-blocking):', err.message);
        return [] as AnnotationRecord[];
      }),
    ]).then(([progress, annotations]) => {
      if (!cancelled) setState({ progress, annotations, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [dbSessionId, token, storySlug, carryForwardMarks]);

  return state.progress || state.loading ? state : { ...state, progress: fallback ?? null };
}
