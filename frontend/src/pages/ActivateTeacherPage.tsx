import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { activateTeacher, AuthError } from '../services/authApi';

/**
 * ActivateTeacherPage — self-serve "開通老師身分" (#3804).
 *
 * Young 2026-11-01 (second + third instructions): any student can self-
 * activate as a teacher by naming the school(s) they teach at. No approval.
 * Design is written out in full (wireframe, error states, navigation) in
 * docs/prd/2026-11-01-school-as-teacher-attribute-prd.md §10 — this
 * component follows that design 1:1; see §10 before changing copy/flow here.
 *
 * Entry point: student sidebar, right after "加入班級" (§10.1).
 * Route: /activate-teacher (independent page, not a modal — §10.2 explains
 * why: a modal on a 390px-wide phone fights with the keyboard).
 */

const MAX_SCHOOLS = 5; // frontend-only soft cap; backend allows up to 10 (§11.2)

const ActivateTeacherPage: React.FC = () => {
  const navigate = useNavigate();
  const { token, refreshUser } = useAuth();
  const { setActiveView } = useWorkspace();

  const [schoolNames, setSchoolNames] = useState<string[]>(['']);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successSchools, setSuccessSchools] = useState<string[] | null>(null);

  const updateName = (index: number, value: string) => {
    setSchoolNames((prev) => prev.map((n, i) => (i === index ? value : n)));
    setError('');
  };

  const addSchoolField = () => {
    if (schoolNames.length >= MAX_SCHOOLS) return;
    setSchoolNames((prev) => [...prev, '']);
  };

  const removeSchoolField = (index: number) => {
    setSchoolNames((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = schoolNames.map((n) => n.trim()).filter((n) => n.length > 0);
    if (cleaned.length === 0) {
      setError('請至少填寫一所學校');
      return;
    }
    if (!token) {
      setError('請先登入');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const result = await activateTeacher(token, cleaned);
      await refreshUser();
      setSuccessSchools(result.schools.map((s) => s.name));
      setActiveView('teacher');
      setTimeout(() => navigate('/teacher-home'), 1500);
    } catch (err) {
      if (err instanceof AuthError) {
        setError(err.message || '開通失敗，請稍後再試');
      } else {
        setError('開通失敗，請檢查網路連線後再試一次');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successSchools) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4 text-3xl">
            🎉
          </div>
          <h1 className="text-2xl font-bold text-gray-900">開通成功！</h1>
          <p className="text-gray-500 text-sm mt-2">你現在也是老師了</p>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 mt-6 text-sm text-gray-700">
            {successSchools.join('、')}
          </div>
          <p className="text-xs text-gray-400 mt-4">正在前往老師首頁...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4 text-3xl">
            🏫
          </div>
          <h1 className="text-2xl font-bold text-gray-900">開通老師身分</h1>
          <p className="text-gray-500 text-sm mt-2">
            填寫你任教的學校，開通後就能建立班級、指派作業。可以填多所學校。
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4"
        >
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {schoolNames.map((name, index) => (
            <div key={index}>
              <label htmlFor={`school-${index}`} className="block text-sm font-medium text-gray-700 mb-1">
                學校 {index + 1}
              </label>
              <div className="flex gap-2">
                <input
                  id={`school-${index}`}
                  type="text"
                  value={name}
                  onChange={(e) => updateName(index, e.target.value)}
                  placeholder="例如：大安國小"
                  autoComplete="off"
                  autoFocus={index === 0}
                  className="flex-1 h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                />
                {schoolNames.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSchoolField(index)}
                    aria-label={`移除學校 ${index + 1}`}
                    className="px-3 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}

          {schoolNames.length < MAX_SCHOOLS && (
            <button
              type="button"
              onClick={addSchoolField}
              className="text-sm text-accent hover:text-accent-hover font-medium transition-colors"
            >
              + 再加一所學校
            </button>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
          >
            {isSubmitting ? '開通中...' : '開通老師身分'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-accent hover:text-accent-hover font-medium transition-colors"
          >
            返回首頁
          </button>
        </p>
      </div>
    </div>
  );
};

export default ActivateTeacherPage;
