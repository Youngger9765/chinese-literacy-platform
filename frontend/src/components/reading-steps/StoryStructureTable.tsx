/**
 * StoryStructureTable — 文章重點表 (#615, #845)
 *
 * Fetches AI-generated story structure from /api/stories/{id}/structure.
 * Displays a labelled table matching 三民教材's 文章重點表 format.
 * Genre-aware: 記敘文 shows 主角/主題/事例, 說明文 shows concept structure, etc.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface StructureRow {
  label: string;
  value: string;
  sub_rows?: Array<{ label: string; value: string }>;
}

interface Props {
  storyId: string;
}

const StoryStructureTable: React.FC<Props> = ({ storyId }) => {
  const { token } = useAuth();
  const [rows, setRows] = useState<StructureRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    const API_BASE = import.meta.env.VITE_API_URL || '';
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch(`${API_BASE}/api/stories/${storyId}/structure`, { headers })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setRows(data.rows ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [storyId, token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-400 text-sm">
        <span className="animate-spin mr-2">⏳</span> 正在整理文章重點…
      </div>
    );
  }

  if (error || !rows) {
    return (
      <div className="p-4 text-sm text-red-500 text-center">
        無法載入文章重點表，請重新整理頁面
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border-2 border-gray-300 shadow-sm max-w-2xl mx-auto">
      {/* Header */}
      <div className="bg-amber-50 border-b-2 border-amber-400 px-5 py-3">
        <span className="text-amber-800 font-bold text-base">📋 文章重點表</span>
      </div>
      {/* Table */}
      <table className="w-full text-base" style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((row, idx) => (
            row.sub_rows && row.sub_rows.length > 0 ? (
              row.sub_rows.map((sub, sIdx) => (
                <tr key={`${idx}-${sIdx}`} style={{ borderBottom: '1.5px solid #d1d5db' }}>
                  {sIdx === 0 && (
                    <td
                      rowSpan={row.sub_rows!.length}
                      className="bg-amber-50 px-4 py-3 font-bold text-gray-800 text-center align-middle w-20"
                      style={{ borderRight: '1.5px solid #d1d5db' }}
                    >
                      {row.label}
                    </td>
                  )}
                  <td
                    className="bg-gray-50 px-3 py-3 font-semibold text-gray-600 text-center w-16"
                    style={{ borderRight: '1.5px solid #d1d5db' }}
                  >
                    {sub.label}
                  </td>
                  <td className="px-5 py-3 text-gray-800 leading-relaxed">{sub.value}</td>
                </tr>
              ))
            ) : (
              <tr key={idx} style={{ borderBottom: '1.5px solid #d1d5db' }}>
                <td
                  className="bg-amber-50 px-4 py-3 font-bold text-gray-800 text-center w-20"
                  style={{ borderRight: '1.5px solid #d1d5db' }}
                >
                  {row.label}
                </td>
                <td colSpan={2} className="px-5 py-3 text-gray-800 leading-relaxed">
                  {row.value}
                </td>
              </tr>
            )
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default StoryStructureTable;
