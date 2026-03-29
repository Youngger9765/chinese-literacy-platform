import React from 'react';

interface LoadingIndicatorProps {
  label?: string;
  className?: string;
  spinnerClassName?: string;
  textClassName?: string;
}

const dots = [0, 1, 2] as const;

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  label = '載入中',
  className = '',
  spinnerClassName = 'w-8 h-8 border-4 border-accent/30 border-t-accent',
  textClassName = 'text-sm text-gray-500',
}) => (
  <div
    className={`flex flex-col items-center gap-3 ${className}`}
    role="status"
    aria-label="頁面載入中，請稍候"
  >
    <div
      className={`${spinnerClassName} rounded-full animate-spin`}
      aria-hidden="true"
    />

    <p className={`inline-flex items-center ${textClassName}`}>
      <span>{label}</span>
      <span className="inline-flex w-5 justify-start" aria-hidden="true">
        {dots.map((dot, index) => (
          <span
            key={dot}
            className="opacity-0 animate-[loading-dot_1.2s_infinite]"
            style={{ animationDelay: `${index * 0.2}s` }}
          >
            .
          </span>
        ))}
      </span>
    </p>
  </div>
);

export default LoadingIndicator;
