/**
 * SemesterPanel — orchestrator for semester management.
 *
 * Owns loading state, semester list data, and top-level error.
 * Delegates rendering to:
 *   - SemesterCreateForm  (new semester modal/inline form)
 *   - SemesterList        (sortable list with inline edit + activate)
 *
 * Features:
 * - List all semesters for a school (ordered newest first)
 * - Show active semester badge
 * - Create new semester with name, start/end date, grace_days
 * - Activate a semester (propagates expires_at to ClassroomText rows)
 * - Edit semester name / dates / grace_days
 * - Show expires_at_date (= end_date + grace_days)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { listSemesters, SemesterResponse, SemesterApiError } from '../../services/semesterApi';
import { CalendarIcon, PlusIcon } from './semester/semesterIcons';
import SemesterCreateForm from './semester/SemesterCreateForm';
import SemesterList from './semester/SemesterList';

// ── Main Component ────────────────────────────────────────────────────────────

interface SemesterPanelProps {
  schoolId: number;
}

const SemesterPanel: React.FC<SemesterPanelProps> = ({ schoolId }) => {
  const { token } = useAuth();

  const [semesters, setSemesters] = useState<SemesterResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listSemesters(token, schoolId);
      setSemesters(data);
    } catch (err) {
      setError(err instanceof SemesterApiError ? err.message : '載入學期失敗');
    } finally {
      setIsLoading(false);
    }
  }, [token, schoolId]);

  useEffect(() => { load(); }, [load]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleCreateSuccess = () => {
    setShowCreate(false);
    load();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-800">學期管理</h2>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
          >
            <PlusIcon />
            新增學期
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && token && (
        <SemesterCreateForm
          token={token}
          schoolId={schoolId}
          onSuccess={handleCreateSuccess}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
          載入中...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
          {error}
          <button onClick={load} className="ml-2 underline cursor-pointer">重試</button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && semesters.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <CalendarIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">尚無學期設定</p>
          <p className="text-xs mt-1">點擊「新增學期」開始建立</p>
        </div>
      )}

      {/* Semester list */}
      {!isLoading && semesters.length > 0 && token && (
        <SemesterList
          token={token}
          schoolId={schoolId}
          semesters={semesters}
          onReload={load}
          onError={setError}
        />
      )}

      {/* Expiry policy note */}
      <div className="mt-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-xs text-amber-700">
          版權保護說明：根據 PRD §742-756，教師上傳的課文在學期結束後加上寬限天數會自動過期。
          過期的課文由系統管理員執行清理作業（Admin &gt; 清理）進行軟刪除。
        </p>
      </div>
    </div>
  );
};

export default SemesterPanel;
