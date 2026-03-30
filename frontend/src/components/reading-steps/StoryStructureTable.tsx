/**
 * StoryStructureTable — 文章重點表 (#615, #845)
 *
 * Fetches AI-generated story structure from /api/stories/{id}/structure.
 * Displays a labelled table matching 三民教材's 文章重點表 format.
 * Genre-aware: 記敘文 shows 主角/主題/事例, 說明文 shows concept structure, etc.
 *
 * #845: Reduced font sizes + thicker/darker borders for better structure visibility.
 */
import React, { useEffect, useState } from 'react';

interface StructureRow {
  label: string;
  value: string;
  sub_rows?: Array<{ label: string; value: string }>;
}

interface Props {
  storyId: string;
}

const StoryStructureTable: React.FC<Props> = ({ storyId }) => {
  const [rows, setRows] = useState<StructureRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    const API_BASE = import.meta.env.VITE_API_URL || '';
    fetch(`${API_BASE}/api/stories/${storyId}/structure`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setRows(data.rows ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [storyId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-400 text-xs">
        <span className="animate-spin mr-2">⏳</span> 正在整理文章重點…
      </div>
    );
  }

  if (error || !rows) {
    return (
      <div className="p-4 text-xs text-red-500 text-center">
        無法載入文章重點表，請重新整理頁面
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border-2 border-gray-300 shadow-sm">
      {/* Header (#845: smaller font) */}
      <div className="bg-amber-50 border-b-2 border-amber-300 px-4 py-2 flex items-center gap-2">
        <span className="text-amber-700 font-semibold text-xs">📋 文章重點表</span>
      </div>
      {/* Table (#845: border-collapse with visible 1.5px borders, text-xs) */}
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((row, idx) => (
            row.sub_rows && row.sub_rows.length > 0 ? (
              // Grouped row (e.g. 事例 with 背景/經過/結果)
              row.sub_rows.map((sub, sIdx) => (
                <tr key={`${idx}-${sIdx}`} style={{ borderBottom: '1.5px solid #9ca3af' }}>
                  {sIdx === 0 && (
                    <td
                      rowSpan={row.sub_rows!.length}
                      className="bg-amber-50 px-3 py-2 font-semibold text-gray-700 text-center align-middle w-16"
                      style={{ borderRight: '1.5px solid #9ca3af' }}
                    >
                      {row.label}
                    </td>
                  )}
                  <td
                    className="bg-gray-50 px-3 py-2 font-medium text-gray-600 text-center w-14"
                    style={{ borderRight: '1.5px solid #9ca3af' }}
                  >
                    {sub.label}
                  </td>
                  <td className="px-4 py-2 text-gray-800 leading-relaxed">{sub.value}</td>
                </tr>
              ))
            ) : (
              // Simple row
              <tr key={idx} style={{ borderBottom: '1.5px solid #9ca3af' }}>
                <td
                  className="bg-amber-50 px-3 py-2 font-semibold text-gray-700 text-center w-16"
                  style={{ borderRight: '1.5px solid #9ca3af' }}
                >
                  {row.label}
                </td>
                <td colSpan={2} className="px-4 py-2 text-gray-800 leading-relaxed">
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
