import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AuthError } from '../services/authApi';

interface RegisterPageProps {
  onSwitchToLogin: () => void;
}

const RegisterPage: React.FC<RegisterPageProps> = ({ onSwitchToLogin }) => {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = (): string | null => {
    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      return '請填寫所有欄位';
    }
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return '請輸入有效的電子郵件';
    }
    if (password.length < 8) {
      return '密碼至少需要 8 個字元';
    }
    if (password !== confirmPassword) {
      return '兩次輸入的密碼不一致';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      await register(email.trim(), password, name.trim());
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.status === 409 || err.message.includes('already')) {
          setError('此電子郵件已被註冊');
        } else {
          setError(err.message);
        }
      } else {
        setError('註冊失敗，請稍後再試');
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
          <p className="text-gray-500 text-sm mt-1">建立你的帳號</p>
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

          {/* Name */}
          <div>
            <label htmlFor="register-name" className="block text-sm font-medium text-gray-700 mb-1">
              姓名
            </label>
            <input
              id="register-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="你的名字"
              className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="register-email" className="block text-sm font-medium text-gray-700 mb-1">
              電子郵件
            </label>
            <input
              id="register-email"
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
            <label htmlFor="register-password" className="block text-sm font-medium text-gray-700 mb-1">
              密碼
            </label>
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 個字元"
              className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label htmlFor="register-confirm" className="block text-sm font-medium text-gray-700 mb-1">
              確認密碼
            </label>
            <input
              id="register-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再輸入一次密碼"
              className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
          >
            {isSubmitting ? '註冊中...' : '建立帳號'}
          </button>
        </form>

        {/* Switch to Login */}
        <p className="text-center text-sm text-gray-500 mt-6">
          已經有帳號？{' '}
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-accent hover:text-accent-hover font-medium transition-colors"
          >
            登入
          </button>
        </p>
      </div>
    </div>
  );
};

export default RegisterPage;
