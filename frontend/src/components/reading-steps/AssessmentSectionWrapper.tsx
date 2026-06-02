/**
 * AssessmentSectionWrapper — Collapsible section shell for AssessmentReport (#1945).
 *
 * Extracted from the inline `Section` component in AssessmentReport.tsx.
 * Provides numbered header with collapse toggle and disabled (greyed-out) state.
 */

import React, { useState } from 'react';

interface AssessmentSectionWrapperProps {
  number: number;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
  defaultOpen?: boolean;
}

/**
 * Section wrapper with numbered badge, collapsible body, and disabled styling.
 * When disabled=true the section is non-interactive (cannot collapse).
 */
const AssessmentSectionWrapper: React.FC<AssessmentSectionWrapperProps> = ({
  number,
  title,
  children,
  disabled,
  defaultOpen = true,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const canToggle = !disabled;

  return (
    <div
      className={`rounded-3xl border overflow-hidden ${
        disabled
          ? 'bg-gray-50 border-dashed border-gray-300'
          : 'bg-white border-slate-200 shadow-sm'
      }`}
    >
      <div
        className={`px-6 py-4 flex items-center gap-3 ${
          disabled ? 'border-gray-200' : 'border-slate-100'
        } ${open ? 'border-b' : ''} ${
          canToggle ? 'cursor-pointer select-none hover:bg-slate-50 transition-colors' : ''
        }`}
        onClick={canToggle ? () => setOpen((o) => !o) : undefined}
        role={canToggle ? 'button' : undefined}
        aria-expanded={canToggle ? open : undefined}
      >
        <span
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
            disabled ? 'bg-gray-200 text-gray-400' : 'bg-accent text-white'
          }`}
        >
          {number}
        </span>
        <h3
          className={`text-lg font-bold flex-1 ${
            disabled ? 'text-gray-400' : 'text-gray-900'
          }`}
        >
          {title}
        </h3>
        {canToggle && (
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ${
              open ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        )}
      </div>
      {open && <div className="p-6">{children}</div>}
    </div>
  );
};

export default AssessmentSectionWrapper;
