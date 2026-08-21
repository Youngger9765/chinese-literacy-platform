/**
 * ToolboxCompletionActions — shared CTA row for tool completion screens
 * when running in 練習工具箱 mode (#1462, follow-up of #1460).
 *
 * UX spec (user, 2026-05-04): when a student completes a practice from
 * /tools, the only buttons should be "重做" and "回到練習工具箱" — there
 * is no "next step" because each toolbox practice is single-shot.
 *
 * Each tool component imports this and renders it inside its existing
 * completion screen, gated on `isToolboxMode()`. The "重做" handler is
 * tool-specific (resets internal state); "回到練習工具箱" is uniform.
 *
 * Self-practice / assignment flows render the tool's normal "繼續/下一步"
 * CTA (this component is NOT rendered in those flows).
 *
 * Side effect (#1463 Phase 2): on mount this component fires
 * `recordToolboxCompletion()` so the completed practice is persisted to
 * the matching `toolbox_*_sessions` table. The toolId is auto-detected
 * from the URL path; tools may pass `recordPayload` to enrich the result
 * blob and score. Mounting once guarantees a single record per
 * completion (re-mounts after "重做" record a NEW session).
 */
import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { setToolboxMode } from '../../services/learningStorageScope';
import { recordToolboxCompletion, type ToolId } from '../../services/toolboxApi';

// Order matches backend TOOL_MODEL_MAP and frontend TOOL_OPTIONS.
const TOOLBOX_TOOL_IDS: readonly ToolId[] = [
  'paragraph-reading',
  'key-passage-reading',
  'listening',
  'character-practice',
  'sentence-practice',
  'vocab-definition',
  'vocab-application',
  'comprehension',
  'vocab-review',
  'knowledge-station',
] as const;

function detectToolIdFromPath(pathname: string): ToolId | null {
  // Toolbox practice URL: /learn/:storyId/:toolPath — toolPath is the last segment.
  const parts = pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  return (TOOLBOX_TOOL_IDS as readonly string[]).includes(last) ? (last as ToolId) : null;
}

export interface ToolboxCompletionActionsProps {
  /**
   * Reset the tool to a fresh, blank state — the student wants to redo
   * the same tool. Each tool defines its own reset semantics.
   */
  onRetry: () => void;
  /** Optional className applied to the wrapper div for layout control. */
  className?: string;
  /**
   * Optional payload recorded into the toolbox session row when this
   * completion screen mounts (#1463). Tools that have a result/score
   * available pass them here; the rest record an empty `{}` blob.
   * `storySlug` is also persisted inside `result` so the 學習紀錄 page
   * can link the row back to a lesson without an extra FK lookup.
   */
  recordPayload?: {
    result?: Record<string, unknown>;
    score?: number | null;
    storySlug?: string | null;
  };
}

const ToolboxCompletionActions: React.FC<ToolboxCompletionActionsProps> = ({
  onRetry,
  className = '',
  recordPayload,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useAuth();
  const recordedRef = useRef(false);

  // #1463: persist the toolbox session on mount. Fire-and-forget — failures
  // only console.warn, the navigation still works. Ref guard ensures we only
  // record once even if React re-mounts the component for any reason.
  useEffect(() => {
    if (recordedRef.current) return;
    if (!token) return;
    const toolId = detectToolIdFromPath(location.pathname);
    if (!toolId) return;
    recordedRef.current = true;
    const result = {
      ...(recordPayload?.result ?? {}),
      story_slug: recordPayload?.storySlug ?? null,
    };
    recordToolboxCompletion(toolId, token, {
      text_id: null,
      result,
      score: recordPayload?.score ?? null,
    }).catch((err) =>
      console.warn('[ToolboxCompletionActions] record failed:', err),
    );
    // Once-only: deps intentionally omitted — re-mounts (after 重做) get a new ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBackToToolbox = () => {
    // Clear toolbox-mode flag so subsequent self-practice / assignment
    // flows don't accidentally inherit the "__t" storage scope.
    setToolboxMode(false);
    navigate('/tools');
  };

  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={onRetry}
        className="px-6 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
      >
        重做
      </button>
      <button
        type="button"
        onClick={handleBackToToolbox}
        className="px-6 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 shadow-sm"
      >
        回到練習工具箱
      </button>
    </div>
  );
};

export default ToolboxCompletionActions;
