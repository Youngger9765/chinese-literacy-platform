/**
 * TeacherLiveQuizQuestion — 投影出題畫面。Covers BOTH the reading phase
 * (題幹單獨顯示 — `round.options` absent, server-enforced) and the answer
 * window (`round.options` present, countdown running).
 */
import React from 'react';
import OptionGrid from '../../../components/live-quiz/OptionGrid';
import CountdownBar from '../../../components/live-quiz/CountdownBar';
import type { LiveQuizState } from '../../../services/liveQuizApi';

interface Props {
  state: LiveQuizState;
  onReveal: () => void;
  revealing: boolean;
}

const TeacherLiveQuizQuestion: React.FC<Props> = ({ state, onReveal, revealing }) => {
  const round = state.round;
  if (!round) return null;
  const inReadingPhase = !round.options;

  return (
    <div className="flex min-h-screen flex-col bg-surface px-6 py-6 sm:px-10 sm:py-8">
      <div className="mb-4 flex items-center justify-between text-sm text-on-surface-variant">
        <span>
          第 {state.round_index + 1} / {state.rounds_total} 題 · {round.lesson_title}
        </span>
        <span>已作答 {state.answered_count ?? 0} / {state.players_count}</span>
      </div>

      {inReadingPhase ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="mb-6 text-sm font-medium text-accent">看大螢幕讀題</p>
          <p
            className="max-w-5xl font-bold leading-snug text-on-surface"
            style={{ fontSize: 'clamp(40px, 8px + 2.5vw, 56px)' }}
          >
            {round.stem}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="mb-6 flex flex-col items-center text-center">
            <p
              className="mb-4 max-w-5xl font-bold leading-snug text-on-surface"
              style={{ fontSize: 'clamp(40px, 8px + 2.5vw, 56px)' }}
            >
              {round.stem}
            </p>
            {state.answer_open_at && (
              <CountdownBar
                answerOpenAt={state.answer_open_at}
                seconds={round.seconds}
                serverNow={state.server_now}
                mode="host"
              />
            )}
          </div>
          <div className="mx-auto w-full max-w-4xl flex-1">
            <OptionGrid options={round.options ?? []} mode="host" />
          </div>
        </div>
      )}

      {!inReadingPhase && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onReveal}
            disabled={revealing}
            className="rounded-xl bg-accent px-8 py-3 text-lg font-semibold text-white shadow-md hover:bg-accent-hover disabled:opacity-50"
          >
            {revealing ? '揭曉中…' : '揭曉答案'}
          </button>
        </div>
      )}
    </div>
  );
};

export default TeacherLiveQuizQuestion;
