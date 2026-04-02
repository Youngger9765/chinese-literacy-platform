import React from 'react';
import LoadingIndicator from './LoadingIndicator';
import { Skeleton, SkeletonText } from './Skeleton';

/**
 * Route-level Suspense fallback.
 * Shows both loading indicator and layout skeletons to avoid a blank screen.
 */
const PageLoader: React.FC = () => (
  <div className="flex-1 overflow-y-auto bg-amber-50">
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <LoadingIndicator textClassName="text-sm text-gray-500" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="bg-white rounded-2xl shadow-card p-5">
            <Skeleton className="h-5 w-2/3 rounded mb-3" />
            <SkeletonText lines={3} lineClassName="h-3 rounded" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default PageLoader;
