import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  loadActiveSession,
  clearActiveSession,
  ActiveSessionRecord,
  fetchStory,
} from '../services/api';

/**
 * Step index to URL path segment mapping.
 */
const STEP_NUMBER_TO_PATH: Record<number, string> = {
  1: 'intro',
  2: 'tutor',
  3: 'comprehension',
  4: 'vocab',
  5: 'full-reading',
  6: 'report',
};

/**
 * Step names for display.
 */
const STEP_NAMES: Record<number, string> = {
  1: '簡介',
  2: '逐段朗讀',
  3: '課文理解',
  4: '生字練習',
  5: '全文朗讀',
  6: '報告',
};

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

    // Ignore sessions that are at step 1 (just started) — not worth resuming
    // or at step 6 (report = completed) — should have been cleared already
    if (saved.currentStep <= 1 || saved.currentStep >= 6) {
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
    const stepPath = STEP_NUMBER_TO_PATH[record.currentStep] ?? 'intro';
    setVisible(false);
    onDismiss?.();
    navigate(`/learn/${record.storyId}/${stepPath}`);
  };

  const handleRestart = () => {
    if (!user) return;
    clearActiveSession(String(user.id));
    setVisible(false);
    onDismiss?.();
    if (record) {
      navigate(`/learn/${record.storyId}/intro`);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    onDismiss?.();
  };

  if (!visible || !record) return null;

  const stepName = STEP_NAMES[record.currentStep] ?? `步驟 ${record.currentStep}`;
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
            className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-2.5 rounded-xl transition-colors text-sm"
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
