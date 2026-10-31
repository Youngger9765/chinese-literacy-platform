/**
 * ReadingBabyIndicatorsPanel — 班級數據 › 能力指標（#3780 第三階段，
 * docs/design/reading-babies/ability-indicators.md §5）。
 *
 * 三個畫面，同一份證據表（student_indicator_evidence）換成課綱學習表現：
 *   ① 班級 × 能力指標熱力表
 *   ② 單一學生能力清單（點學生姓名）
 *   ③ 這個判斷是哪幾課、哪幾題撐起來的（點格子或清單的一列）
 *
 * 固定顯示「課綱對照為草稿，待老師審核」——課對指標全部是 AI 推論，教授
 * 審核表回填前不可當正式對照（PRD §7）。依學習扶助對標結論，這裡**不加**
 * 「是否達學習扶助基本內容」欄（learning-support-alignment.md）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  fetchClassroomIndicatorHeatmap,
  fetchIndicatorEvidenceDetail,
  type ClassroomIndicatorHeatmap,
  type IndicatorCell,
  type IndicatorEvidenceDetail,
  type IndicatorEvidenceItem,
  type IndicatorStatus,
} from '../../../services/teacherReadingBabyApi';

export const DRAFT_NOTICE = '課綱對照為草稿，待老師審核';

const STATUS_LABEL: Record<IndicatorStatus, string> = {
  transferable: '帶得走',
  achieved: '達成',
  only_participated: '只參與',
  not_achieved: '未達',
  insufficient_data: '資料不足',
  not_assigned: '',
};

const STATUS_CLASS: Record<IndicatorStatus, string> = {
  transferable: 'bg-emerald-600 text-white',
  achieved: 'bg-emerald-100 text-emerald-800',
  only_participated: 'bg-sky-50 text-sky-700',
  not_achieved: 'bg-orange-100 text-orange-800',
  insufficient_data:
    'text-gray-500 bg-[repeating-linear-gradient(135deg,#f3f4f6_0,#f3f4f6_6px,#e5e7eb_6px,#e5e7eb_8px)]',
  not_assigned: 'text-gray-300',
};

const STATUS_RULE: Record<IndicatorStatus, string> = {
  transferable: '兩課以上在這條指標做得好',
  achieved: '至少一課在這條指標做得好',
  not_achieved: '題數已經足夠，但還沒有一課在這條指標做得好',
  insufficient_data: '累積題數還太少，先不下判斷',
  only_participated: '只做了沒有對錯的站，只記參與',
  not_assigned: '還沒有紀錄',
};

const LEGEND: IndicatorStatus[] = ['transferable', 'achieved', 'only_participated', 'not_achieved', 'insufficient_data'];

type View =
  | { kind: 'heatmap' }
  | { kind: 'student'; studentId: number }
  | { kind: 'detail'; studentId: number; code: string; from: 'heatmap' | 'student' };

function shortText(text: string | null | undefined, max = 10): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 從原始作答資料讀逐題首答（目前只有 mcAnswers／dragDropAnswers 這種格式有逐題紀錄）。 */
export function firstTryItems(sourceRef: Record<string, unknown> | null): boolean[] {
  const raw = sourceRef?.raw_step_data;
  if (!raw || typeof raw !== 'object') return [];
  const layers = [raw as Record<string, unknown>];
  const result = (raw as Record<string, unknown>).result;
  if (result && typeof result === 'object') layers.push(result as Record<string, unknown>);
  const out: boolean[] = [];
  for (const layer of layers) {
    for (const key of ['mcAnswers', 'dragDropAnswers']) {
      const arr = layer[key];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (item && typeof item === 'object' && 'firstTryCorrect' in item) {
          out.push(Boolean((item as { firstTryCorrect: unknown }).firstTryCorrect));
        }
      }
    }
  }
  return out;
}

const DraftNotice: React.FC = () => (
  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
    {DRAFT_NOTICE}
  </p>
);

const StatusChip: React.FC<{ status: IndicatorStatus }> = ({ status }) => (
  <span className={`inline-block whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium ${STATUS_CLASS[status]}`}>
    {status === 'not_assigned' ? '—' : STATUS_LABEL[status]}
  </span>
);

const HeatmapView: React.FC<{
  data: ClassroomIndicatorHeatmap;
  cellOf: (sid: number, code: string) => IndicatorCell | undefined;
  nameOf: (sid: number) => string;
  onStudent: (sid: number) => void;
  onCell: (sid: number, code: string) => void;
}> = ({ data, cellOf, nameOf, onStudent, onCell }) => {
  const total = data.student_ids.length;
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2 text-xs text-gray-600" aria-label="狀態說明">
        {LEGEND.map((s) => (
          <li key={s} className="flex items-center gap-1">
            <StatusChip status={s} />
            <span>{STATUS_RULE[s]}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-500">點學生姓名看他的能力清單；點格子看是哪幾課、哪幾題撐起這個判斷。滑過欄頭看課綱原文。</p>
      <p className="text-xs text-gray-400 sm:hidden">← 左右滑動看更多 →</p>
      <div className="overflow-x-auto">
        <table aria-label="班級 × 能力指標" className="min-w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white px-2 text-left font-medium text-gray-500">學生</th>
              {data.indicator_codes.map((code) => {
                const text = data.indicators?.find((i) => i.code === code)?.text ?? null;
                return (
                  <th
                    key={code}
                    scope="col"
                    title={text ?? undefined}
                    className="min-w-[88px] px-1 align-bottom text-center font-medium text-gray-700"
                  >
                    <span className="block whitespace-nowrap">{code}</span>
                    <span className="block text-xs font-normal text-gray-400">{shortText(text, 8)}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-gray-50">
              <th scope="row" className="sticky left-0 z-10 bg-gray-50 px-2 text-left font-bold text-gray-700">全班</th>
              {data.indicator_codes.map((code) => {
                const ok = data.student_ids.filter((sid) => {
                  const st = cellOf(sid, code)?.status;
                  return st === 'achieved' || st === 'transferable';
                }).length;
                return (
                  <td key={code} className="text-center font-bold text-gray-700">
                    {total ? `${Math.round((ok / total) * 100)}%` : '—'}
                  </td>
                );
              })}
            </tr>
            {data.student_ids.map((sid) => (
              <tr key={sid}>
                <th scope="row" className="sticky left-0 z-10 bg-white px-2 text-left">
                  <button
                    type="button"
                    onClick={() => onStudent(sid)}
                    className="whitespace-nowrap font-medium text-accent hover:underline cursor-pointer"
                  >
                    {nameOf(sid)}
                  </button>
                </th>
                {data.indicator_codes.map((code) => {
                  const cell = cellOf(sid, code);
                  const status = cell?.status ?? 'not_assigned';
                  return (
                    <td key={code} className="text-center">
                      {status === 'not_assigned' ? (
                        <StatusChip status={status} />
                      ) : (
                        <button
                          type="button"
                          aria-label={`${nameOf(sid)} ${code} ${STATUS_LABEL[status]}`}
                          onClick={() => onCell(sid, code)}
                          className="w-full cursor-pointer rounded-md hover:ring-2 hover:ring-accent"
                        >
                          <StatusChip status={status} />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">「全班」＝這條指標「達成」或「帶得走」的人數比例</p>
    </div>
  );
};

const StudentView: React.FC<{
  name: string;
  cells: IndicatorCell[];
  textOf: (code: string) => string | null;
  onBack: () => void;
  onOpen: (code: string) => void;
}> = ({ name, cells, textOf, onBack, onOpen }) => (
  <div className="space-y-3">
    <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:text-accent cursor-pointer">
      ← 回熱力表
    </button>
    <h3 className="text-base font-bold text-gray-900">{name}的能力指標</h3>
    {cells.length === 0 ? (
      <p className="text-gray-500">{name}還沒有能力指標紀錄</p>
    ) : (
      <div className="overflow-x-auto">
        <table aria-label={`${name}的能力指標`} className="min-w-full text-sm">
          <thead>
            <tr className="whitespace-nowrap border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-3 font-medium">指標</th>
              <th className="py-2 pr-3 font-medium">狀態</th>
              <th className="py-2 pr-3 font-medium whitespace-nowrap">做得好的課</th>
              <th className="py-2 pr-3 font-medium whitespace-nowrap">累積題數</th>
              <th className="py-2 font-medium"><span className="sr-only">證據</span></th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <tr key={c.indicator_code} className="border-b border-gray-100">
                <td className="min-w-[180px] py-2 pr-3">
                  <span className="whitespace-nowrap font-medium text-gray-900">{c.indicator_code}</span>
                  <span className="block text-xs text-gray-500">{textOf(c.indicator_code)}</span>
                </td>
                <td className="py-2 pr-3"><StatusChip status={c.status} /></td>
                <td className="py-2 pr-3 text-gray-700">{c.passed_lesson_count} 課</td>
                <td className="py-2 pr-3 text-gray-700">{c.total_items}</td>
                <td className="py-2">
                  <button
                    type="button"
                    aria-label={`看 ${c.indicator_code} 的證據`}
                    onClick={() => onOpen(c.indicator_code)}
                    className="whitespace-nowrap rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-accent hover:bg-accent-bg cursor-pointer"
                  >
                    看證據 →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

const EvidenceRow: React.FC<{ item: IndicatorEvidenceItem }> = ({ item }) => {
  const title = item.lesson_title ?? item.lesson_uid;
  const perItem = firstTryItems(item.source_ref);
  let measure: string;
  // completion 站沒有對錯，只記參與，不能顯示成「還沒做到」——那會讓老師以為
  // 學生做錯了。用後端存的 signal_type 判斷，不用「沒有題數」推測：計分站讀不到
  // 作答格式時（fail-closed）也是沒有題數，那種要照實顯示「還沒做到」。
  const participationOnly = item.signal_type === 'completion';
  if (item.items_total != null && item.items_first_try_correct != null && item.items_total > 0) {
    const pct = Math.round((item.items_first_try_correct / item.items_total) * 100);
    measure = `首答 ${item.items_first_try_correct}/${item.items_total}（${pct}%）`;
  } else if (item.cpm != null) {
    measure = `每分鐘 ${Math.round(item.cpm)} 字${item.accuracy != null ? `、正確率 ${Math.round(item.accuracy)}%` : ''}`;
  } else {
    measure = '完成（沒有對錯紀錄）';
  }
  return (
    <li className="rounded-xl border border-gray-200 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-bold text-gray-900">{title}</span>
        <span className="text-xs text-gray-400">{item.lesson_uid}</span>
        <span className="text-sm text-gray-500">{formatDate(item.created_at)}</span>
        <span className="text-sm text-gray-700">{item.station_label ?? item.station}</span>
        <span className="text-sm text-gray-700">{measure}</span>
        {participationOnly ? (
          <span className="text-sm font-medium text-sky-700">只記參與</span>
        ) : (
          <span className={`text-sm font-medium ${item.quality_passed ? 'text-emerald-700' : 'text-orange-700'}`}>
            {item.quality_passed ? '做得好' : '還沒做到'}
          </span>
        )}
      </div>
      {perItem.length > 0 && (
        <ul aria-label={`${title} 逐題首答`} className="mt-2 flex flex-wrap gap-2 text-sm">
          {perItem.map((ok, i) => (
            <li
              key={i}
              className={`rounded-md px-2 py-0.5 ${ok ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-800'}`}
            >
              {`第 ${i + 1} 題 首答${ok ? '答對' : '答錯'}`}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

const DetailView: React.FC<{
  classroomId: number;
  token: string;
  studentId: number;
  code: string;
  name: string;
  status: IndicatorStatus;
  onBackToHeatmap: () => void;
  onBackToStudent?: () => void;
}> = ({ classroomId, token, studentId, code, name, status, onBackToHeatmap, onBackToStudent }) => {
  const [detail, setDetail] = useState<IndicatorEvidenceDetail | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(false);
    setDetail(null);
    fetchIndicatorEvidenceDetail(token, classroomId, studentId, code)
      .then((res) => { if (alive) setDetail(res); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [token, classroomId, studentId, code, attempt]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <button type="button" onClick={onBackToHeatmap} className="text-gray-500 hover:text-accent cursor-pointer">
          ← 回熱力表
        </button>
        {onBackToStudent && (
          <button type="button" onClick={onBackToStudent} className="text-gray-500 hover:text-accent cursor-pointer">
            ← 回{name}的清單
          </button>
        )}
      </div>
      <h3 className="text-base font-bold text-gray-900">
        {detail?.student_name ?? name} × {code}
        {detail?.indicator_text && <span className="font-normal text-gray-700">「{detail.indicator_text}」</span>}
      </h3>
      <p className="text-sm text-gray-700">
        判定：<StatusChip status={status} /> <span className="text-gray-500">（{STATUS_RULE[status]}）</span>
      </p>
      {error ? (
        <div>
          <p className="mb-2 text-red-600">證據載入失敗</p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover"
          >
            重新載入
          </button>
        </div>
      ) : !detail ? (
        <p className="text-gray-400">證據載入中…</p>
      ) : detail.evidence.length === 0 ? (
        <p className="text-gray-500">這條指標還沒有紀錄</p>
      ) : (
        <ul className="space-y-2" aria-label="撐起這個判斷的課與題">
          {detail.evidence.map((item, i) => (
            <EvidenceRow key={`${item.lesson_uid}-${item.station}-${i}`} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
};

const ReadingBabyIndicatorsPanel: React.FC<{ classroomId: number }> = ({ classroomId }) => {
  const { token } = useAuth();
  const [data, setData] = useState<ClassroomIndicatorHeatmap | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>({ kind: 'heatmap' });

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setError(false);
    setData(null);
    fetchClassroomIndicatorHeatmap(token, classroomId)
      .then((res) => { if (alive) setData(res); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [token, classroomId, attempt]);

  const cellOf = useMemo(() => {
    const map = new Map<string, IndicatorCell>();
    for (const c of data?.cells ?? []) map.set(`${c.student_id}|${c.indicator_code}`, c);
    return (sid: number, code: string) => map.get(`${sid}|${code}`);
  }, [data]);

  const nameOf = useCallback(
    (sid: number) => data?.students?.find((s) => s.student_id === sid)?.name ?? `學生 ${sid}`,
    [data],
  );
  const textOf = useCallback(
    (code: string) => data?.indicators?.find((i) => i.code === code)?.text ?? null,
    [data],
  );

  let body: React.ReactNode;
  if (error) {
    body = (
      <div className="py-8 text-center">
        <p className="mb-3 text-red-600">能力指標載入失敗</p>
        <button
          type="button"
          onClick={() => setAttempt((a) => a + 1)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover"
        >
          重新載入
        </button>
      </div>
    );
  } else if (!data) {
    body = <p className="py-8 text-center text-gray-400">能力指標載入中…</p>;
  } else if (data.indicator_codes.length === 0) {
    body = (
      <p className="py-8 text-center text-gray-500">
        這個班的學生還沒有能力指標紀錄。學生在課程裡完成各站之後，這裡就會出現。
      </p>
    );
  } else if (view.kind === 'heatmap') {
    body = (
      <HeatmapView
        data={data}
        cellOf={cellOf}
        nameOf={nameOf}
        onStudent={(studentId) => setView({ kind: 'student', studentId })}
        onCell={(studentId, code) => setView({ kind: 'detail', studentId, code, from: 'heatmap' })}
      />
    );
  } else if (view.kind === 'student') {
    body = (
      <StudentView
        name={nameOf(view.studentId)}
        cells={data.indicator_codes
          .map((code) => cellOf(view.studentId, code))
          .filter((c): c is IndicatorCell => !!c && c.status !== 'not_assigned')}
        textOf={textOf}
        onBack={() => setView({ kind: 'heatmap' })}
        onOpen={(code) => setView({ kind: 'detail', studentId: view.studentId, code, from: 'student' })}
      />
    );
  } else {
    body = (
      <DetailView
        classroomId={classroomId}
        token={token ?? ''}
        studentId={view.studentId}
        code={view.code}
        name={nameOf(view.studentId)}
        status={cellOf(view.studentId, view.code)?.status ?? 'not_assigned'}
        onBackToHeatmap={() => setView({ kind: 'heatmap' })}
        onBackToStudent={view.from === 'student' ? () => setView({ kind: 'student', studentId: view.studentId }) : undefined}
      />
    );
  }

  return (
    <section className="space-y-4 p-4 sm:p-5" aria-label="能力指標">
      <header className="space-y-2">
        <h2 className="text-lg font-bold text-gray-900">能力指標</h2>
        <DraftNotice />
      </header>
      {body}
    </section>
  );
};

export default ReadingBabyIndicatorsPanel;
