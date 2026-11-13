/**
 * StepReportCards — 報告頁：每一關一張卡片，完成打綠勾，點開看細節（#3399）
 *
 * 取代學生學習流程裡的 AssessmentReport（AI 診斷、六環節分析、折線圖…）。
 * Mentor：「不用搞很多複雜的 AI 診斷，只需要將完成的部分以區塊的方式顯現」。
 *
 * 資料全部來自 DB（step_progress + annotation_entries），邏輯在 reportCardsModel.ts。
 *
 * #4028：回到做過的課時，#2889 會把上次的進度帶過來。卡片分三種：
 * 這次完成（綠勾）、上次完成（灰藍、標日期，這次還沒做）、未完成。進度條只算這次。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerRow, CardStatus, DetailBlock, MarkedWord, StepReportCard } from './reportCardsModel';

interface Props {
  storyTitle?: string;
  cards: StepReportCard[];
  /** 未完成的關卡可以直接前往。 */
  onGoToStep?: (stepId: string) => void;
  /**
   * #4028：這次什麼都還沒做，頁面改顯示繼承來源那一次的成果時給這個。
   * 標題會標明是哪一次，進度條改成「那次完成」，免得被當成這次做的。
   */
  previousAttempt?: { at: string | null } | null;
}

/** ISO → 「11/13 14:05」（台灣時間）。 */
function dateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

const MARK_STYLE: Record<MarkedWord['type'], { icon: string; label: string; chip: string }> = {
  unknown: { icon: '❓', label: '不懂', chip: 'bg-red-50 text-red-800 border-red-200' },
  important: { icon: '💛', label: '重要', chip: 'bg-yellow-100 text-yellow-900 border-yellow-300' },
};

/** ISO → 「11/10」（台灣時間）；解析不了就回 null。 */
export function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(d);
}

/**
 * 「這次完成」的字樣。整頁在看最近一次（不是這次）的成果時改成「已完成」，
 * 不然標題寫「那次完成」、卡片寫「這次完成」，自相矛盾（#4028）。
 */
const doneLabel = (viewingPrevious: boolean) => (viewingPrevious ? '已完成' : '這次完成');

/** 卡片上那一行狀態文字。 */
function statusText(card: StepReportCard, viewingPrevious: boolean): string {
  if (card.status === 'this') return card.summary ?? doneLabel(viewingPrevious);
  if (card.status === 'previous') {
    const d = shortDate(card.previousAt);
    return d ? `上次完成 · ${d}` : '上次完成';
  }
  return '未完成';
}

const statusLabel = (status: CardStatus, viewingPrevious: boolean) =>
  status === 'this' ? doneLabel(viewingPrevious) : status === 'previous' ? '上次完成，這次還沒做' : '未完成';

const CheckBadge: React.FC<{ status: CardStatus; viewingPrevious: boolean }> = ({ status, viewingPrevious }) =>
  status === 'this' ? (
    <span
      className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500 text-white shadow-sm"
      aria-label={doneLabel(viewingPrevious)}
    >
      <span className="material-symbols-outlined text-xl" aria-hidden="true">check</span>
    </span>
  ) : status === 'previous' ? (
    <span
      className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-200 text-slate-600"
      aria-label="上次完成"
    >
      <span className="material-symbols-outlined text-lg" aria-hidden="true">history</span>
    </span>
  ) : (
    <span
      className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-dashed border-outline-variant text-on-surface-variant/50"
      aria-label="未完成"
    >
      <span className="material-symbols-outlined text-lg" aria-hidden="true">more_horiz</span>
    </span>
  );

const AnswerList: React.FC<{ title: string; rows: AnswerRow[] }> = ({ title, rows }) => (
  <section>
    <h4 className="text-sm font-bold text-on-surface-variant mb-2">{title}</h4>
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
            <span className="flex items-center gap-1.5">
              {!r.correct && r.corrected != null && (
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    r.corrected ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-container-high text-on-surface-variant'
                  }`}
                >
                  {r.corrected ? '已訂正' : '還沒訂正'}
                </span>
              )}
              <span className={`text-xs font-bold ${r.correct ? 'text-emerald-700' : 'text-amber-700'}`}>
                {r.correct ? '✓ 第一次就答對' : '✗ 第一次答錯'}
              </span>
            </span>
          </div>
          {r.prompt && <p className="mt-1 text-on-surface">{r.prompt}</p>}
          {!r.correct && (r.studentAnswer || r.correctAnswer) && (
            <div className="mt-1 space-y-0.5 text-on-surface-variant">
              {r.studentAnswer && <p>你第一次選：{r.studentAnswer}</p>}
              {r.correctAnswer && <p>正確答案：{r.correctAnswer}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  </section>
);

const MarksList: React.FC<{ marks: MarkedWord[] }> = ({ marks }) => (
  <section className="space-y-3">
    {(['unknown', 'important'] as const).map((type) => {
      const list = marks.filter((m) => m.type === type);
      if (!list.length) return null;
      const st = MARK_STYLE[type];
      return (
        <div key={type}>
          <h4 className="text-sm font-bold text-on-surface-variant mb-2">
            {st.icon} {st.label}的詞語
          </h4>
          <ul className="flex flex-wrap gap-2" aria-label={`${st.label}的詞語`}>
            {list.map((m, i) => (
              <li
                key={i}
                className={`px-3 py-1 rounded-full border text-sm font-medium ${st.chip}`}
                title={`第 ${m.paragraphIndex + 1} 段`}
              >
                {m.text}
                <span className="ml-1.5 text-xs opacity-60">第{m.paragraphIndex + 1}段</span>
              </li>
            ))}
          </ul>
        </div>
      );
    })}
  </section>
);

const Detail: React.FC<{ block: DetailBlock }> = ({ block }) => {
  switch (block.kind) {
    case 'stats':
      return (
        <dl className="grid grid-cols-2 gap-2">
          {block.items.map((it) => (
            <div key={it.label} className="rounded-xl bg-surface-container-low px-3 py-2">
              <dt className="text-xs text-on-surface-variant">{it.label}</dt>
              <dd className="text-lg font-headline font-bold text-on-surface">{it.value}</dd>
            </div>
          ))}
        </dl>
      );
    case 'answers':
      return <AnswerList title={block.title} rows={block.rows} />;
    case 'marks':
      return <MarksList marks={block.marks} />;
    case 'words':
      return (
        <section>
          <h4 className="text-sm font-bold text-on-surface-variant mb-2">{block.title}</h4>
          <ul className="flex flex-wrap gap-2">
            {block.words.map((w) => (
              <li key={w} className="px-3 py-1 rounded-full bg-surface-container-low text-sm">{w}</li>
            ))}
          </ul>
        </section>
      );
    case 'note':
      return <p className="text-sm text-on-surface-variant">{block.text}</p>;
  }
};

const DetailDialog: React.FC<{
  card: StepReportCard;
  onClose: () => void;
  onGoToStep?: (stepId: string) => void;
  viewingPrevious: boolean;
}> = ({ card, onClose, onGoToStep, viewingPrevious }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-report-dialog-title"
        data-testid="step-report-dialog"
        className="w-full sm:max-w-lg max-h-[85vh] overflow-y-auto bg-surface rounded-t-3xl sm:rounded-3xl shadow-xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3">
          <span className="material-symbols-outlined text-2xl text-accent" aria-hidden="true">{card.icon}</span>
          <h3 id="step-report-dialog-title" className="flex-1 font-headline font-bold text-xl text-on-surface">
            {card.label}
          </h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>

        <p
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold ${
            card.status === 'this'
              ? 'bg-emerald-50 text-emerald-700'
              : card.status === 'previous'
                ? 'bg-slate-100 text-slate-700'
                : 'bg-surface-container-high text-on-surface-variant'
          }`}
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            {card.status === 'this' ? 'check_circle' : card.status === 'previous' ? 'history' : 'pending'}
          </span>
          {card.status === 'this'
            ? doneLabel(viewingPrevious)
            : card.status === 'previous'
              ? `上次完成${shortDate(card.previousAt) ? `（${shortDate(card.previousAt)}）` : ''}，這次還沒做`
              : '還沒完成'}
        </p>

        {card.status === 'previous' && card.details.length > 0 && (
          <p className="text-xs text-on-surface-variant">以下是上次的成績。</p>
        )}

        {card.details.length > 0 ? (
          card.details.map((b, i) => <Detail key={i} block={b} />)
        ) : (
          <p className="text-sm text-on-surface-variant">
            {card.status === 'none' ? '完成這一關之後，這裡會顯示你的成績。' : '這一關沒有分數，完成就算過關。'}
          </p>
        )}

        {card.status !== 'this' && onGoToStep && (
          <button
            type="button"
            onClick={() => onGoToStep(card.stepId)}
            className="w-full h-11 rounded-full bg-accent text-white font-bold hover:bg-accent-hover"
          >
            {card.status === 'previous' ? '再做一次' : '前往這一關'}
          </button>
        )}
      </div>
    </div>
  );
};

const StepReportCards: React.FC<Props> = ({ storyTitle, cards, onGoToStep, previousAttempt }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const viewingPrevious = !!previousAttempt;
  // 進度條只算這一次完成的（#4028）。
  const doneCount = cards.filter((c) => c.status === 'this').length;
  const previousCount = cards.filter((c) => c.status === 'previous').length;
  const pct = cards.length ? Math.round((doneCount / cards.length) * 100) : 0;
  const open = cards.find((c) => c.stepId === openId) ?? null;
  const close = useCallback(() => setOpenId(null), []);

  return (
    <div className="space-y-6" data-testid="step-report-cards">
      <header className="rounded-3xl bg-surface-container-lowest shadow-editorial p-6">
        <p className="text-sm text-on-surface-variant">
          {previousAttempt
            ? `最近一次的學習成果${dateTime(previousAttempt.at) ? `（${dateTime(previousAttempt.at)}）` : ''}`
            : '學習成果'}
        </p>
        <h2 className="font-headline font-bold text-2xl text-on-surface mt-1">
          {storyTitle ? `《${storyTitle}》` : '這一課'}
        </h2>
        <div className="mt-4 flex items-center gap-3">
          <div
            className="flex-1 h-2.5 rounded-full bg-surface-container-high overflow-hidden"
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={cards.length}
            aria-label="完成關卡數"
          >
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-sm font-bold text-on-surface whitespace-nowrap">
            {previousAttempt ? '那次完成' : '這次完成'} {doneCount} / {cards.length} 關
          </span>
        </div>
        {previousAttempt && (
          <p className="mt-2 text-xs text-on-surface-variant" data-testid="step-report-previous-attempt">
            這一次還沒有完成新的關卡，下面是最近一次的成果。
          </p>
        )}
        {previousCount > 0 && (
          <p className="mt-2 text-xs text-on-surface-variant" data-testid="step-report-previous-note">
            {viewingPrevious
              ? `另有 ${previousCount} 關是更早之前完成的。`
              : `另有 ${previousCount} 關是上次完成的，這次還沒做。`}
          </p>
        )}
      </header>

      <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c) => (
          <li key={c.stepId}>
            <button
              type="button"
              onClick={() => setOpenId(c.stepId)}
              data-status={c.status}
              aria-label={`${c.label}：${statusLabel(c.status, viewingPrevious)}${c.status === 'this' && c.summary ? `，${c.summary}` : ''}。點擊看詳細`}
              className={`w-full h-full text-left rounded-2xl p-4 flex flex-col gap-3 transition-all active:scale-[0.98] ${
                c.status === 'this'
                  ? 'bg-surface-container-lowest border-2 border-emerald-200 shadow-sm hover:shadow-md'
                  : c.status === 'previous'
                    ? 'bg-surface-container-lowest border-2 border-slate-200 hover:shadow-sm'
                    : 'bg-surface-container-low border-2 border-dashed border-outline-variant/60 hover:bg-surface-container'
              }`}
            >
              <div className="flex items-start justify-between">
                <span
                  className={`material-symbols-outlined text-2xl ${
                    c.status === 'this' ? 'text-accent' : c.status === 'previous' ? 'text-slate-500' : 'text-on-surface-variant/50'
                  }`}
                  aria-hidden="true"
                >
                  {c.icon}
                </span>
                <CheckBadge status={c.status} viewingPrevious={viewingPrevious} />
              </div>
              <div>
                <p className={`font-headline font-bold ${c.status === 'none' ? 'text-on-surface-variant' : 'text-on-surface'}`}>
                  {c.label}
                </p>
                <p className="text-xs mt-0.5 text-on-surface-variant">{statusText(c, viewingPrevious)}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {open && <DetailDialog card={open} onClose={close} onGoToStep={onGoToStep} viewingPrevious={viewingPrevious} />}
    </div>
  );
};

export default StepReportCards;
