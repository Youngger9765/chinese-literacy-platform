/**
 * ReportCharts — 成績單的雷達圖與歷次作答折線圖（#4087）
 *
 * 資料全部來自 DB（step_progress.step_data[*].attempts），邏輯在 reportCardsModel.ts。
 * 學生端與老師端共用（StepReportCards）。
 */
import React, { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RadarPoint, StepReportCard } from './reportCardsModel';
import { strengthsOf } from './reportCardsModel';
import type { AttemptKind, AttemptRow, StepAttempt } from '../../utils/stepAttempts';

const KIND_LABEL: Record<AttemptKind, string> = {
  first: '第一次作答',
  'retry-all': '重新作答',
  'retry-wrong': '訂正錯題',
  reading: '朗讀',
};

/** ISO → 「11/16 14:05」（台灣時間）。 */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

function scoreText(a: StepAttempt): string {
  if (a.kind === 'reading') {
    const parts = [];
    if (typeof a.cpm === 'number') parts.push(`每分鐘 ${a.cpm} 字`);
    if (typeof a.accuracy === 'number') parts.push(`正確率 ${a.accuracy}%`);
    return parts.join('・');
  }
  return typeof a.correct === 'number' && typeof a.total === 'number' ? `答對 ${a.correct}/${a.total}` : '';
}

// ── 雷達圖 ──────────────────────────────────────────────────────────────

const RADAR_STATE_TEXT: Record<Exclude<RadarPoint['state'], 'scored'>, string> = {
  absent: '本課無',
  todo: '還沒做',
  unscored: '無紀錄',
};

export const RadarPanel: React.FC<{ points: RadarPoint[]; average?: RadarPoint[] | null }> = ({ points, average }) => {
  const anyScored = points.some((p) => p.state === 'scored');
  const { strong, weak } = strengthsOf(points);
  const data = points.map((p) => ({
    axis: p.state === 'scored' ? p.label : `${p.label}（${RADAR_STATE_TEXT[p.state]}）`,
    value: p.value ?? 0,
    // #4162：最近 5 課平均（沒有分數的項目畫在 0，跟本課同一個處理）
    avg: average?.find((a) => a.key === p.key)?.value ?? 0,
  }));

  return (
    <section className="rounded-3xl bg-surface-container-lowest shadow-editorial p-6" data-testid="report-radar">
      <h3 className="font-headline font-bold text-lg text-on-surface">我的能力分布</h3>
      <p className="text-xs text-on-surface-variant mt-1">
        分數是各關「最近一次完整作答」第一次就答對的比例（訂正不算；朗讀看正確率），滿分 100。
      </p>
      {anyScored ? (
        <>
          <div className="h-64 mt-2" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data} outerRadius="70%">
                <PolarGrid />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12 }} />
                <PolarRadiusAxis domain={[0, 100]} tickCount={5} tick={{ fontSize: 10 }} />
                {average && (
                  <Radar dataKey="avg" name="最近 5 課平均" stroke="#6b7280" strokeDasharray="5 4" fill="none" />
                )}
                <Radar dataKey="value" name="這課" stroke="#4f46e5" fill="#6366f1" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          {average && (
            <p className="text-xs text-on-surface-variant mt-1 text-center" data-testid="report-radar-legend">
              實線：這課　虛線：最近 5 課平均
            </p>
          )}
          {/* 給螢幕閱讀器與窄螢幕：同一份資料的文字版 */}
          <ul className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2" aria-label="各項能力分數">
            {points.map((p) => (
              <li key={p.key} className="rounded-xl bg-surface-container-low px-3 py-2 text-center">
                <div className="text-xs text-on-surface-variant">{p.label}</div>
                <div className="font-headline font-bold text-on-surface">
                  {p.state === 'scored' ? p.value : RADAR_STATE_TEXT[p.state]}
                </div>
                {average && (() => {
                  const a = average.find((x) => x.key === p.key)?.value;
                  return typeof a === 'number' ? (
                    <div className="text-[11px] text-on-surface-variant">平均 {a}</div>
                  ) : null;
                })()}
              </li>
            ))}
          </ul>
          {(strong.length > 0 || weak.length > 0) && (
            <p className="mt-3 text-sm text-on-surface" data-testid="report-radar-summary">
              {strong.length > 0 && <>強項：<strong className="text-emerald-700">{strong.join('、')}</strong></>}
              {strong.length > 0 && weak.length > 0 && '　'}
              {weak.length > 0 && <>需要加強：<strong className="text-amber-800">{weak.join('、')}</strong></>}
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-on-surface-variant">做完有對錯的關卡之後，這裡會畫出你的強項和弱項。</p>
      )}
    </section>
  );
};

// ── 歷次作答 ────────────────────────────────────────────────────────────

const RowList: React.FC<{ rows: AttemptRow[] }> = ({ rows }) => (
  <ul className="space-y-2">
    {rows.map((r, i) => (
      <li
        key={i}
        className={`rounded-xl border px-3 py-2 text-sm ${
          r.correct ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-on-surface">{r.label}</span>
          <span className={`text-xs font-bold ${r.correct ? 'text-emerald-700' : 'text-amber-700'}`}>
            {r.correct ? '✓ 答對' : '✗ 答錯'}
          </span>
        </div>
        {r.prompt && <p className="mt-1 text-on-surface">{r.prompt}</p>}
        {!r.correct && (r.studentAnswer || r.correctAnswer) && (
          <div className="mt-1 space-y-0.5 text-on-surface-variant">
            {r.studentAnswer && <p>你選：{r.studentAnswer}</p>}
            {r.correctAnswer && <p>正確答案：{r.correctAnswer}</p>}
          </div>
        )}
      </li>
    ))}
  </ul>
);

/**
 * 有兩次以上作答：折線圖 + 引導點節點 + 選到的那一次的作答結果。
 * 呼叫端只在 attempts.length >= 2 時用它。
 */
export const AttemptsPanel: React.FC<{ card: StepReportCard }> = ({ card }) => {
  const attempts = card.attempts;
  const [selected, setSelected] = useState(attempts.length - 1);
  const isReading = card.chart === 'reading';
  const maxTotal = Math.max(1, ...attempts.map((a) => a.total ?? 0));
  const data = attempts.map((a, i) => ({
    // 每個點自己帶著「第幾次」—— 點擊時直接讀它，不靠 recharts 推算位置（#4087 手測）。
    attemptIndex: i,
    n: `第${i + 1}次`,
    correct: a.correct ?? null,
    cpm: a.cpm ?? null,
    accuracy: a.accuracy ?? null,
  }));
  const current = attempts[selected];
  const first = attempts[0];
  const last = attempts[attempts.length - 1];
  const progress = isReading
    ? (last.cpm ?? 0) - (first.cpm ?? 0)
    : (last.correct ?? 0) - (first.correct ?? 0);

  // 點節點選那一次。只在節點本身處理點擊：先前另外在整張圖上用 activeTooltipIndex
  // 選「最近的點」，那個推算會算錯（桌機點第 3 個點跳到第 1 次），而且跟節點的點擊
  // 前後各觸發一次、後者蓋掉前者。節點外面加一圈透明的大範圍，手指好點。
  const dot = (key: string, color: string) =>
    (props: { cx?: number; cy?: number; payload?: { attemptIndex?: number } }) => {
      const { cx, cy } = props;
      const i = props.payload?.attemptIndex ?? -1;
      if (cx == null || cy == null || i < 0) return <g key={`${key}-${i}`} />;
      const on = i === selected;
      return (
        <g
          key={`${key}-${i}`}
          data-attempt-index={i}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            setSelected(i);
          }}
        >
          <circle cx={cx} cy={cy} r={18} fill="transparent" />
          <circle cx={cx} cy={cy} r={on ? 8 : 6} fill={on ? color : '#fff'} stroke={color} strokeWidth={3} />
        </g>
      );
    };

  return (
    <section className="space-y-3" data-testid="attempts-panel">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-on-surface-variant">歷次作答（{attempts.length} 次）</h4>
        {progress > 0 && (
          <span className="text-xs font-bold text-emerald-700">
            {isReading ? `每分鐘多唸 ${progress} 字` : `比第一次多對 ${progress} 題`} 🎉
          </span>
        )}
      </div>
      <p className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1 text-xs font-bold text-accent">
        <span className="material-symbols-outlined text-sm" aria-hidden="true">touch_app</span>
        點折線上的點（或下面的按鈕），看那一次怎麼答
      </p>
      <div className="h-48" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 10, right: isReading ? 10 : 16, bottom: 0, left: -16 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="n" tick={{ fontSize: 11 }} />
            {isReading ? (
              <>
                <YAxis yAxisId="cpm" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="acc" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line yAxisId="cpm" dataKey="cpm" name="每分鐘字數" stroke="#4f46e5" strokeWidth={2} dot={dot('cpm', '#4f46e5')} activeDot={false} isAnimationActive={false} />
                <Line yAxisId="acc" dataKey="accuracy" name="正確率 %" stroke="#059669" strokeWidth={2} dot={dot('acc', '#059669')} activeDot={false} isAnimationActive={false} />
              </>
            ) : (
              <>
                <YAxis domain={[0, maxTotal]} allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line dataKey="correct" name="答對題數" stroke="#4f46e5" strokeWidth={2} dot={dot('c', '#4f46e5')} activeDot={false} isAnimationActive={false} />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="選擇第幾次作答">
        {attempts.map((a, i) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelected(i)}
            aria-pressed={i === selected}
            className={`rounded-full border px-3 py-1 text-xs font-bold ${
              i === selected ? 'border-accent bg-accent text-white' : 'border-outline-variant text-on-surface'
            }`}
          >
            第 {i + 1} 次 · {isReading ? `${a.cpm ?? '–'} 字` : `${a.correct ?? '–'}/${a.total ?? '–'}`}
          </button>
        ))}
      </div>
      {current && (
        <div className="rounded-2xl bg-surface-container-low p-4 space-y-3" data-testid="attempt-detail">
          <p className="text-sm font-bold text-on-surface">
            第 {selected + 1} 次・{KIND_LABEL[current.kind]}・{when(current.at)}
          </p>
          <p className="text-sm text-on-surface">{scoreText(current)}</p>
          {current.rows?.length ? <RowList rows={current.rows} /> : null}
        </div>
      )}
    </section>
  );
};
