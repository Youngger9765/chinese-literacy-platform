import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AuthError } from '../services/authApi';

interface LoginPageProps {
  onSwitchToRegister: () => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onSwitchToRegister }) => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('請填寫所有欄位');
      return;
    }

    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.status === 401) {
          setError('電子郵件或密碼錯誤');
        } else {
          setError(err.message);
        }
      } else {
        setError('登入失敗，請稍後再試');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4">
            <span className="text-white font-black text-2xl">L</span>
          </div>
          <h1 className="text-2xl font-black text-gray-900">AI 朗讀助教</h1>
          <p className="text-gray-500 text-sm mt-1">登入你的帳號</p>
        </div>

        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4"
        >
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">
              電子郵件
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
              密碼
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="輸入密碼"
              className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
          >
            {isSubmitting ? '登入中...' : '登入'}
          </button>
        </form>

        {/* Switch to Register */}
        <p className="text-center text-sm text-gray-500 mt-6">
          還沒有帳號？{' '}
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="text-accent hover:text-accent-hover font-medium transition-colors"
          >
            註冊帳號
          </button>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
