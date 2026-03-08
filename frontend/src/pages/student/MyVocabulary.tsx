import React from 'react';
import ErrorPatternsCard from '../../components/student/ErrorPatternsCard';
import RecommendedVocab from '../../components/student/RecommendedVocab';

/**
 * MyVocabulary page - "我的生字" (My Vocabulary) section.
 *
 * Shows:
 * 1. Recommended vocab to practice (top 10 most-errored characters)
 * 2. Full list of frequently-errored characters with correction tracking
 */
const MyVocabulary: React.FC = () => {
  return (
    <div className="p-6 max-w-4xl mx-auto w-full overflow-y-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">我的生字</h1>
        <p className="text-sm text-gray-500 mt-1">
          根據你的學習紀錄，這些是需要加強練習的字
        </p>
      </div>

      <RecommendedVocab />
      <ErrorPatternsCard />
    </div>
  );
};

export default MyVocabulary;
