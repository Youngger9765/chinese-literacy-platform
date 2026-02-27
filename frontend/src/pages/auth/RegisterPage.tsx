import React, { useState } from 'react';
import { AppView } from '../../types';
import type { AuthUser } from '../../types';
import { registerTeacher } from '../../services/api';

interface RegisterPageProps {
  onLogin: (token: string, user: AuthUser) => void;
  onNavigate: (view: AppView) => void;
}

const RegisterPage: React.FC<RegisterPageProps> = ({ onLogin, onNavigate }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('請輸入姓名');
      return;
    }
    if (!email.trim()) {
      setError('請輸入 Email');
      return;
    }
    if (password.length < 8) {
      setError('密碼至少需要 8 個字元');
      return;
    }
    if (!schoolName.trim()) {
      setError('請輸入學校名稱');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await registerTeacher(name.trim(), email.trim(), password, schoolName.trim());
      onLogin(result.access_token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '註冊失敗，請稍後再試');
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
            <h1 className="text-xl font-bold text-gray-900">教師註冊</h1>
            <p className="text-sm text-gray-500 mt-1">建立您的 AI 朗讀助教帳號</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="reg-name" className="block text-sm font-medium text-gray-700 mb-1">
                姓名
              </label>
              <input
                id="reg-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="王老師"
                required
                autoComplete="name"
                className="w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="reg-email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="reg-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="teacher@school.edu.tw"
                required
                autoComplete="email"
                className="w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="reg-password" className="block text-sm font-medium text-gray-700 mb-1">
                密碼
              </label>
              <input
                id="reg-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="至少 8 個字元"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="reg-school" className="block text-sm font-medium text-gray-700 mb-1">
                學校名稱
              </label>
              <input
                id="reg-school"
                type="text"
                value={schoolName}
                onChange={e => setSchoolName(e.target.value)}
                placeholder="台北市立國語實小"
                required
                autoComplete="organization"
                className="w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
            >
              {isSubmitting ? '註冊中...' : '註冊'}
            </button>
          </form>

          {/* Login link */}
          <p className="mt-6 text-center text-sm text-gray-500">
            已有帳號？{' '}
            <button
              type="button"
              onClick={() => onNavigate(AppView.LOGIN)}
              className="text-accent font-bold hover:underline"
            >
              登入
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
