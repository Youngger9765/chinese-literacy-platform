/**
 * ErrorWordListSection — Section 4 of AssessmentReport (#1945).
 * 環節四：錯字詞練習清單
 *
 * Extracted from the inline Section 4 block in AssessmentReport.tsx.
 * Displays wrong tokens (with TTS) and missing characters (as clickable chips).
 */

import React from 'react';
import { speakText as azureSpeakText } from '../../services/ttsApi';

interface WrongToken {
  char: string;
  expected: string;
}

interface ErrorWordListSectionProps {
  wrongTokens: WrongToken[];
  missingChars: string[];
  onGoToVocab?: (() => void) | undefined;
  /** Whether readingAttempt exists (used for success-vs-no-data message) */
  hasReadingAttempt: boolean;
}

/** Speak a Chinese character/word using Azure TTS */
const speakText = (text: string) => {
  azureSpeakText(text).catch(() => {});
};

/**
 * Section 4: 錯字詞練習清單
 *
 * Renders:
 * - List of wrong tokens with TTS button (char → expected mapping)
 * - Missing characters as clickable TTS chips (capped at 20, shows overflow)
 * - Optional "去生字練習" CTA button
 * - Success message when reading attempt done but no errors found
 * - No-data message when no reading attempt exists
 */
const ErrorWordListSection: React.FC<ErrorWordListSectionProps> = ({
  wrongTokens,
  missingChars,
  onGoToVocab,
  hasReadingAttempt,
}) => {
  const hasErrors = wrongTokens.length > 0 || missingChars.length > 0;

  if (!hasErrors) {
    return (
      <div className="bg-green-50 rounded-2xl p-6 text-center">
        <p className="text-emerald-700 font-bold">
          {hasReadingAttempt ? '恭喜！沒有讀錯的字詞！' : '尚無朗讀資料'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Wrong tokens */}
      {wrongTokens.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 font-bold mb-2">
            讀錯的字（共 {wrongTokens.length} 個）
          </p>
          <div>
            {wrongTokens.map((t, idx) => (
              <div
                key={idx}
                className="flex items-center gap-4 py-3 border-b border-slate-100 last:border-0"
              >
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-red-500 line-through text-lg">{t.char}</span>
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 7l5 5m0 0l-5 5m5-5H6"
                    />
                  </svg>
                  <span className="text-emerald-600 font-bold text-lg">{t.expected}</span>
                </div>
                <button
                  onClick={() => speakText(t.expected)}
                  className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors shrink-0"
                  title="聽發音"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing characters */}
      {missingChars.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 font-bold mb-2">
            漏讀的字（共 {missingChars.length} 個）
          </p>
          <div className="flex flex-wrap gap-2">
            {missingChars.slice(0, 20).map((ch, idx) => (
              <button
                key={idx}
                onClick={() => speakText(ch)}
                className="bg-amber-50 border border-amber-200 text-amber-800 text-sm font-bold px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1"
              >
                {ch}
                <svg className="w-3 h-3 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                </svg>
              </button>
            ))}
            {missingChars.length > 20 && (
              <span className="text-xs text-gray-400 self-center">
                ...還有 {missingChars.length - 20} 個
              </span>
            )}
          </div>
        </div>
      )}

      {/* Go to vocab CTA */}
      {onGoToVocab && (
        <button
          onClick={onGoToVocab}
          className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 bg-accent/10 hover:bg-accent/20 text-accent font-bold text-sm rounded-full transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
          去生字練習
        </button>
      )}
    </div>
  );
};

export default ErrorWordListSection;
