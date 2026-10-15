/**
 * TeacherLiveQuizPodium — 結束畫面：頒獎台（前三名，投影不顯示分數）＋
 * 每題答對率（老師查看，不投影也沒關係 — 這是老師自己回顧用）.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getLiveQuizResults, type LiveQuizResults, type LiveQuizState } from '../../../services/liveQuizApi';

interface Props {
  state: LiveQuizState;
  token: string;
  code: string;
}

const MEDALS = ['🥇', '🥈', '🥉'];

const TeacherLiveQuizPodium: React.FC<Props> = ({ state, token, code }) => {
  const [results, setResults] = useState<LiveQuizResults | null>(null);

  useEffect(() => {
    getLiveQuizResults(token, code)
      .then(setResults)
      .catch(() => {
        /* the podium still renders from /state's leaderboard without this */
      });
  }, [token, code]);

  const top3 = state.leaderboard?.slice(0, 3) ?? [];

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <h1 className="mb-8 text-center text-3xl font-bold text-on-surface">
        {state.ended_by_host ? '老師提前結束了這場課堂搶答' : '課堂搶答結束！'}
      </h1>

      <div className="mb-10 flex items-end justify-center gap-6">
        {top3.map((e, i) => (
          <div key={e.player_id} className="flex flex-col items-center">
            <span className="text-5xl" aria-hidden="true">{MEDALS[i]}</span>
            <span className="mt-2 text-lg font-semibold text-on-surface">{e.display_name}</span>
          </div>
        ))}
        {top3.length === 0 && <p className="text-on-surface-variant">沒有玩家完成這場搶答</p>}
      </div>

      {results && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-on-surface">每題答對率（可用來挑錯最多的題目講解）</h2>
          <ol className="divide-y divide-surface-container-low rounded-xl border border-surface-dim bg-white">
            {results.rounds.map((r) => (
              <li key={r.round_index} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-on-surface">
                    {r.round_index + 1}. {r.stem}
                  </p>
                  <p className="text-xs text-on-surface-variant">{r.lesson_title}</p>
                </div>
                <span className="shrink-0 rounded-full bg-surface-container-low px-3 py-1 text-sm font-semibold text-on-surface">
                  {r.accuracy != null ? `${Math.round(r.accuracy * 100)}%` : '—'}（{r.correct}/{r.answered}）
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="flex justify-center gap-3">
        <Link
          to="/teacher/live"
          className="rounded-xl border border-surface-dim px-6 py-3 text-sm font-medium text-on-surface hover:bg-surface-container-low"
        >
          再開一場
        </Link>
        <Link
          to="/teacher/live/history"
          className="rounded-xl bg-accent px-6 py-3 text-sm font-medium text-white hover:bg-accent-hover"
        >
          歷次課堂搶答
        </Link>
      </div>
    </div>
  );
};

export default TeacherLiveQuizPodium;
