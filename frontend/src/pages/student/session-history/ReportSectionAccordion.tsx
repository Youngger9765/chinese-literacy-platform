/**
 * ReportSectionAccordion — reusable collapsible section wrapper.
 * Replaces the non-interactive StepSection in the old monolith.
 * Extracted from SessionHistoryReportPage (Issue #1958).
 */

import React, { useState } from 'react';

interface ReportSectionAccordionProps {
  title: string;
  children: React.ReactNode;
  /** Start expanded (default: true) */
  defaultOpen?: boolean;
}

export const ReportSectionAccordion: React.FC<ReportSectionAccordionProps> = ({
  title,
  children,
  defaultOpen = true,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
};

export default ReportSectionAccordion;
