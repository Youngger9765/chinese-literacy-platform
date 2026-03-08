import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getStudentInstructions,
  createStudentInstruction,
  updateInstruction,
  deleteInstruction,
  TeacherInstruction,
  TeacherApiError,
} from '../../services/teacherApi';

interface TeacherInstructionPanelProps {
  studentId: number;
  studentName: string;
  classroomId: number;
  onClose: () => void;
}

const INSTRUCTION_TYPES = [
  { value: 'general', label: '一般', color: 'bg-gray-100 text-gray-700' },
  { value: 'reading', label: '朗讀', color: 'bg-blue-100 text-blue-700' },
  { value: 'comprehension', label: '理解', color: 'bg-purple-100 text-purple-700' },
  { value: 'vocabulary', label: '生字', color: 'bg-green-100 text-green-700' },
];

function getTypeConfig(type: string) {
  return INSTRUCTION_TYPES.find((t) => t.value === type) ?? INSTRUCTION_TYPES[0];
}

const TeacherInstructionPanel: React.FC<TeacherInstructionPanelProps> = ({
  studentId,
  studentName,
  classroomId,
  onClose,
}) => {
  const { token } = useAuth();
  const [instructions, setInstructions] = useState<TeacherInstruction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // New instruction form state
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState('general');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editType, setEditType] = useState('general');

  const loadInstructions = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getStudentInstructions(token, studentId);
      setInstructions(data);
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setError(err.message);
      } else {
        setError('Failed to load instructions');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, studentId]);

  useEffect(() => {
    loadInstructions();
  }, [loadInstructions]);

  const handleCreate = useCallback(async () => {
    if (!token || !newContent.trim()) return;
    setIsSubmitting(true);
    setError('');
    try {
      await createStudentInstruction(token, studentId, {
        classroom_id: classroomId,
        instruction_type: newType,
        content: newContent.trim(),
      });
      setNewContent('');
      setNewType('general');
      await loadInstructions();
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setError(err.message);
      } else {
        setError('Failed to create instruction');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [token, studentId, classroomId, newContent, newType, loadInstructions]);

  const handleUpdate = useCallback(
    async (id: number) => {
      if (!token || !editContent.trim()) return;
      setError('');
      try {
        await updateInstruction(token, id, {
          content: editContent.trim(),
          instruction_type: editType,
        });
        setEditingId(null);
        await loadInstructions();
      } catch (err) {
        if (err instanceof TeacherApiError) {
          setError(err.message);
        } else {
          setError('Failed to update instruction');
        }
      }
    },
    [token, editContent, editType, loadInstructions],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!token) return;
      setError('');
      try {
        await deleteInstruction(token, id);
        await loadInstructions();
      } catch (err) {
        if (err instanceof TeacherApiError) {
          setError(err.message);
        } else {
          setError('Failed to delete instruction');
        }
      }
    },
    [token, loadInstructions],
  );

  const startEditing = (instr: TeacherInstruction) => {
    setEditingId(instr.id);
    setEditContent(instr.content);
    setEditType(instr.instruction_type);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {studentName} - AI 教學指示
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              設定特別指示，AI 對話時會依照指示調整教學方式
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* New instruction form */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-accent/30 focus:border-accent outline-none"
              >
                {INSTRUCTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <div className="flex-1 relative">
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="輸入教學指示，例如：這個學生有閱讀障礙，請放慢速度..."
                  maxLength={500}
                  rows={2}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-accent/30 focus:border-accent outline-none"
                />
                <span className="absolute bottom-1.5 right-2 text-[10px] text-gray-300">
                  {newContent.length}/500
                </span>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleCreate}
                disabled={isSubmitting || !newContent.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {isSubmitting ? '新增中...' : '新增指示'}
              </button>
            </div>
          </div>

          {/* Divider */}
          <hr className="border-gray-100" />

          {/* Instruction list */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : instructions.length === 0 ? (
            <div className="text-center py-6">
              <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
              </svg>
              <p className="text-sm text-gray-500">尚無教學指示</p>
              <p className="text-xs text-gray-400 mt-0.5">新增指示後，AI 對話時會自動套用</p>
            </div>
          ) : (
            <div className="space-y-2">
              {instructions.map((instr) => {
                const typeConfig = getTypeConfig(instr.instruction_type);
                const isEditing = editingId === instr.id;

                return (
                  <div
                    key={instr.id}
                    className="border border-gray-100 rounded-lg p-3 hover:border-gray-200 transition-colors"
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value)}
                            className="px-2 py-1 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-accent/30 outline-none"
                          >
                            {INSTRUCTION_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          maxLength={500}
                          rows={2}
                          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-accent/30 outline-none"
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => handleUpdate(instr.id)}
                            disabled={!editContent.trim()}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
                          >
                            儲存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${typeConfig.color} mb-1.5`}
                            >
                              {typeConfig.label}
                            </span>
                            <p className="text-sm text-gray-700 leading-relaxed">
                              {instr.content}
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => startEditing(instr)}
                              className="p-1 rounded hover:bg-gray-100 transition-colors"
                              title="Edit"
                            >
                              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDelete(instr.id)}
                              className="p-1 rounded hover:bg-red-50 transition-colors"
                              title="Delete"
                            >
                              <svg className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-300 mt-1.5">
                          {new Date(instr.created_at).toLocaleDateString('zh-TW', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeacherInstructionPanel;
