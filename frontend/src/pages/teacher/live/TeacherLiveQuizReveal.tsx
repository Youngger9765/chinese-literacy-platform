/**
 * TeacherLiveQuizReveal — 揭曉畫面：正解、各選項人數、(視設定) 排行榜、
 * (視題目) 看解析。
 *
 * issue #3631 P0 #3/#5 (2026-10-18, Young — overrides the 2026-10-15 "投影
 * 只公開前三名、不顯示分數" decision for THIS screen; the final podium's
 * own "top 3 with scores" rule is #3630, unrelated): per-round reveal now
 * shows the top FIVE with scores, not three without — EXCEPT on the last
 * round, where the leaderboard box is skipped entirely so the "下一題"
 * button goes straight to the podium (same surprise-reveal pacing Kahoot
 * uses) instead of showing an intermediate ranking right before it.
 */
import React, { useState } from 'react';
import OptionGrid from '../../../components/live-quiz/OptionGrid';
import StemWithTarget from '../../../components/live-quiz/StemWithTarget';
import type { LiveQuizState } from '../../../services/liveQuizApi';

interface Props {
  state: LiveQuizState;
  onNext: () => void;
  advancing: boolean;
}

const MEDALS = ['🥇', '🥈', '🥉'];

const TeacherLiveQuizReveal: React.FC<Props> = ({ state, onNext, advancing }) => {
  const [explanationOpen, setExplanationOpen] = useState(false);
  const round = state.round;
  if (!round || !round.options) return null;
  const isLast = state.round_index === state.rounds_total - 1;
  // issue #3631 P0 #5: last round skips the leaderboard box entirely —
  // the host goes straight from "正解揭曉" to the podium, no intermediate
  // ranking screen to spoil the ceremony.
  const top5 = isLast ? [] : (state.leaderboard?.slice(0, 5) ?? []);

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-6 py-6 sm:px-10 sm:py-8">
      <p className="mb-2 text-sm text-on-surface-variant">
        第 {state.round_index + 1} / {state.rounds_total} 題 · 已作答 {state.answered_count ?? 0} / {state.players_count}
      </p>
      <p
        className="mb-6 max-w-5xl text-center font-bold leading-snug text-on-surface"
        style={{ fontSize: 'clamp(32px, 6px + 2vw, 44px)' }}
      >
        <StemWithTarget stem={round.stem} targetIndex={round.extra?.target_index} />
      </p>
      <div className="mb-8 w-full max-w-4xl">
        <OptionGrid options={round.options} mode="host" correctKey={round.correct_key} />
      </div>

      {/* issue #3631 P0 #2: 揭曉畫面多一顆「看解析」按鈕，只在題庫有解析
          文字的題目才出現；預設收合，按了才展開，不自動顯示、不拖慢節奏。 */}
      {round.explanation && (
        <div className="mb-8 w-full max-w-2xl">
          <button
            type="button"
            onClick={() => setExplanationOpen((v) => !v)}
            className="w-full rounded-xl border border-surface-dim bg-white px-4 py-2 text-sm font-medium text-accent hover:bg-surface-container-low"
            aria-expanded={explanationOpen}
          >
            {explanationOpen ? '收起解析 ▲' : '看解析 ▼'}
          </button>
          {explanationOpen && (
            <p className="mt-2 rounded-xl bg-surface-container-low p-4 text-sm leading-relaxed text-on-surface">
              {round.explanation}
            </p>
          )}
        </div>
      )}

      {top5.length > 0 && (
        <div className="mb-8 w-full max-w-md rounded-2xl bg-surface-container-low p-6 text-center">
          <h2 className="mb-3 text-lg font-semibold text-on-surface">目前排行（前五名）</h2>
          <ol className="space-y-2">
            {top5.map((e, i) => (
              <li key={e.player_id} className="flex items-center justify-center gap-3 text-base">
                <span className="w-6 text-right" aria-hidden="true">{MEDALS[i] ?? `${i + 1}.`}</span>
                <span className="font-medium">{e.display_name}</span>
                <span className="text-on-surface-variant">{e.total_score} 分</span>
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
