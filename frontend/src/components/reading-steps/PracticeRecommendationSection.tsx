/**
 * PracticeRecommendationSection — Section 5 of AssessmentReport (#1945).
 * 環節五：練習建議
 *
 * Extracted from the inline Section 5 block in AssessmentReport.tsx.
 * Renders AI-generated practice suggestion cards based on reading performance.
 */

import React from 'react';

interface Suggestion {
  icon: string;
  title: string;
  desc: string;
}

interface PracticeRecommendationSectionProps {
  suggestions: Suggestion[];
  /** Whether a reading attempt exists — used to decide which empty-state to show */
  hasReadingAttempt: boolean;
}

/**
 * Section 5: 練習建議
 *
 * Renders:
 * - List of icon + title + description suggestion cards
 * - Empty state with prompt to complete reading practice
 */
const PracticeRecommendationSection: React.FC<PracticeRecommendationSectionProps> = ({
  suggestions,
}) => {
  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-4">完成朗讀練習後會產生建議</p>
    );
  }

  return (
    <div className="space-y-3">
      {suggestions.map((s, idx) => (
        <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
          <span className="text-2xl shrink-0">{s.icon}</span>
          <div>
            <p className="font-bold text-sm text-gray-900">{s.title}</p>
            <p className="text-sm text-gray-500">{s.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default PracticeRecommendationSection;
