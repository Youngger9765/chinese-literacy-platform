/**
 * StepReportCards — 報告頁：每一關一張卡片，完成打綠勾，點開看細節（#3399）
 *
 * 取代學生學習流程裡的 AssessmentReport（AI 診斷、六環節分析、折線圖…）。
 * Mentor：「不用搞很多複雜的 AI 診斷，只需要將完成的部分以區塊的方式顯現」。
 *
 * 資料全部來自 DB（step_progress + annotation_entries），邏輯在 reportCardsModel.ts。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerRow, DetailBlock, MarkedWord, StepReportCard } from './reportCardsModel';

interface Props {
  storyTitle?: string;
  cards: StepReportCard[];
  /** 未完成的關卡可以直接前往。 */
  onGoToStep?: (stepId: string) => void;
}

const MARK_STYLE: Record<MarkedWord['type'], { icon: string; label: string; chip: string }> = {
  unknown: { icon: '❓', label: '不懂', chip: 'bg-red-50 text-red-800 border-red-200' },
  important: { icon: '💛', label: '重要', chip: 'bg-yellow-100 text-yellow-900 border-yellow-300' },
};

const CheckBadge: React.FC<{ done: boolean }> = ({ done }) =>
  done ? (
    <span
      className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500 text-white shadow-sm"
      aria-label="已完成"
    >
      <span className="material-symbols-outlined text-xl" aria-hidden="true">check</span>
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
            <span className={`text-xs font-bold ${r.correct ? 'text-emerald-700' : 'text-amber-700'}`}>
              {r.correct ? '✓ 答對' : '✗ 再想想'}
            </span>
          </div>
          {(r.studentAnswer || r.correctAnswer) && (
            <div className="mt-1 space-y-0.5 text-on-surface-variant">
              {r.studentAnswer && <p>你的答案：{r.studentAnswer}</p>}
              {!r.correct && r.correctAnswer && <p>正確答案：{r.correctAnswer}</p>}
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
}> = ({ card, onClose, onGoToStep }) => {
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
            card.completed ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-container-high text-on-surface-variant'
          }`}
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            {card.completed ? 'check_circle' : 'pending'}
          </span>
          {card.completed ? '已完成' : '還沒完成'}
        </p>

        {card.details.length > 0 ? (
          card.details.map((b, i) => <Detail key={i} block={b} />)
        ) : (
          <p className="text-sm text-on-surface-variant">
            {card.completed ? '這一關沒有分數，完成就算過關。' : '完成這一關之後，這裡會顯示你的成績。'}
          </p>
        )}

        {!card.completed && onGoToStep && (
          <button
            type="button"
            onClick={() => onGoToStep(card.stepId)}
            className="w-full h-11 rounded-full bg-accent text-white font-bold hover:bg-accent-hover"
          >
            前往這一關
          </button>
        )}
      </div>
    </div>
  );
};

const StepReportCards: React.FC<Props> = ({ storyTitle, cards, onGoToStep }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const doneCount = cards.filter((c) => c.completed).length;
  const pct = cards.length ? Math.round((doneCount / cards.length) * 100) : 0;
  const open = cards.find((c) => c.stepId === openId) ?? null;
  const close = useCallback(() => setOpenId(null), []);

  return (
    <div className="space-y-6" data-testid="step-report-cards">
      <header className="rounded-3xl bg-surface-container-lowest shadow-editorial p-6">
        <p className="text-sm text-on-surface-variant">學習成果</p>
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
            完成 {doneCount} / {cards.length} 關
          </span>
        </div>
      </header>

      <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c) => (
          <li key={c.stepId}>
            <button
              type="button"
              onClick={() => setOpenId(c.stepId)}
              aria-label={`${c.label}：${c.completed ? '已完成' : '未完成'}${c.summary ? `，${c.summary}` : ''}。點擊看詳細`}
              className={`w-full h-full text-left rounded-2xl p-4 flex flex-col gap-3 transition-all active:scale-[0.98] ${
                c.completed
                  ? 'bg-surface-container-lowest border-2 border-emerald-200 shadow-sm hover:shadow-md'
                  : 'bg-surface-container-low border-2 border-dashed border-outline-variant/60 hover:bg-surface-container'
              }`}
            >
              <div className="flex items-start justify-between">
                <span
                  className={`material-symbols-outlined text-2xl ${c.completed ? 'text-accent' : 'text-on-surface-variant/50'}`}
                  aria-hidden="true"
                >
                  {c.icon}
                </span>
                <CheckBadge done={c.completed} />
              </div>
              <div>
                <p className={`font-headline font-bold ${c.completed ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                  {c.label}
                </p>
                <p className="text-xs mt-0.5 text-on-surface-variant">
                  {c.completed ? c.summary ?? '已完成' : '未完成'}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {open && <DetailDialog card={open} onClose={close} onGoToStep={onGoToStep} />}
    </div>
  );
};

export default StepReportCards;
