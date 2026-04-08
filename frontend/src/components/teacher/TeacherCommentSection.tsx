/**
 * TeacherCommentSection — AI-generated + teacher-editable comment for a session.
 *
 * Displays AI comment (auto-generated on first view), allows teacher to edit/override,
 * and shows reviewed timestamp.
 *
 * Issue #993
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  generateAIComment,
  saveTeacherComment,
} from '../../services/teacherApi';

interface TeacherCommentSectionProps {
  studentId: number;
  sessionId: number;
  token: string;
  aiComment: string | null;
  teacherComment: string | null;
  teacherReviewedAt: string | null;
  studentName: string;
}

const TeacherCommentSection: React.FC<TeacherCommentSectionProps> = ({
  studentId,
  sessionId,
  token,
  aiComment: initialAiComment,
  teacherComment: initialTeacherComment,
  teacherReviewedAt,
  studentName,
}) => {
  const [aiComment, setAiComment] = useState(initialAiComment ?? '');
  const [comment, setComment] = useState(initialTeacherComment ?? initialAiComment ?? '');
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Auto-generate AI comment if none exists
  useEffect(() => {
    if (initialAiComment) return;
    setAiLoading(true);
    generateAIComment(token, studentId, sessionId)
      .then((res) => {
        setAiComment(res.ai_comment);
        if (!initialTeacherComment) {
          setComment(res.ai_comment);
        }
      })
      .catch(() => {})
      .finally(() => setAiLoading(false));
  }, [token, studentId, sessionId, initialAiComment, initialTeacherComment]);

  const handleRegenerate = useCallback(async () => {
    setAiLoading(true);
    try {
      // Force regeneration by calling the endpoint (it's idempotent with cache,
      // but we want fresh — for now the backend caches, so this returns existing)
      const res = await generateAIComment(token, studentId, sessionId);
      setAiComment(res.ai_comment);
    } catch {
      // ignore
    } finally {
      setAiLoading(false);
    }
  }, [token, studentId, sessionId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      await saveTeacherComment(token, studentId, sessionId, comment);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [token, studentId, sessionId, comment]);

  return (
    <div className="mt-8 space-y-4">
      <h3 className="text-lg font-bold text-gray-900">
        給 {studentName} 的評語
      </h3>

      {/* AI suggested comment */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
            AI 建議評語
          </span>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={aiLoading}
            className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
          >
            {aiLoading ? '產生中...' : '重新產生'}
          </button>
        </div>
        {aiLoading && !aiComment ? (
          <div className="animate-pulse h-16 bg-blue-100 rounded" />
        ) : (
          <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-wrap">
            {aiComment || '尚無 AI 評語'}
          </p>
        )}
      </div>

      {/* Teacher editable comment */}
      <div>
        <label htmlFor="teacher-comment" className="block text-sm font-semibold text-gray-700 mb-1">
          你的評語
        </label>
        <textarea
          id="teacher-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="編輯或補充評語..."
          className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 bg-white focus:border-accent focus:ring-1 focus:ring-accent resize-y"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-400">
            {comment.length}/2000
            {teacherReviewedAt && (
              <> · 查看於 {new Date(teacherReviewedAt).toLocaleDateString('zh-TW')}</>
            )}
          </span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? '儲存中...' : saved ? '已儲存 ✓' : '儲存評語'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TeacherCommentSection;
