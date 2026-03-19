import React from 'react';

/** Route-level Suspense fallback — minimal spinner, matches app loading style. */
const PageLoader: React.FC = () => (
  <div className="flex-1 flex items-center justify-center bg-amber-50">
    <div
      className="flex flex-col items-center gap-3"
      role="status"
      aria-label="頁面載入中，請稍候"
    >
      <div
        className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin"
        aria-hidden="true"
      />
      <span className="text-sm text-gray-400">載入中...</span>
    </div>
  </div>
);

export default PageLoader;
