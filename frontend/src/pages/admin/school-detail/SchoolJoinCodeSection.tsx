/**
 * SchoolJoinCodeSection — display, generate, and copy school join code.
 *
 * Extracted from SchoolDetailPanel (Issue #1849).
 */
import React from 'react';

export interface SchoolJoinCodeSectionProps {
  joinCode: string | null;
  isRegenerating: boolean;
  codeCopied: boolean;
  onRegenerate: () => void;
  onCopy: () => void;
}

const SchoolJoinCodeSection: React.FC<SchoolJoinCodeSectionProps> = ({
  joinCode,
  isRegenerating,
  codeCopied,
  onRegenerate,
  onCopy,
}) => {
  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <h3 className="font-bold text-gray-900 mb-4">學校加入代碼</h3>
      {joinCode ? (
        <div className="flex items-center gap-3">
          <div className="bg-gray-100 font-mono text-lg tracking-widest px-4 py-2 rounded-lg text-gray-900">
            {joinCode}
          </div>
          <button
            onClick={onCopy}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer"
            title="複製代碼"
          >
            {codeCopied ? '已複製' : '複製'}
          </button>
          <button
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRegenerating ? '產生中...' : '重新產生'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">尚無加入代碼</span>
          <button
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRegenerating ? '產生中...' : '產生代碼'}
          </button>
        </div>
      )}
    </div>
  );
};

export default SchoolJoinCodeSection;
