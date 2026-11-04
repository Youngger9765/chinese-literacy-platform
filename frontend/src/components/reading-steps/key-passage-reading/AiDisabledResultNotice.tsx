/**
 * AiDisabledResultNotice — shown instead of KeyPassageReadingScoreCard +
 * ReadingMetricsCard when this attempt was completed with the AI kill
 * switch (#3838 `AI_FEATURES_ENABLED`) off (#3856).
 *
 * Deliberately does NOT render a star rating or a cpm/accuracy number:
 * `SavedResult.matchRate`/`cpm` are 0-value placeholders in this case, not
 * a real Gemini score, and showing them (even as "0%") would read as "you
 * failed" rather than "AI grading wasn't available". The student still
 * gets to self-assess via <SelfAssessment> right after this notice — this
 * component only replaces the AI-score half of the result panel.
 */
import React from 'react';

const AiDisabledResultNotice: React.FC = () => (
  <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 flex items-start gap-3">
    <span className="material-symbols-outlined text-accent shrink-0 mt-0.5">info</span>
    <div className="flex-1">
      <p className="text-base font-bold text-on-surface">已完成朗讀！</p>
      <p className="text-sm text-on-surface-variant mt-1">
        AI 朗讀評分目前暫時關閉，這一關改用你自己的評估來完成，不影響繼續下一關。
      </p>
    </div>
  </div>
);

export default AiDisabledResultNotice;
