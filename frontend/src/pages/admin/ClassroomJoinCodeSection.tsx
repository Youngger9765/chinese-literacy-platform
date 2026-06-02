/**
 * ClassroomJoinCodeSection — join code display, copy, and regenerate.
 * Extracted from ClassroomDetailPanel (Issue #1850).
 */
import React from 'react';

interface ClassroomJoinCodeSectionProps {
  joinCode: string | null;
  codeCopied: boolean;
  isRegeneratingCode: boolean;
  onCopyCode: () => void;
  onRegenerateCode: () => void;
}

const ClassroomJoinCodeSection: React.FC<ClassroomJoinCodeSectionProps> = ({
  joinCode,
  codeCopied,
  isRegeneratingCode,
  onCopyCode,
  onRegenerateCode,
}) => {
  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <h3 className="font-bold text-gray-900 mb-4">加入代碼</h3>
      {joinCode ? (
        <div className="flex items-center gap-3">
          <div className="bg-gray-100 font-mono text-lg tracking-widest px-4 py-2 rounded-lg text-gray-900">
            {joinCode}
          </div>
          <button
            onClick={onCopyCode}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer"
            title="複製代碼"
          >
            {codeCopied ? '已複製' : '複製'}
          </button>
          <button
            onClick={onRegenerateCode}
            disabled={isRegeneratingCode}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRegeneratingCode ? '產生中...' : '重新產生'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">尚無加入代碼</span>
          <button
            onClick={onRegenerateCode}
            disabled={isRegeneratingCode}
            className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRegeneratingCode ? '產生中...' : '產生代碼'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ClassroomJoinCodeSection;
