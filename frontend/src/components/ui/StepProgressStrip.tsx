/**
 * StepProgressStrip — flex-wrap grid showing learning step status (max 5 per row).
 *
 * Shared by MyAssignments and LearningHistoryPage.
 * Each step bubble shows: completed (green), current (yellow), or pending (gray).
 */

import React from 'react';

export interface ProgressStep {
  id: string;
  label: string;
}

interface StepProgressStripProps {
  steps: ProgressStep[];
  completedSteps: Set<string>;
  currentStepPath?: string | null;
}

const StepProgressStrip: React.FC<StepProgressStripProps> = ({
  steps,
  completedSteps,
  currentStepPath = null,
}) => {
  return (
    <div className="flex flex-wrap gap-1.5">
      {steps.map((step) => {
        const isDone = completedSteps.has(step.id);
        const isCurrent = !isDone && currentStepPath === step.id;
        return (
          <div
            key={step.id}
            title={step.label}
            className={`w-[calc(20%-6px)] min-h-[40px] rounded-md border px-2 py-1 flex items-center justify-center transition-colors ${
              isDone
                ? 'bg-green-100 border-green-200 text-green-800'
                : isCurrent
                  ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                  : 'bg-gray-50 border-gray-200 text-gray-500'
            }`}
          >
            <span className="text-[11px] leading-tight font-medium text-center whitespace-normal break-words">
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default StepProgressStrip;
