/**
 * VocabApplication — Step Component for ④ 語詞應用（造句填空練習）
 *
 * Issue #668 — 三民步驟四：語詞應用模組
 *
 * Standalone step component. Receives `story` prop and calls `onFinish`
 * with a score result when the student completes all fill-in-blank exercises.
 *
 * Props: { story, onFinish, zhuyinActive?, fontSizePx? }
 */
import React, { useState } from 'react';
import { Story } from '../../types';
import FillInBlankExercise from './FillInBlankExercise';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface VocabApplicationResult {
  score: number;
  total: number;
  completionRate: number;  // 0–1
}

export interface VocabApplicationProps {
  story: Story;
  onFinish: (result: VocabApplicationResult) => void;
  /** Enable zhuyin ruby annotation (future-use, passed through) */
  zhuyinActive?: boolean;
  /** Base font size in px for accessibility scaling */
  fontSizePx?: number;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

/** Header banner matching other step components' amber-50 style */
function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-bold text-amber-900">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-sm text-amber-700">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

/** Shown when the story has no fill-in-blank data */
function NoDataFallback({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-16 text-center max-w-lg mx-auto">
      <div className="text-5xl select-none">📝</div>
      <div>
        <h3 className="text-lg font-bold text-gray-700 mb-2">本課尚無語詞應用題目</h3>
        <p className="text-sm text-gray-500 leading-relaxed">
          這篇課文目前沒有填空練習資料。<br />
          教師可透過後台上傳題目，或聯絡管理員更新課文資料。
        </p>
      </div>
      <button
        onClick={onFinish}
        className="rounded-lg bg-amber-500 px-8 py-3 text-white font-medium hover:bg-amber-600 transition-colors"
      >
        繼續下一步
      </button>
    </div>
  );
}

/** Completion screen shown after FillInBlankExercise reports done */
function CompletionScreen({
  score,
  total,
  onFinish,
}: {
  score: number;
  total: number;
  onFinish: () => void;
}) {
  const perfect = score === total;
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-16 text-center max-w-lg mx-auto animate-fade-in">
      <div className="text-5xl select-none animate-pop">
        {perfect ? '🌟' : '📚'}
      </div>
      <div>
        <h3 className="text-2xl font-black text-emerald-800 mb-1">
          {perfect ? '全部答對！' : '語詞應用完成！'}
        </h3>
        <p className="text-emerald-700 text-base">
          答對 <span className="font-bold">{score}</span> / {total} 題
          {!perfect && (
            <span className="block text-sm text-gray-500 mt-1">
              再多練習幾次，一定可以全對！
            </span>
          )}
        </p>
      </div>
      <button
        onClick={onFinish}
        className="rounded-lg bg-emerald-500 px-10 py-3 text-white font-semibold hover:bg-emerald-600 transition-colors text-lg"
      >
        繼續下一步 →
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

const VocabApplication: React.FC<VocabApplicationProps> = ({
  story,
  onFinish,
  fontSizePx,
}) => {
  const [phase, setPhase] = useState<'exercise' | 'done'>('exercise');
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);

  const sentences = story.fillInBlank ?? [];
  const vocabBank = story.vocabBank ?? {};

  const hasData = sentences.length > 0 && Object.keys(vocabBank).length > 0;

  function handleComplete(score: number, total: number) {
    setResult({ score, total });
    setPhase('done');
  }

  function handleFinish() {
    const score = result?.score ?? 0;
    const total = result?.total ?? sentences.length;
    onFinish({
      score,
      total,
      completionRate: total > 0 ? score / total : 1,
    });
  }

  return (
    <div
      className="flex flex-col min-h-full bg-white"
      style={fontSizePx ? { fontSize: fontSizePx } : undefined}
    >
      <StepHeader
        title="語詞應用"
        subtitle="將正確的詞語代號填入空格中"
      />

      <div className="flex-1 overflow-auto py-6">
        {!hasData ? (
          <NoDataFallback onFinish={handleFinish} />
        ) : phase === 'exercise' ? (
          <FillInBlankExercise
            sentences={sentences}
            vocabBank={vocabBank}
            onComplete={handleComplete}
          />
        ) : (
          <CompletionScreen
            score={result!.score}
            total={result!.total}
            onFinish={handleFinish}
          />
        )}
      </div>
    </div>
  );
};

export default VocabApplication;
