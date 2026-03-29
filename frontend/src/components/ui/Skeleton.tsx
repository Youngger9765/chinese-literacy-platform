import React from 'react';

type SkeletonAnimation = 'shimmer' | 'pulse';

interface SkeletonProps {
  className?: string;
  animation?: SkeletonAnimation;
}

const baseClassName = 'relative overflow-hidden bg-slate-200';

const shimmerClassName =
  'before:absolute before:inset-0 before:-translate-x-full before:animate-[sk-shimmer_1.5s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent';

/**
 * Reusable skeleton block. Use className to mimic the final layout shape.
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  animation = 'shimmer',
}) => (
  <div
    className={`${baseClassName} ${animation === 'shimmer' ? shimmerClassName : 'animate-pulse'} ${className}`}
    aria-hidden="true"
  />
);

interface SkeletonTextProps {
  lines?: number;
  className?: string;
  lineClassName?: string;
  animation?: SkeletonAnimation;
}

/**
 * Text-like skeleton lines for paragraphs or metadata blocks.
 */
export const SkeletonText: React.FC<SkeletonTextProps> = ({
  lines = 3,
  className = '',
  lineClassName = 'h-3 rounded',
  animation = 'shimmer',
}) => (
  <div className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }).map((_, index) => {
      const widthClass = index === lines - 1 ? 'w-2/3' : 'w-full';
      return (
        <Skeleton
          key={index}
          animation={animation}
          className={`${lineClassName} ${widthClass}`}
        />
      );
    })}
  </div>
);

export const SkeletonCircle: React.FC<SkeletonProps> = ({
  className = '',
  animation = 'shimmer',
}) => (
  <Skeleton
    animation={animation}
    className={`rounded-full ${className}`}
  />
);

export default Skeleton;
