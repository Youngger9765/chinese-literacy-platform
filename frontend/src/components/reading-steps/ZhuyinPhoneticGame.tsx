/**
 * ZhuyinPhoneticGame — 注音聲韻覺識互動遊戲
 *
 * Implements phonological awareness exercises based on PRD §1139-1143.
 * Three game modes:
 *   - 聲母配對: Pick the correct initial (聲母) for a character
 *   - 韻母配對: Pick the correct final (韻母) for a character
 *   - 拼音合成: Tap bopomofo symbols in order to spell a character
 *
 * Uses the MOE dictionary batch API to fetch zhuyin for story characters.
 * Falls back gracefully when zhuyin data is unavailable.
 *
 * Refactored (issue-1859): pure logic extracted to zhuyinGameLogic.ts.
 * Refactored (issue-1885): UI sub-components extracted to separate files;
 *   game engine logic moved to zhuyinGameEngine.ts.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { lookupCharactersBatch } from '../../services/learningApi';
import { Story } from '../../types';
import { CharZhuyin, parseZhuyin, shuffle } from './zhuyinGameLogic';
import { GameMode, filterQuestionsForMode } from './zhuyinGameEngine';
import { ModeSelect } from './ModeSelect';
import { ScoreBanner } from './ScoreBanner';
import { PickGame } from './PickGame';
import { ComposeGame } from './ComposeGame';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ZhuyinPhoneticGameProps {
  story: Story;
  /** Characters to practice. Defaults to first 12 Chinese chars in story. */
  practiceChars?: string[];
  onFinish: (score: number, total: number) => void;
  onBack: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading state
// ─────────────────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 gap-4" role="status" aria-label="載入注音資料中">
      <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" aria-hidden="true" />
      <p className="text-sm text-gray-500">載入注音資料中…</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const ZhuyinPhoneticGame: React.FC<ZhuyinPhoneticGameProps> = ({
  story,
  practiceChars,
  onFinish,
  onBack,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [charData, setCharData] = useState<CharZhuyin[]>([]);
  const [phase, setPhase] = useState<'mode-select' | GameMode | 'score'>('mode-select');
  const [activeMode, setActiveMode] = useState<GameMode>('initial');
  const [finalScore, setFinalScore] = useState({ score: 0, total: 0 });

  // Derive practice characters from story content if not provided
  const targetChars = useMemo(() => {
    if (practiceChars && practiceChars.length > 0) return practiceChars.slice(0, 12);
    const seen = new Set<string>();
    const chars: string[] = [];
    for (const line of story.content) {
      for (const ch of line) {
        if (/[一-龥]/.test(ch) && !seen.has(ch)) {
          chars.push(ch);
          seen.add(ch);
        }
      }
    }
    return chars.slice(0, 12);
  }, [story.content, practiceChars]);

  // Fetch zhuyin via batch API
  useEffect(() => {
    if (targetChars.length === 0) {
      setLoading(false);
      setError('找不到可練習的字');
      return;
    }

    setLoading(true);
    setError(null);

    lookupCharactersBatch(targetChars)
      .then(res => {
        const data: CharZhuyin[] = [];
        for (const entry of res.results) {
          if (!entry.not_found && entry.zhuyin) {
            const parsed = parseZhuyin(entry.zhuyin);
            data.push({
              char: entry.character,
              zhuyin: entry.zhuyin,
              ...parsed,
            });
          }
        }
        if (data.length === 0) {
          setError('注音資料暫時無法取得，請稍後再試');
        } else {
          setCharData(data);
        }
      })
      .catch(() => setError('注音資料載入失敗，請確認網路連線'))
      .finally(() => setLoading(false));
  }, [targetChars]);

  // Build questions for the active mode (filter + shuffle)
  const questions = useMemo(() => {
    return shuffle(filterQuestionsForMode(charData, activeMode));
  }, [charData, activeMode]);

  const handleModeSelect = (mode: GameMode) => {
    setActiveMode(mode);
    setPhase(mode);
  };

  const handleGameFinish = (score: number, total: number) => {
    setFinalScore({ score, total });
    setPhase('score');
  };

  const handleFinish = () => {
    onFinish(finalScore.score, finalScore.total);
  };

  const handleRetry = () => {
    setPhase(activeMode);
  };

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
        <div className="text-4xl select-none">😅</div>
        <p className="text-sm text-gray-500 text-center">{error}</p>
        <button
          onClick={onBack}
          className="px-6 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 transition-all"
        >
          返回
        </button>
      </div>
    );
  }

  if (phase === 'mode-select') {
    return (
      <ModeSelect
        charCount={charData.length}
        onSelect={handleModeSelect}
        onBack={onBack}
      />
    );
  }

  if (phase === 'score') {
    return (
      <ScoreBanner
        score={finalScore.score}
        total={finalScore.total}
        onFinish={handleFinish}
        onRetry={handleRetry}
      />
    );
  }

  if (questions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
        <p className="text-sm text-gray-500 text-center">
          這一課的生字沒有足夠的{activeMode === 'initial' ? '聲母' : activeMode === 'final' ? '韻母' : '注音'}資料
        </p>
        <button
          onClick={() => setPhase('mode-select')}
          className="px-6 py-2.5 rounded-xl bg-indigo-100 hover:bg-indigo-200 text-sm font-semibold text-indigo-700 transition-all"
        >
          換個模式
        </button>
      </div>
    );
  }

  if (phase === 'initial' || phase === 'final') {
    return (
      <PickGame
        mode={phase}
        questions={questions}
        onFinish={handleGameFinish}
        onBack={() => setPhase('mode-select')}
      />
    );
  }

  if (phase === 'compose') {
    return (
      <ComposeGame
        questions={questions}
        onFinish={handleGameFinish}
        onBack={() => setPhase('mode-select')}
      />
    );
  }

  return null;
};

export default ZhuyinPhoneticGame;
