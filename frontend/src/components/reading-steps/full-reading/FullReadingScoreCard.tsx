/**
 * FullReadingScoreCard — Star encouragement + transcript + audio playback (Issue #1960).
 *
 * Extracted from FullReading.tsx result section:
 *   - Star encouragement (5/4/3/2 stars based on matchRate)
 *   - 你說的 streaming transcript (optional)
 *   - 重聽錄音 audio playback (optional)
 *
 * Note: DiffDisplay (逐字比對) is intentionally kept in FullReadingFeedbackPanel
 * to keep this component focused on the summary score + playback.
 */

import React from 'react';

const FULL_READING_TIERS: Array<{ min: number; stars: number; text: string; color: string }> = [
  { min: 0.90, stars: 5, text: '太厲害了！',         color: 'text-emerald-600' },
  { min: 0.75, stars: 4, text: '唸得很流暢！',       color: 'text-green-600'   },
  { min: 0.60, stars: 3, text: '繼續練習！',         color: 'text-green-600'   },
  { min: 0,    stars: 2, text: '再多練幾次就會更熟～', color: 'text-amber-600'   },
];

export function getFullReadingEncouragement(matchRate: number): { stars: number; text: string; color: string } {
  const tier = FULL_READING_TIERS.find(t => matchRate >= t.min) ?? FULL_READING_TIERS[FULL_READING_TIERS.length - 1];
  return { stars: tier.stars, text: tier.text, color: tier.color };
}

export interface FullReadingScoreCardProps {
  result: {
    matchRate: number;
    feedback: string;
    diffTokens?: Array<{ type: string; text: string }>;
    cpm: number;
    durationMs: number;
    errorBreakdown: { correct: number; wrong: number; missing: number; extra: number };
  };
  /** The streaming transcript text after STT. Empty string → no section shown. */
  streamingTranscript: string;
  /** Blob URL for the recorded audio. null → no audio section shown. */
  audioUrl: string | null;
}

const FullReadingScoreCard: React.FC<FullReadingScoreCardProps> = ({
  result,
  streamingTranscript,
  audioUrl,
}) => {
  const enc = getFullReadingEncouragement(result.matchRate);

  return (
    <>
      {/* Encouragement stars (Issues #1094, #1097 — no raw numbers shown to students) */}
      <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 flex flex-col items-center gap-3">
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className={`material-symbols-outlined text-3xl transition-colors ${
                i < enc.stars ? 'text-amber-400' : 'text-on-surface-variant/20'
              }`}
              style={{ fontVariationSettings: i < enc.stars ? "'FILL' 1" : "'FILL' 0" }}
            >
              star
            </span>
          ))}
        </div>
        <p className={`text-xl font-headline font-bold text-center ${enc.color}`}>
          {enc.text}
        </p>
      </div>

      {/* 你說的 transcript */}
      {streamingTranscript && (
        <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
          <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">你說的</p>
          <p className="text-base text-on-surface leading-relaxed line-clamp-6">{streamingTranscript}</p>
        </div>
      )}

      {/* 重聽錄音 audio playback */}
      {audioUrl && (
        <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
          <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">重聽錄音</p>
          <audio src={audioUrl} controls className="w-full h-10" aria-label="播放您的朗讀錄音" />
        </div>
      )}
    </>
  );
};

export default FullReadingScoreCard;
