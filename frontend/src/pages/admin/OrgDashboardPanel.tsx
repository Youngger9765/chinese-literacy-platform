import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { BuildingIcon, SchoolIcon, UsersIcon } from '../../components/icons';
import {
  getOrgDashboard,
  OrgDashboardResponse,
  OrganizationApiError,
} from '../../services/organizationApi';

interface OrgDashboardPanelProps {
  organizationId: string;
}

// Simple book/session icon
const SessionIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={`w-4 h-4 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  </svg>
);

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, colorClass }) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
    <div className={`inline-flex items-center justify-center w-11 h-11 rounded-xl ${colorClass} shrink-0`}>
      {icon}
    </div>
    <div>
      <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
    </div>
  </div>
);

const OrgDashboardPanel: React.FC<OrgDashboardPanelProps> = ({ organizationId }) => {
  const { token } = useAuth();
  const [data, setData] = useState<OrgDashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const result = await getOrgDashboard(token, organizationId);
      setData(result);
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setError(err.message);
      } else {
        setError('無法載入儀表板資料');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, organizationId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
                <div className="w-11 h-11 bg-gray-200 animate-pulse rounded-xl shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-6 bg-gray-200 animate-pulse rounded w-1/3" />
                  <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="h-5 bg-gray-200 animate-pulse rounded w-1/4 mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-200 animate-pulse rounded" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button
              onClick={loadDashboard}
              className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
            >
              重試
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Stat cards 2x2 grid */}
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="所屬學校"
            value={data.total_schools}
            icon={<BuildingIcon className="w-5 h-5 text-violet-600" />}
            colorClass="bg-violet-100"
          />
          <StatCard
            label="教師人數"
            value={data.total_teachers}
            icon={<UsersIcon className="w-5 h-5 text-blue-600" />}
            colorClass="bg-blue-100"
          />
          <StatCard
            label="學生人數"
            value={data.total_students}
            icon={<SchoolIcon className="w-5 h-5 text-emerald-600" />}
            colorClass="bg-emerald-100"
          />
          <StatCard
            label="總學習次數"
            value={data.total_sessions}
            icon={<SessionIcon className="text-amber-600" />}
            colorClass="bg-amber-100"
          />
        </div>

        {/* Completed sessions sub-stat */}
        {data.total_sessions > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex items-center justify-between">
            <span className="text-sm text-gray-600">已完成學習次數</span>
            <span className="text-sm font-bold text-emerald-700">
              {data.completed_sessions.toLocaleString()}
              <span className="text-gray-400 font-normal ml-1">
                / {data.total_sessions.toLocaleString()}
              </span>
            </span>
          </div>
        )}

        {/* Per-school table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-100">
            <h3 className="font-bold text-gray-900">各校概覽</h3>
          </div>

          {data.school_stats.length === 0 ? (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl mb-3">
                <BuildingIcon className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">尚無所屬學校</p>
              <p className="text-xs text-gray-500">請先在「詳情」頁新增學校</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      學校名稱
                    </th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      教師數
                    </th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      學生數
                    </th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      學習次數
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.school_stats.map((school) => (
                    <tr key={school.school_id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-900">
                        {school.school_name}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-700">
                        {school.teacher_count}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-700">
                        {school.student_count}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-700">
                        {school.session_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrgDashboardPanel;
