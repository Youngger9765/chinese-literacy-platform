import React, { useState } from 'react';
import { AppView } from '../../types';
import type { AuthUser } from '../../types';
import { loginTeacher, loginStudent } from '../../services/api';

type LoginRole = 'teacher' | 'student';

interface LoginPageProps {
  onLogin: (token: string, user: AuthUser) => void;
  onNavigate: (view: AppView) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin, onNavigate }) => {
  const [role, setRole] = useState<LoginRole>('teacher');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [classCode, setClassCode] = useState('');
  const [seatNumber, setSeatNumber] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('密碼至少需要 8 個字元');
      return;
    }

    setIsSubmitting(true);
    try {
      if (role === 'teacher') {
        if (!email.trim()) {
          setError('請輸入 Email');
          setIsSubmitting(false);
          return;
        }
        const result = await loginTeacher(email.trim(), password);
        onLogin(result.access_token, result.user);
      } else {
        if (!classCode.trim()) {
          setError('請輸入班級代碼');
          setIsSubmitting(false);
          return;
        }
        const seat = parseInt(seatNumber, 10);
        if (!seat || seat < 1) {
          setError('請輸入有效的座號');
          setIsSubmitting(false);
          return;
        }
        const result = await loginStudent(classCode.trim().toUpperCase(), seat, password);
        onLogin(result.access_token, result.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '登入失敗，請稍後再試');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4 sm:p-8 overflow-y-auto">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sm:p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="bg-accent w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-3">
              <span className="text-white font-bold text-lg">L</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">登入</h1>
            <p className="text-sm text-gray-500 mt-1">AI 朗讀助教</p>
          </div>

          {/* Role Toggle */}
          <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
            <button
              type="button"
              onClick={() => { setRole('teacher'); setError(''); }}
              className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors ${
                role === 'teacher'
                  ? 'bg-white text-accent shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              教師登入
            </button>
            <button
              type="button"
              onClick={() => { setRole('student'); setError(''); }}
              className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors ${
                role === 'student'
                  ? 'bg-white text-accent shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              學生登入
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {role === 'teacher' ? (
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="teacher@school.edu.tw"
                  required
                  autoComplete="email"
                  className="w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="classCode" className="block text-sm font-medium text-gray-700 mb-1">
                    班級代碼
                  </label>
                  <input
                    id="classCode"
                    type="text"
                    value={classCode}
                    onChange={e => setClassCode(e.target.value.toUpperCase().slice(0, 6))}
                    placeholder="ABC123"
                    required
                    maxLength={6}
                    autoComplete="off"
                    className="w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent uppercase"
                  />
                </div>
                <div>
                  <label htmlFor="seatNumber" className="block text-sm font-medium text-gray-700 mb-1">
                    座號
                  </label>
                  <input
                    id="seatNumber"
                    type="number"
                    value={seatNumber}
                    onChange={e => setSeatNumber(e.target.value)}
                    placeholder="1"
                    required
                    min={1}
                    max={99}
                    autoComplete="off"
                    className="w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                密碼
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="至少 8 個字元"
                required
                minLength={8}
                autoComplete="current-password"
                className="w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
            >
              {isSubmitting ? '登入中...' : '登入'}
            </button>
          </form>

          {/* Register link */}
          <p className="mt-6 text-center text-sm text-gray-500">
            還沒有帳號？{' '}
            <button
              type="button"
              onClick={() => onNavigate(AppView.REGISTER)}
              className="text-accent font-bold hover:underline"
            >
              註冊
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
