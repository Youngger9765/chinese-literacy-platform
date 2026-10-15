/**
 * TeacherLiveQuizHistory — 歷次課堂搶答: list past games, open one to see
 * final ranking + per-question accuracy (engine.get_game_results).
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listMyLiveQuizGames,
  getLiveQuizResults,
  type LiveQuizGameSummary,
  type LiveQuizResults,
} from '../../../services/liveQuizApi';

const STATUS_LABEL: Record<string, string> = {
  lobby: '等待中',
  question: '進行中',
  reveal: '進行中',
  ended: '已結束',
};

const LiveQuizHistoryDetail: React.FC<{ code: string; token: string }> = ({ code, token }) => {
  const [results, setResults] = useState<LiveQuizResults | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getLiveQuizResults(token, code)
      .then(setResults)
      .catch(() => setError('讀取這場課堂搶答的結果失敗'));
  }, [token, code]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/teacher/live/history" className="mb-4 inline-block text-sm text-accent">
        ← 回歷次課堂搶答
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-on-surface">代碼 {code}</h1>

      {error && <p className="text-sm text-error">{error}</p>}
      {!results && !error && <p className="text-sm text-on-surface-variant">載入中…</p>}

      {results && (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-on-surface">最終排名</h2>
            <ol className="divide-y divide-surface-container-low rounded-xl border border-surface-dim bg-white">
              {results.ranking.map((e) => (
                <li key={e.player_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    {e.rank}. {e.display_name}
                  </span>
                  <span className="font-semibold text-on-surface">{e.total_score} 分</span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-on-surface">每題答對率</h2>
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
                    {r.accuracy != null ? `${Math.round(r.accuracy * 100)}%` : '—'}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
};

const TeacherLiveQuizHistory: React.FC = () => {
  const { code } = useParams<{ code?: string }>();
  const { token } = useAuth();
  const [games, setGames] = useState<LiveQuizGameSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    listMyLiveQuizGames(token)
      .then((res) => setGames(res.games))
      .finally(() => setLoading(false));
  }, [token]);

  if (code) {
    return <LiveQuizHistoryDetail code={code} token={token ?? ''} />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-on-surface">歷次課堂搶答</h1>
      <p className="mb-6 text-sm text-on-surface-variant">班級經營 — 課堂搶答的歷史紀錄</p>

      {loading && <p className="text-sm text-on-surface-variant">載入中…</p>}
      {!loading && games.length === 0 && <p className="text-sm text-on-surface-variant">還沒有開過課堂搶答</p>}

      <ul className="divide-y divide-surface-container-low rounded-xl border border-surface-dim bg-white">
        {games.map((g) => (
          <li key={g.code}>
            <Link
              to={`/teacher/live/history/${g.code}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-container-low"
            >
              <div>
                <p className="text-sm font-medium text-on-surface">
                  代碼 {g.code} · {g.rounds_total} 題 · {g.players_count} 人
                </p>
                <p className="text-xs text-on-surface-variant">{new Date(g.created_at).toLocaleString('zh-TW')}</p>
              </div>
              <span className="shrink-0 rounded-full bg-surface-container-low px-3 py-1 text-xs text-on-surface-variant">
                {STATUS_LABEL[g.status] ?? g.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TeacherLiveQuizHistory;
