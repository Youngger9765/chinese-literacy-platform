/**
 * StepReportCards — 報告頁：每一關一張卡片，完成打綠勾，點開看細節（#3399）
 *
 * 取代學生學習流程裡的 AssessmentReport（AI 診斷、六環節分析、折線圖…）。
 * Mentor：「不用搞很多複雜的 AI 診斷，只需要將完成的部分以區塊的方式顯現」。
 *
 * 資料全部來自 DB（step_progress + annotation_entries），邏輯在 reportCardsModel.ts。
 *
 * #4028（案主定調）：完成就是綠勾；完成了但有題目第一次答錯 / 要訂正 → 黃色圈圈。
 * 上方關卡導覽列（AppShell）用同一個判斷。
 *
 * #4104 學習批閱：老師退回的關卡是紅色（優先於黃 / 綠），卡片上有老師的評語與
 * 紅筆分數，標題旁是總分。老師端用 `renderCardTools` 在每張卡片下面放批閱工具。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerRow, CardStatus, DetailBlock, MarkedWord, StepReportCard } from './reportCardsModel';
import { radarOf } from './reportCardsModel';
import { AttemptsPanel, RadarPanel } from './ReportCharts';
import { CommentNote, ScoreMark } from './TeacherMarks';

/** 老師送出的批閱（#4104），依 step id。學生端與老師端預覽都用它。 */
export interface CardsReview {
  totalScore: number | null;
  teacherName: string | null;
  steps: Record<string, { returned: boolean; redone?: boolean; comment: string | null; score: number | null }>;
}

type StepMark = CardsReview['steps'][string];

interface Props {
  storyTitle?: string;
  cards: StepReportCard[];
  /** 未完成的關卡可以直接前往。 */
  onGoToStep?: (stepId: string) => void;
  /** #4104：老師送出的批閱（退回 / 評語 / 分數）。 */
  review?: CardsReview | null;
  /** #4104：老師端在每張卡片下面放的批閱工具。 */
  renderCardTools?: (card: StepReportCard) => React.ReactNode;
}

const MARK_STYLE: Record<MarkedWord['type'], { icon: string; label: string; chip: string }> = {
  unknown: { icon: '❓', label: '不懂', chip: 'bg-red-50 text-red-800 border-red-200' },
  important: { icon: '💛', label: '重要', chip: 'bg-yellow-100 text-yellow-900 border-yellow-300' },
};

const STATUS_LABEL: Record<CardStatus, string> = { done: '已完成', review: '已完成，有錯題要訂正', none: '未完成' };

/** 卡片狀態的完整說法（#4087）：黃色寫還有幾題要訂正，綠色寫訂正過幾題。 */
function statusPhrase(c: StepReportCard): string {
  if (c.status === 'review') return `還有 ${c.toFix} ${c.unit}要訂正`;
  if (c.status === 'done' && c.fixed > 0) return `已完成，訂正過 ${c.fixed} ${c.unit}`;
  return STATUS_LABEL[c.status];
}

const CheckBadge: React.FC<{ status: CardStatus }> = ({ status }) =>
  status === 'done' ? (
    <span
      className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500 text-white shadow-xs"
      aria-label={STATUS_LABEL.done}
    >
      <span className="material-symbols-outlined text-xl" aria-hidden="true">check</span>
    </span>
  ) : status === 'review' ? (
    <span
      className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-400 text-amber-950 shadow-xs"
      aria-label={STATUS_LABEL.review}
    >
      <span className="material-symbols-outlined text-xl" aria-hidden="true">priority_high</span>
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
  mark?: StepMark;
  teacherName?: string | null;
}> = ({ card, onClose, onGoToStep, mark, teacherName }) => {
  const returned = !!mark?.returned;
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
            card.status === 'done'
              ? 'bg-emerald-50 text-emerald-700'
              : card.status === 'review'
                ? 'bg-amber-50 text-amber-800'
                : 'bg-surface-container-high text-on-surface-variant'
          }`}
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            {card.status === 'done' ? 'check_circle' : card.status === 'review' ? 'error' : 'pending'}
          </span>
          {card.status === 'none' ? '還沒完成' : statusPhrase(card)}
        </p>

        {(returned || mark?.comment || mark?.score != null) && (
          <div
            className={`rounded-2xl border px-4 py-3 space-y-2 ${returned ? 'border-red-300 bg-red-50' : 'border-red-100 bg-[#fffaf5]'}`}
            data-testid="dialog-teacher-review"
          >
            <div className="flex items-start justify-between gap-3">
              <p className={`text-sm font-bold ${returned ? 'text-red-700' : 'text-on-surface-variant'}`}>
                {returned ? '老師退回這一關，請重做' : '老師的批閱'}
              </p>
              {mark?.score != null && <ScoreMark score={mark.score} />}
            </div>
            {mark?.comment && <CommentNote comment={mark.comment} teacherName={teacherName} />}
          </div>
        )}

        {card.attempts.length >= 2 ? (
          // #4087：重複作答過 → 折線圖 + 點節點看那一次（預設選最近一次，
          // 所以不再重複列出目前的細節）。
          <AttemptsPanel card={card} />
        ) : card.details.length > 0 ? (
          card.details.map((b, i) => <Detail key={i} block={b} />)
        ) : (
          <p className="text-sm text-on-surface-variant">
            {card.completed ? '這一關沒有分數，完成就算過關。' : '完成這一關之後，這裡會顯示你的成績。'}
          </p>
        )}

        {(returned || card.status !== 'done') && onGoToStep && (
          <button
            type="button"
            onClick={() => onGoToStep(card.stepId)}
            className={`w-full h-11 rounded-full text-white font-bold ${
              returned ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            {returned ? '去重做' : card.status === 'review' ? '回去訂正' : '前往這一關'}
          </button>
        )}
      </div>
    </div>
  );
};

const ReturnedBadge: React.FC = () => (
  <span
    className="flex items-center justify-center w-8 h-8 rounded-full bg-red-500 text-white shadow-xs"
    aria-label="老師退回，要重做"
  >
    <span className="material-symbols-outlined text-xl" aria-hidden="true">replay</span>
  </span>
);

function cardAriaLabel(c: StepReportCard, mark: StepMark | undefined): string {
  const state = mark?.returned ? '老師退回，要重做' : statusPhrase(c);
  const summary = c.completed && c.summary ? `，${c.summary}` : '';
  const score = mark?.score != null ? `，老師給 ${mark.score} 分` : '';
  return `${c.label}：${state}${summary}${score}。點擊看詳細`;
}

function cardClass(c: StepReportCard, returned: boolean): string {
  if (returned) return 'bg-red-50 border-2 border-red-400 shadow-xs hover:shadow-md';
  if (c.status === 'done') return 'bg-surface-container-lowest border-2 border-emerald-200 shadow-xs hover:shadow-md';
  if (c.status === 'review') return 'bg-surface-container-lowest border-2 border-amber-300 shadow-xs hover:shadow-md';
  return 'bg-surface-container-low border-2 border-dashed border-outline-variant/60 hover:bg-surface-container';
}

const StepReportCards: React.FC<Props> = ({ storyTitle, cards, onGoToStep, review, renderCardTools }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const doneCount = cards.filter((c) => c.completed).length;
  const reviewCount = cards.filter((c) => c.status === 'review').length;
  const pct = cards.length ? Math.round((doneCount / cards.length) * 100) : 0;
  const open = cards.find((c) => c.stepId === openId) ?? null;
  const close = useCallback(() => setOpenId(null), []);
  const markOf = (id: string): StepMark | undefined => review?.steps[id];
  const returnedCards = cards.filter((c) => markOf(c.stepId)?.returned);
  const totalScore = review?.totalScore ?? null;

  return (
    <div className="space-y-6" data-testid="step-report-cards">
      <header className="rounded-3xl bg-surface-container-lowest shadow-editorial p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-on-surface-variant">學習成果</p>
            <h2 className="font-headline font-bold text-2xl text-on-surface mt-1">
              {storyTitle ? `《${storyTitle}》` : '這一課'}
            </h2>
          </div>
          {totalScore != null && (
            <div className="shrink-0 flex flex-col items-center pr-2" data-testid="report-total-score">
              <ScoreMark score={totalScore} size="total" />
              <span className="mt-1 text-xs text-on-surface-variant">
                {review?.teacherName ? `${review.teacherName}批閱` : '老師批閱'}
              </span>
            </div>
          )}
        </div>
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
            完成 {doneCount} / {cards.length} 關
          </span>
        </div>
        {returnedCards.length > 0 && (
          // #4104：老師退回的關卡，紅色、放最前面，點了就過去重做。
          <div
            className="mt-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3"
            data-testid="step-report-returned-note"
          >
            <p className="text-sm font-bold text-red-800">老師退回 {returnedCards.length} 關，請重做：</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {returnedCards.map((c) => (
                <li key={c.stepId}>
                  {onGoToStep ? (
                    <button
                      type="button"
                      onClick={() => onGoToStep(c.stepId)}
                      className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-700"
                    >
                      {c.label} → 去重做
                    </button>
                  ) : (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800">{c.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {reviewCount > 0 && (
          // #4087：直接說哪幾關、各還有幾題要訂正，點了就過去 —— 學生不用一張張卡片猜。
          <div
            className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
            data-testid="step-report-review-note"
          >
            <p className="text-sm font-bold text-amber-900">還有 {reviewCount} 關有錯題要訂正：</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {cards
                .filter((c) => c.status === 'review')
                .map((c) => (
                  <li key={c.stepId}>
                    {onGoToStep ? (
                      <button
                        type="button"
                        onClick={() => onGoToStep(c.stepId)}
                        className="rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-amber-950 hover:bg-amber-300"
                      >
                        {c.label}・{c.toFix} {c.unit} → 去訂正
                      </button>
                    ) : (
                      <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-950">
                        {c.label}・{c.toFix} {c.unit}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </header>

      {/* #4087：能力雷達（五項固定）。放在卡片前面，一眼看到強項和弱項。 */}
      <RadarPanel points={radarOf(cards)} />

      <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c) => {
          const mark = markOf(c.stepId);
          const returned = !!mark?.returned;
          return (
          <li key={c.stepId} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setOpenId(c.stepId)}
              data-status={c.status}
              data-returned={returned || undefined}
              aria-label={cardAriaLabel(c, mark)}
              className={`w-full ${renderCardTools ? '' : 'h-full'} text-left rounded-2xl p-4 flex flex-col gap-3 transition-all active:scale-[0.98] ${cardClass(c, returned)}`}
            >
              <div className="flex items-start justify-between">
                <span
                  className={`material-symbols-outlined text-2xl ${c.completed ? 'text-accent' : 'text-on-surface-variant/50'}`}
                  aria-hidden="true"
                >
                  {c.icon}
                </span>
                <span className="flex items-center gap-2">
                  {mark?.score != null && <ScoreMark score={mark.score} />}
                  {returned ? <ReturnedBadge /> : <CheckBadge status={c.status} />}
                </span>
              </div>
              <div>
                <p className={`font-headline font-bold ${c.completed ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                  {c.label}
                </p>
                <p className="text-xs mt-0.5 text-on-surface-variant">
                  {c.completed ? c.summary ?? '已完成' : '未完成'}
                </p>
                {c.status === 'review' && (
                  <p className="text-xs mt-1 font-bold text-amber-800" data-testid="to-fix-badge">
                    還有 {c.toFix} {c.unit}要訂正
                  </p>
                )}
                {c.status === 'done' && c.fixed > 0 && (
                  <p className="text-xs mt-1 text-emerald-700" data-testid="fixed-badge">
                    ✓ 訂正過 {c.fixed} {c.unit}
                  </p>
                )}
                {c.attempts.length >= 2 && (
                  <p className="text-xs mt-1 font-bold text-accent" data-testid="attempts-badge">
                    📈 作答 {c.attempts.length} 次，點開看進步
                  </p>
                )}
                {returned && (
                  <p className="text-xs mt-1 font-bold text-red-700" data-testid="returned-badge">
                    老師退回，請重做
                  </p>
                )}
                {mark?.comment && <CommentNote comment={mark.comment} className="mt-2 line-clamp-3" />}
              </div>
            </button>
            {renderCardTools?.(c)}
          </li>
          );
        })}
      </ul>

      {open && (
        <DetailDialog
          card={open}
          onClose={close}
          onGoToStep={onGoToStep}
          mark={markOf(open.stepId)}
          teacherName={review?.teacherName}
        />
      )}
    </div>
  );
};

export default StepReportCards;
