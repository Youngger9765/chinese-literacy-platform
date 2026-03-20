/**
 * SchoolSwitcher — combobox for teachers in multiple schools.
 *
 * Only renders when `hasMultipleSchools` is true (WorkspaceContext).
 * Fetches school names once per mount (or when teacherSchoolIds changes)
 * and displays a select bound to activeSchoolId / setActiveSchoolId.
 *
 * Implements #572.
 */

import React, { useEffect, useState, useId } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { getSchool, SchoolApiError } from '../../services/schoolApi';

interface SchoolOption {
  id: number;
  label: string;
}

const SchoolSwitcher: React.FC = () => {
  const { token } = useAuth();
  const {
    activeSchoolId,
    setActiveSchoolId,
    teacherSchoolIds,
    hasMultipleSchools,
  } = useWorkspace();

  const [options, setOptions] = useState<SchoolOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const selectId = useId();

  useEffect(() => {
    if (!token || teacherSchoolIds.length === 0) return;

    let cancelled = false;
    setIsLoading(true);

    Promise.all(
      teacherSchoolIds.map(async (id) => {
        try {
          const school = await getSchool(token, id);
          return { id, label: school.display_name ?? school.name };
        } catch (err) {
          if (err instanceof SchoolApiError && err.status === 404) {
            // school may not be accessible; fall back to ID label
            return { id, label: `學校 #${id}` };
          }
          return { id, label: `學校 #${id}` };
        }
      }),
    ).then((results) => {
      if (!cancelled) {
        setOptions(results.sort((a, b) => a.label.localeCompare(b.label, 'zh-TW')));
        setIsLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [token, teacherSchoolIds]);

  // Single-school teachers: don't render anything
  if (!hasMultipleSchools) return null;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = parseInt(e.target.value, 10);
    if (!Number.isNaN(id)) setActiveSchoolId(id);
  };

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={selectId}
        className="text-sm font-medium text-gray-600 whitespace-nowrap"
      >
        目前學校
      </label>
      <div className="relative">
        {/* Building icon */}
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </svg>
        <select
          id={selectId}
          value={activeSchoolId ?? ''}
          onChange={handleChange}
          disabled={isLoading || options.length === 0}
          aria-label="切換目前學校"
          className="h-9 pl-8 pr-8 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm
                     focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent
                     transition-colors appearance-none disabled:opacity-60 disabled:cursor-not-allowed
                     min-w-[140px]"
        >
          {isLoading ? (
            <option value="">載入中...</option>
          ) : (
            options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))
          )}
        </select>
        {/* Chevron */}
        <svg
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
};

export default SchoolSwitcher;
