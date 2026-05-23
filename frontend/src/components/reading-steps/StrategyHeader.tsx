/**
 * StrategyHeader — shared header for all StrategyExercise sub-types.
 * Extracted from StrategyExercise.tsx (#1884).
 */
import React from 'react';

interface Props {
  name: string;
  instruction: string;
}

const StrategyHeader: React.FC<Props> = ({ name, instruction }) => (
  <div className="mb-5">
    <div className="inline-block px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold mb-3">
      閱讀策略：{name}
    </div>
    <p className="text-sm text-gray-600 leading-relaxed bg-violet-50 rounded-xl px-4 py-3 border border-violet-100">
      {instruction}
    </p>
  </div>
);

export default StrategyHeader;
