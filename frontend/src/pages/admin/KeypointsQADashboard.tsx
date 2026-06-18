/**
 * KeypointsQADashboard — 重點表 curriculum QA 診斷頁 (Phase 0)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import StoryStructureTable from '../../components/reading-steps/StoryStructureTable';
import {
  fetchKeypointsLessonDetail,
  fetchKeypointsManifest,
  originalPreviewUrl,
  type GateResult,
  type KeypointsLessonDetail,
  type KeypointsLessonSummary,
  type KeypointsManifest,
} from '../../services/curriculumQaApi';

function GateBadge({ gate, result }: { gate: string; result?: GateResult }) {
  if (!result) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-400">
        {gate} —
      </span>
    );
  }
  const ok = result.pass;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
        ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
      title={result.issues.join('\n') || undefined}
    >
      {gate} {ok ? '✓' : '✗'}
    </span>
  );
}

function OverallDot({ pass }: { pass: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${pass ? 'bg-green-500' : 'bg-red-500'}`}
      aria-label={pass ? 'pass' : 'fail'}
    />
  );
}

const LessonDetailPanel: React.FC<{ lesson: KeypointsLessonSummary; token: string }> = ({
  lesson,
  token,
}) => {
  const [detail, setDetail] = useState<KeypointsLessonDetail | null>(null);
  const [originalHtml, setOriginalHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      fetchKeypointsLessonDetail(token, lesson.lesson_id),
      fetch(originalPreviewUrl(lesson.lesson_id), {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.text() : '')),
    ])
      .then(([d, html]) => {
        if (cancelled) return;
        setDetail(d);
        setOriginalHtml(html);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lesson.lesson_id, token]);

  if (loading) return <div className="p-6 text-sm text-gray-500">載入課程詳情…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  const gates = Object.entries(lesson.gates || {});

  return (
    <div className="border-t border-gray-200 bg-gray-50 p-4 space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-semibold text-gray-700">Gate 明細</span>
        {gates.map(([name, g]) => (
          <GateBadge key={name} gate={name} result={g} />
        ))}
      </div>
      {gates.some(([, g]) => g.issues.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
          {gates.map(([name, g]) =>
            g.issues.length ? (
              <div key={name}>
                <span className="font-semibold">{name}:</span> {g.issues.join('；')}
              </div>
            ) : null,
          )}
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-gray-800">① 原文（keypoints 抽取 HTML）</h4>
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden h-72">
            {originalHtml ? (
              <iframe title={`${lesson.lesson_id} original`} srcDoc={originalHtml} className="w-full h-full border-0" sandbox="" />
            ) : (
              <p className="p-4 text-sm text-gray-400">無原文預覽</p>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-gray-800">② keypoints.yml</h4>
          <pre className="rounded-lg border border-gray-200 bg-white p-3 text-xs overflow-auto h-72 text-gray-800">
            {JSON.stringify(detail?.keypoints ?? {}, null, 2)}
          </pre>
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-gray-800">③ layout</h4>
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm space-y-2 h-72 overflow-auto">
            <div>tier <span className="font-mono">{lesson.tier}</span></div>
            <div>mode <span className="font-mono">{lesson.layout.mode ?? '—'}</span></div>
            <div>layout <span className="font-mono">{lesson.layout.layout ?? '—'}</span></div>
            <div>fill_blank {lesson.layout.fill_blank_count ?? 0}</div>
            <div>checkbox {lesson.layout.checkbox_count ?? 0}</div>
            <div>rows {lesson.layout.row_count ?? 0}</div>
          </div>
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-gray-800">④ Render</h4>
          <div className="rounded-lg border border-gray-200 bg-white p-2 h-72 overflow-auto">
            {lesson.story_id ? (
              <StoryStructureTable storyId={String(lesson.story_id)} />
            ) : (
              <p className="p-4 text-sm text-gray-400">無 story_id</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const KeypointsQADashboard: React.FC = () => {
  const { token } = useAuth();
  const [manifest, setManifest] = useState<KeypointsManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pass' | 'fail'>('all');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      setManifest(await fetchKeypointsManifest(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const lessons = useMemo(() => {
    const list = manifest?.lessons ?? [];
    if (filter === 'pass') return list.filter((l) => l.overall_pass);
    if (filter === 'fail') return list.filter((l) => !l.overall_pass);
    return list;
  }, [manifest, filter]);

  if (loading) return <div className="p-8 text-center text-gray-500 text-sm">載入 manifest…</div>;
  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 text-sm mb-2">{error}</p>
        <button type="button" onClick={load} className="text-sm text-violet-600 underline">重試</button>
      </div>
    );
  }

  const summary = manifest?.summary;
  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-gray-200 bg-white px-6 py-4 shrink-0">
        <h1 className="text-lg font-bold text-gray-900">重點表 QA 診斷</h1>
        <p className="text-sm text-gray-500 mt-1">DOCX → yml → API → 畫面；L1–L3 紅綠燈</p>
        {summary && (
          <p className="text-sm mt-2">
            共 {summary.total} 課 · 通過 {summary.pass} · 失敗 {summary.fail}
            {manifest?.smoke_only ? ' （smoke）' : ''}
          </p>
        )}
        <div className="flex gap-2 mt-3">
          {(['all', 'pass', 'fail'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${filter === f ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {f === 'all' ? '全部' : f === 'pass' ? '通過' : '失敗'}
            </button>
          ))}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr className="text-left text-gray-600">
              <th className="px-4 py-2 w-8" />
              <th className="px-4 py-2">課碼</th>
              <th className="px-4 py-2">標題</th>
              <th className="px-4 py-2">tier</th>
              <th className="px-4 py-2">L1</th>
              <th className="px-4 py-2">L2</th>
              <th className="px-4 py-2">L3</th>
              <th className="px-4 py-2">layout</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((lesson) => {
              const isOpen = expanded === lesson.lesson_id;
              return (
                <React.Fragment key={lesson.lesson_id}>
                  <tr className={`border-t border-gray-100 hover:bg-gray-50 cursor-pointer ${isOpen ? 'bg-violet-50/50' : ''}`}
                    onClick={() => setExpanded(isOpen ? null : lesson.lesson_id)}>
                    <td className="px-4 py-3"><OverallDot pass={lesson.overall_pass} /></td>
                    <td className="px-4 py-3 font-mono text-xs">{lesson.lesson_id}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate">{lesson.title}</td>
                    <td className="px-4 py-3 text-xs">{lesson.tier}</td>
                    <td className="px-4 py-3"><GateBadge gate="L1" result={lesson.gates.L1} /></td>
                    <td className="px-4 py-3"><GateBadge gate="L2" result={lesson.gates.L2} /></td>
                    <td className="px-4 py-3"><GateBadge gate="L3" result={lesson.gates.L3} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{lesson.layout.mode}/{lesson.layout.layout}</td>
                  </tr>
                  {isOpen && token && (
                    <tr><td colSpan={8} className="p-0"><LessonDetailPanel lesson={lesson} token={token} /></td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default KeypointsQADashboard;
