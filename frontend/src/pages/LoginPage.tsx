import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AuthError } from '../services/authApi';
import { trackEvent } from '../utils/analytics';
import GoogleSignInButton from '../components/GoogleSignInButton';
import { buildJunyiLoginUrl, isSsoSupported } from './JunyiCallbackPage';

interface LoginPageProps {
  onSwitchToRegister?: () => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onSwitchToRegister }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';
  const { login, loginWithGoogle } = useAuth();

  const handleJunyiLogin = () => {
    trackEvent('auth', 'junyi_login_initiated');
    window.location.href = buildJunyiLoginUrl(from);
  };
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
      const result = await login(email.trim(), password);
      trackEvent('auth', 'login_success');
      if (result.mustChangePassword) {
        navigate('/change-password', { replace: true });
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.status === 401) {
          setError('帳號或密碼錯誤');
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

  const handleGoogleCredential = async (credential: string) => {
    setError('');
    setIsSubmitting(true);
    try {
      await loginWithGoogle(credential);
      trackEvent('auth', 'google_login_success');
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof AuthError) {
        setError(err.message);
      } else {
        setError('Google 登入失敗，請稍後再試');
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
          <h1 className="text-2xl font-bold text-gray-900">AI 朗讀助教</h1>
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

          {/* Account (Email or Username) */}
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">
              帳號 (Email 或使用者名稱)
            </label>
            <input
              id="login-email"
              type="text"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com 或 ABC1231"
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

          {/* Forgot Password link */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => navigate('/forgot-password')}
              className="text-xs text-gray-400 hover:text-accent transition-colors"
            >
              忘記密碼？
            </button>
          </div>
        </form>

        {/* Third-party sign-in options */}
        <div className="mt-4 space-y-3">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-amber-50 text-gray-400">或</span>
            </div>
          </div>

          {/* Google Sign-In */}
          <div>
            <GoogleSignInButton onCredential={handleGoogleCredential} width={352} />
          </div>

          {/* Junyi SSO (issue #1198) — only shown on whitelisted hosts where callback works */}
          {isSsoSupported() && (
            <button
              type="button"
              onClick={handleJunyiLogin}
              className="w-full h-11 flex items-center justify-center gap-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <img src="/junyi-logo.png" alt="均一" className="h-5 w-auto" />
              使用均一帳號登入
            </button>
          )}
        </div>

        {/* Switch to Register */}
        <p className="text-center text-sm text-gray-500 mt-6">
          還沒有帳號？{' '}
          <button
            type="button"
            onClick={() => onSwitchToRegister ? onSwitchToRegister() : navigate('/register')}
            className="text-accent hover:text-accent-hover font-medium transition-colors"
          >
            註冊帳號
          </button>
        </p>

        {/* Quick login buttons — only shown in non-production environments */}
        {import.meta.env.VITE_SHOW_DEMO_LOGIN !== 'false' && (
          <div className="mt-8 border-t border-gray-200 pt-6">
            <p className="text-xs text-gray-400 text-center mb-3">快速登入（測試用）</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { label: '管理員', desc: '王管理員', email: import.meta.env.VITE_DEMO_ADMIN_EMAIL ?? '', pw: import.meta.env.VITE_DEMO_ADMIN_PW ?? '', color: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' },
                { label: '教師', desc: '李老師', email: import.meta.env.VITE_DEMO_TEACHER_EMAIL ?? '', pw: import.meta.env.VITE_DEMO_TEACHER_PW ?? '', color: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' },
                { label: '學生', desc: '小明', email: import.meta.env.VITE_DEMO_STUDENT_EMAIL ?? '', pw: import.meta.env.VITE_DEMO_STUDENT_PW ?? '', color: 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100' },
              ] as const).map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  disabled={isSubmitting}
                  onClick={async () => {
                    setError('');
                    setIsSubmitting(true);
                    try {
                      const result = await login(acc.email, acc.pw);
                      if (result.mustChangePassword) {
                        navigate('/change-password', { replace: true });
                      } else {
                        navigate(from, { replace: true });
                      }
                    } catch (err) {
                      if (err instanceof AuthError) {
                        setError(err.message);
                      } else {
                        setError('登入失敗');
                      }
                      setIsSubmitting(false);
                    }
                  }}
                  className={`border rounded-lg px-2 py-2.5 text-center transition-colors cursor-pointer disabled:opacity-50 ${acc.color}`}
                >
                  <div className="text-xs font-bold">{acc.label}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{acc.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
