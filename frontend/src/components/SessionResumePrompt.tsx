import React, { useEffect, useState } from 'react';
import { stepPath as buildStepPath } from '../config/stepPath';
import { STEP_REGISTRY, resolveActiveSteps } from '../config/stepConfig';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  loadActiveSession,
  clearActiveSession,
  ActiveSessionRecord,
  fetchStory,
} from '../services/api';

/**
 * Resolve a stored `currentStep` (a `dbStepNumber`) to its step, or null (#3153).
 *
 * ⛔ Never compare `dbStepNumber` numerically. It is an identity, not an order --
 * the numbers do not follow the sequence:
 *
 *   seq 1   lesson-intro          1
 *   seq 2   full-text-annotate    8   <- what bootstrap writes on opening a lesson
 *   seq 3   key-passage-reading   6
 *   ...
 *   seq 11  report                7   <- the last step is a *smaller* number
 *
 * The previous guard was `currentStep <= 1 || currentStep >= 6`, with a comment
 * saying "step 6 = report = completed". But 6 is 重點朗讀 and report is 7, so a
 * student who had merely opened a lesson (8) satisfied `8 >= 6` and had their
 * record deleted. The prompt could never appear for anyone, and it destroyed the
 * state on the way out -- which is why nobody reported it: a child does not say
 * "my resume record was deleted", only that the thing does not remember them.
 */
function resolveStoredStep(currentStep: number) {
  return Object.values(STEP_REGISTRY).find((s) => s.dbStepNumber === currentStep) ?? null;
}

/** Max age for an active session record: 7 days in ms. */
const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionResumePromptProps {
  /** Called when the user dismisses or acts on the prompt. */
  onDismiss?: () => void;
}

/**
 * Shows a banner/modal when the user has an unfinished learning session
 * saved in localStorage.  Lets the user resume from the saved step or
 * start fresh.
 *
 * Key: `lingoleap-active-session-{userId}`
 */
const SessionResumePrompt: React.FC<SessionResumePromptProps> = ({ onDismiss }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [record, setRecord] = useState<ActiveSessionRecord | null>(null);
  const [storyTitle, setStoryTitle] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user) return;

    const saved = loadActiveSession(String(user.id));
    if (!saved) return;

    // Ignore stale records (older than 7 days)
    if (Date.now() - saved.timestamp > MAX_SESSION_AGE_MS) {
      clearActiveSession(String(user.id));
      return;
    }

    // Identity, not arithmetic (#3153). Clear when the stored step is:
    //   - unknown (stale record from an older step set)
    //   - disabled (e.g. 逐段朗讀, off since the 2026-07-20 review) -- resuming
    //     into it drops the child on a screen the stepper cannot even show
    //   - the first step in the sequence (only just started, nothing to resume)
    //   - the last step in the sequence (report = finished)
    const step = resolveStoredStep(saved.currentStep);
    const active = resolveActiveSteps();
    const isFirst = step != null && active.length > 0 && step.id === active[0].id;
    const isLast = step != null && active.length > 0 && step.id === active[active.length - 1].id;
    const isActive = step != null && active.some((s) => s.id === step.id);

    if (step == null || !isActive || isFirst || isLast) {
      clearActiveSession(String(user.id));
      return;
    }

    setRecord(saved);

    // Fetch story title for the prompt message
    fetchStory(saved.storyId)
      .then((story) => setStoryTitle(story.title))
      .catch(() => setStoryTitle(null))
      .finally(() => setVisible(true));
  }, [user]);

  const handleResume = () => {
    if (!record) return;
    const stepPath = resolveStoredStep(record.currentStep)?.id ?? 'lesson-intro';
    setVisible(false);
    onDismiss?.();
    navigate(buildStepPath(record.storyId, stepPath));
  };

  const handleRestart = () => {
    if (!user) return;
    clearActiveSession(String(user.id));
    setVisible(false);
    onDismiss?.();
    if (record) {
      navigate(`/learn/${record.storyId}/lesson-intro`);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    onDismiss?.();
  };

  if (!visible || !record) return null;

  const stepName = resolveStoredStep(record.currentStep)?.label ?? `步驟 ${record.currentStep}`;
  const title = storyTitle ?? record.storyId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="繼續學習提示"
    >
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 space-y-4">
        {/* Icon + title */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-xl">
            📖
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">繼續上次的學習</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              你有一個未完成的學習
            </p>
          </div>
        </div>

        {/* Session info */}
        <div className="bg-amber-50 rounded-xl px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-gray-800 truncate">{title}</p>
          <p className="text-xs text-gray-500">
            上次停在：<span className="font-medium text-accent">{stepName}</span>
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleResume}
            className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-2.5 rounded-full transition-colors text-sm"
          >
            繼續
          </button>
          <button
            onClick={handleRestart}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 rounded-xl transition-colors text-sm"
          >
            重新開始
          </button>
          <button
            onClick={handleDismiss}
            className="w-full text-xs text-gray-400 hover:text-gray-600 py-1 transition-colors"
          >
            稍後再說
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionResumePrompt;
