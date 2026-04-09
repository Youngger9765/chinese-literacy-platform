/**
 * TermsOfService — ToS + copyright consent page (issue #1013).
 *
 * Teachers must check all 4 commitments before proceeding.
 * Students see a simplified single-checkbox version.
 * On acceptance calls POST /api/auth/accept-terms, then redirects to dashboard.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { hasRole } from '../../services/authApi';

interface Commitment {
  id: string;
  label: string;
}

const TEACHER_COMMITMENTS: Commitment[] = [
  {
    id: 'real-info',
    label: '我確認班級與學生資料為真實資訊',
  },
  {
    id: 'licensed-content',
    label: '課文內容已獲得教科書出版商授權使用',
  },
  {
    id: 'no-unauthorized',
    label: '我不會上傳未經授權的課文',
  },
  {
    id: 'auto-delete',
    label: '學期結束後，系統將自動刪除已上傳的課文',
  },
];

const STUDENT_COMMITMENTS: Commitment[] = [
  {
    id: 'learn-earnestly',
    label: '我了解這是學習平台，會認真使用',
  },
];

const TermsOfService: React.FC = () => {
  const { user, acceptTerms } = useAuth();
  const navigate = useNavigate();

  const isTeacher = hasRole(user, 'teacher', 'school_admin', 'org_admin', 'system_admin');
  const commitments = isTeacher ? TEACHER_COMMITMENTS : STUDENT_COMMITMENTS;

  const [checked, setChecked] = useState<Record<string, boolean>>(
    () => Object.fromEntries(commitments.map((c) => [c.id, false])),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = commitments.every((c) => checked[c.id]);

  const toggle = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allChecked || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await acceptTerms();
      navigate('/', { replace: true });
    } catch {
      setError('送出失敗，請稍後再試');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#FDF8F0] px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#5B4FC4] rounded-2xl mb-4">
            <span className="text-white font-black text-2xl">L</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1A1A2E]">使用條款</h1>
          <p className="text-[#6B7280] text-sm mt-2">
            {isTeacher
              ? '在使用 LingoLeap 平台前，請詳閱並同意以下教師承諾'
              : '在使用 LingoLeap 平台前，請詳閱並同意以下事項'}
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm border border-[#E5E0D5] p-6 space-y-6"
        >
          {/* Role badge */}
          <div className="flex items-center gap-2">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-[#5B4FC4]/10 text-[#5B4FC4]">
              {isTeacher ? '教師帳號' : '學生帳號'}
            </span>
            {user?.name && (
              <span className="text-sm text-[#6B7280]">{user.name}</span>
            )}
          </div>

          {/* Commitments */}
          <div className="space-y-4">
            {isTeacher && (
              <p className="text-sm font-medium text-[#1A1A2E]">我承諾以下事項：</p>
            )}
            {commitments.map((c) => (
              <label
                key={c.id}
                className="flex items-start gap-3 cursor-pointer group"
              >
                <div className="relative flex-shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    id={c.id}
                    checked={checked[c.id]}
                    onChange={() => toggle(c.id)}
                    className="sr-only"
                  />
                  <div
                    className={[
                      'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                      checked[c.id]
                        ? 'bg-[#5B4FC4] border-[#5B4FC4]'
                        : 'bg-white border-[#E5E0D5] group-hover:border-[#5B4FC4]/60',
                    ].join(' ')}
                    aria-hidden="true"
                  >
                    {checked[c.id] && (
                      <svg
                        className="w-3 h-3 text-white"
                        viewBox="0 0 12 12"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                </div>
                <span
                  className={[
                    'text-sm leading-relaxed transition-colors',
                    checked[c.id] ? 'text-[#1A1A2E]' : 'text-[#6B7280]',
                  ].join(' ')}
                >
                  {c.label}
                </span>
              </label>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-[#E5E0D5]" />

          {/* Privacy policy link */}
          <p className="text-xs text-[#9CA3AF] leading-relaxed">
            繼續使用即表示您同意本平台的{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#5B4FC4] hover:underline"
            >
              隱私權政策
            </a>
            。如有疑問請聯繫您的學校管理員
          </p>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!allChecked || isSubmitting}
            className={[
              'w-full h-11 rounded-xl font-bold text-sm transition-all',
              allChecked && !isSubmitting
                ? 'bg-[#5B4FC4] hover:bg-[#4A3FA3] text-white shadow-sm'
                : 'bg-[#E5E0D5] text-[#9CA3AF] cursor-not-allowed',
            ].join(' ')}
          >
            {isSubmitting ? '處理中...' : '同意並繼續'}
          </button>

          {/* Progress hint */}
          {!allChecked && (
            <p className="text-center text-xs text-[#9CA3AF]">
              請勾選全部{commitments.length}項才能繼續
            </p>
          )}
        </form>
      </div>
    </div>
  );
};

export default TermsOfService;
