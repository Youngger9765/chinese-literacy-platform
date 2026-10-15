/**
 * TeacherLiveQuizReveal — 揭曉畫面：正解、各選項人數、(視設定) 排行榜。
 *
 * PRD §13: 投影只公開前三名、不顯示分數 — this component truncates &
 * strips scores at RENDER time even though the host's own state payload
 * (for classroom-management purposes) does carry full scores.
 */
import React from 'react';
import OptionGrid from '../../../components/live-quiz/OptionGrid';
import type { LiveQuizState } from '../../../services/liveQuizApi';

interface Props {
  state: LiveQuizState;
  onNext: () => void;
  advancing: boolean;
}

const TeacherLiveQuizReveal: React.FC<Props> = ({ state, onNext, advancing }) => {
  const round = state.round;
  if (!round || !round.options) return null;
  const isLast = state.round_index === state.rounds_total - 1;

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-6 py-6 sm:px-10 sm:py-8">
      <p className="mb-2 text-sm text-on-surface-variant">
        第 {state.round_index + 1} / {state.rounds_total} 題 · 已作答 {state.answered_count ?? 0} / {state.players_count}
      </p>
      <p
        className="mb-6 max-w-5xl text-center font-bold leading-snug text-on-surface"
        style={{ fontSize: 'clamp(32px, 6px + 2vw, 44px)' }}
      >
        {round.stem}
      </p>
      <div className="mb-8 w-full max-w-4xl">
        <OptionGrid options={round.options} mode="host" correctKey={round.correct_key} />
      </div>

      {state.leaderboard && state.leaderboard.length > 0 && (
        <div className="mb-8 w-full max-w-md rounded-2xl bg-surface-container-low p-6 text-center">
          <h2 className="mb-3 text-lg font-semibold text-on-surface">
            {isLast ? '最終排行（前三名）' : '目前排行（前三名）'}
          </h2>
          <ol className="space-y-2">
            {state.leaderboard.slice(0, 3).map((e, i) => (
              <li key={e.player_id} className="flex items-center justify-center gap-2 text-base">
                <span aria-hidden="true">{['🥇', '🥈', '🥉'][i]}</span>
                <span className="font-medium">{e.display_name}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={advancing}
        className="rounded-xl bg-accent px-8 py-3 text-lg font-semibold text-white shadow-md hover:bg-accent-hover disabled:opacity-50"
      >
        {advancing ? '處理中…' : isLast ? '查看頒獎台' : '下一題'}
      </button>
    </div>
  );
};

export default TeacherLiveQuizReveal;
