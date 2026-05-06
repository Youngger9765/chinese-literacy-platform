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
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { setToolboxMode } from '../../services/learningStorageScope';

interface ToolboxCompletionActionsProps {
  /**
   * Reset the tool to a fresh, blank state — the student wants to redo
   * the same tool. Each tool defines its own reset semantics.
   */
  onRetry: () => void;
  /** Optional className applied to the wrapper div for layout control. */
  className?: string;
}

const ToolboxCompletionActions: React.FC<ToolboxCompletionActionsProps> = ({
  onRetry,
  className = '',
}) => {
  const navigate = useNavigate();

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
