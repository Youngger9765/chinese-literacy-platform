/**
 * TeacherLiveQuizPodium — 結束畫面：高質感頒獎台（#3630，2026-10-18 規格更正：
 * 前三名的台座上「會」顯示分數，跟名字一起出現 — 不是原先規劃的「投影不顯示分數」）＋
 * 每題答對率（老師查看，不投影也沒關係 — 這是老師自己回顧用）.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getLiveQuizResults, type LiveQuizResults, type LiveQuizState } from '../../../services/liveQuizApi';
import PodiumCeremony from '../../../components/podium/PodiumCeremony';

interface Props {
  state: LiveQuizState;
  token: string;
  code: string;
}

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

      <PodiumCeremony topThree={top3} />

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
