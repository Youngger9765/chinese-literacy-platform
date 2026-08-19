/**
 * KeypointsQADashboard — 課程 QA 診斷（重點表 + 聚光燈）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import StoryStructureTable from '../../components/reading-steps/StoryStructureTable';
import {
  fetchKeypointsLessonDetail,
  fetchKeypointsManifest,
  fetchSpotlightLessonDetail,
  fetchSpotlightManifest,
  originalPreviewUrl,
  type GateResult,
  type KeypointsLessonDetail,
  type KeypointsLessonSummary,
  type KeypointsManifest,
  type SpotlightLessonDetail,
  type SpotlightLessonSummary,
  type SpotlightManifest,
} from '../../services/curriculumQaApi';

type QaTab = 'keypoints' | 'spotlight';

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

function PassBadge({ pass, label }: { pass: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
        pass ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {label} {pass ? '✓' : '✗'}
    </span>
  );
}

// Three states, not two. 34 lessons are new to the second edition and carry no recorded
// verdict; the builder refuses to invent one. Painting `undefined` red said "a human
// looked at this and it failed", which is a different and worse claim than "nobody has
// looked yet".
function OverallDot({ pass }: { pass?: boolean }) {
  const [color, label] =
    pass === undefined
      ? ['bg-gray-300', 'unreviewed']
      : pass
        ? ['bg-green-500', 'pass']
        : ['bg-red-500', 'fail'];
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${color}`}
      aria-label={label}
      title={label === 'unreviewed' ? '尚無人工判讀' : label}
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
              <p className="p-4 text-sm text-gray-400">
                無原文預覽 —— 現有的 136 份是一修渲染，`render_keypoints_html` 讀不了二修
                keypoints.yml，所以這一版沒有產生（#2749）
              </p>
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

const SpotlightDetailPanel: React.FC<{ lesson: SpotlightLessonSummary; token: string }> = ({
  lesson,
  token,
}) => {
  const [detail, setDetail] = useState<SpotlightLessonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSpotlightLessonDetail(token, lesson.lesson_id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lesson.lesson_id, token]);

  if (loading) return <div className="p-6 text-sm text-gray-500">載入聚光燈詳情…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  const ev = lesson.eval;
  return (
    <div className="border-t border-gray-200 bg-gray-50 p-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        <PassBadge pass={!!ev?.pass} label="eval" />
        <PassBadge pass={!!lesson.gold?.match} label="gold" />
        <PassBadge pass={!!ev?.guide_retained} label="guide" />
        <span className="text-xs text-gray-600 self-center">recall {ev?.answer_recall ?? '—'}</span>
        <span className="text-xs text-gray-600 self-center">mcq_leak {ev?.mcq_leakage ?? 0}</span>
      </div>
      {(ev?.struct_errors?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {ev?.struct_errors?.join('；')}
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-gray-800">block 類型分布</h4>
          <pre className="rounded-lg border border-gray-200 bg-white p-3 text-xs h-48 overflow-auto">
            {JSON.stringify(lesson.type_histogram ?? {}, null, 2)}
          </pre>
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-gray-800">gold diff</h4>
          <pre className="rounded-lg border border-gray-200 bg-white p-3 text-xs h-48 overflow-auto">
            {JSON.stringify(lesson.gold?.diffs ?? {}, null, 2)}
          </pre>
        </div>
        <div className="space-y-2 xl:col-span-2">
          <h4 className="text-sm font-bold text-gray-800">spotlight.yml blocks</h4>
          <pre className="rounded-lg border border-gray-200 bg-white p-3 text-xs max-h-96 overflow-auto">
            {JSON.stringify(detail?.spotlight ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
};

const KeypointsTab: React.FC<{ token: string }> = ({ token }) => {
  const [manifest, setManifest] = useState<KeypointsManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pass' | 'fail'>('all');

  const load = useCallback(async () => {
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
    <>
      {summary && (
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 text-sm">
          {/* `pass` counts "not known to fail", which includes lessons nobody has
              reviewed — showing it alone read as 150 approved lessons. */}
          共 {summary.total} 課 · 通過 {summary.pass} · 失敗 {summary.fail}
          {(summary.unreviewed ?? 0) > 0 ? ` · 尚未判讀 ${summary.unreviewed}` : ''}
          {(summary.known_gap_count ?? 0) > 0 ? ` · 已知 gap ${summary.known_gap_count}` : ''}
          {manifest?.smoke_only ? ' （smoke）' : ''}
          <div className="flex gap-2 mt-2">
            {(['all', 'pass', 'fail'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium ${filter === f ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
                {f === 'all' ? '全部' : f === 'pass' ? '通過' : '失敗'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr className="text-left text-gray-600">
              <th className="px-4 py-2 w-8" />
              <th className="px-4 py-2">課碼</th>
              <th className="px-4 py-2">標題</th>
              <th className="px-4 py-2">tier</th>
              {/* Whatever gates the manifest computed — not a fixed L1/L2/L3 triple.
                  L1's source was deleted with the first edition and a per-lesson L2
                  cannot fail, so naming them here drew two badges that meant nothing. */}
              <th className="px-4 py-2">Gate</th>
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
                    <td className="px-4 py-3 text-xs">
                      {lesson.tier}
                      {lesson.known_data_gap ? (
                        <span className="ml-1 text-amber-600">(known)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(lesson.gates ?? {}).map(([name, g]) => (
                          <GateBadge key={name} gate={name} result={g} />
                        ))}
                        {Object.keys(lesson.gates ?? {}).length === 0 && (
                          <span className="text-xs text-gray-400">未評</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{lesson.layout.mode}/{lesson.layout.layout}</td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={6} className="p-0"><LessonDetailPanel lesson={lesson} token={token} /></td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

const SpotlightTab: React.FC<{ token: string }> = ({ token }) => {
  const [manifest, setManifest] = useState<SpotlightManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSpotlightManifest(token)
      .then((m) => { if (!cancelled) setManifest(m); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  if (loading) return <div className="p-8 text-center text-gray-500 text-sm">載入聚光燈 manifest…</div>;
  if (error) return <div className="p-8 text-center text-red-600 text-sm">{error}</div>;

  const summary = manifest?.summary;
  const lessons = manifest?.lessons ?? [];

  return (
    <>
      {summary && (
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 text-sm">
          {/* Not "dev7" any more, and `total` is not the corpus: it counts lessons that
              HAVE a 聚光燈. Showing 168/168 without the other number read as "every
              lesson passes" while seven serve nothing at all (#2747). */}
          有聚光燈 {summary.total} 課 · 通過 {summary.pass} · 失敗 {summary.fail}
          {summary.corpus_total ? ` · 全部課程 ${summary.corpus_total}` : ''}
          {summary.lessons_without_spotlight
            ? ` · 無聚光燈 ${summary.lessons_without_spotlight}`
            : ''}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr className="text-left text-gray-600">
              <th className="px-4 py-2 w-8" />
              <th className="px-4 py-2">課碼</th>
              <th className="px-4 py-2">strategy</th>
              <th className="px-4 py-2">blocks</th>
              <th className="px-4 py-2">eval</th>
              <th className="px-4 py-2">gold</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((lesson) => {
              const isOpen = expanded === lesson.lesson_id;
              return (
                <React.Fragment key={lesson.lesson_id}>
                  <tr className={`border-t border-gray-100 hover:bg-gray-50 cursor-pointer ${isOpen ? 'bg-amber-50/50' : ''}`}
                    onClick={() => setExpanded(isOpen ? null : lesson.lesson_id)}>
                    <td className="px-4 py-3"><OverallDot pass={lesson.overall_pass} /></td>
                    <td className="px-4 py-3 font-mono text-xs">{lesson.lesson_id}</td>
                    <td className="px-4 py-3 text-xs">{lesson.strategy_type ?? '—'}</td>
                    <td className="px-4 py-3">{lesson.block_count ?? '—'}</td>
                    <td className="px-4 py-3"><PassBadge pass={!!lesson.eval?.pass} label="eval" /></td>
                    <td className="px-4 py-3"><PassBadge pass={!!lesson.gold?.match} label="gold" /></td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={6} className="p-0"><SpotlightDetailPanel lesson={lesson} token={token} /></td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

const KeypointsQADashboard: React.FC = () => {
  const { token } = useAuth();
  const [tab, setTab] = useState<QaTab>('keypoints');

  if (!token) return <div className="p-8 text-center text-gray-500 text-sm">請先登入</div>;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-gray-200 bg-white px-6 py-4 shrink-0">
        <h1 className="text-lg font-bold text-gray-900">課程 QA 診斷</h1>
        <p className="text-sm text-gray-500 mt-1">重點表 L1–L3 · 聚光燈 dev7 eval + gold</p>
        <nav className="flex gap-1 mt-3" role="tablist">
          {([
            ['keypoints', '重點表'],
            ['spotlight', '聚光燈'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors cursor-pointer ${
                tab === id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'keypoints' ? <KeypointsTab token={token} /> : <SpotlightTab token={token} />}
    </div>
  );
};

export default KeypointsQADashboard;
