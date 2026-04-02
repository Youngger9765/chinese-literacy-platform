import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AuthError, resendVerification } from '../services/authApi';
import PasswordStrengthIndicator from '../components/PasswordStrengthIndicator';
import GoogleSignInButton from '../components/GoogleSignInButton';

interface RegisterPageProps {
  onSwitchToLogin?: () => void;
}

const RegisterPage: React.FC<RegisterPageProps> = ({ onSwitchToLogin }) => {
  const navigate = useNavigate();
  const { register, loginWithGoogle } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // State for post-registration email verification flow (issue #460)
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

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
    if (!/[a-zA-Z]/.test(password)) {
      return '密碼必須包含至少一個英文字母';
    }
    if (!/\d/.test(password)) {
      return '密碼必須包含至少一個數字';
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
      const result = await register(email.trim(), password, name.trim());
      // Registration successful — user must verify email before logging in (issue #460)
      setRegisteredEmail(email.trim());
      if (result.verification_token) {
        setDevToken(result.verification_token);
      }
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.status === 409 || err.message.includes('already')) {
          setError('此電子郵件已被註冊');
        } else if (err.status === 403 && err.message.includes('網域')) {
          // Issue #407: email domain not in school's allowed list
          setError(err.message);
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

  const handleResendVerification = async () => {
    if (!registeredEmail) return;
    setResendStatus(null);
    try {
      const result = await resendVerification(registeredEmail);
      if (result.verification_token) {
        setDevToken(result.verification_token);
      }
      setResendStatus('驗證信已重新發送。');
    } catch {
      setResendStatus('重新發送失敗，請稍後再試。');
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setError('');
    setIsSubmitting(true);
    try {
      const result = await loginWithGoogle(credential);
      if (result.isNewUser) {
        navigate('/', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
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

  // After successful registration, show email verification pending screen (issue #460)
  if (registeredEmail) {
    const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4">
              <span className="text-white font-black text-2xl">L</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">AI 朗讀助教</h1>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center space-y-4">
            <div className="text-4xl">📧</div>
            <h2 className="text-lg font-bold text-gray-900">請驗證您的 Email</h2>
            <p className="text-sm text-gray-600">
              註冊成功！請檢查 <span className="font-medium text-gray-900">{registeredEmail}</span> 的信箱並點擊驗證連結完成驗證。
            </p>

            {/* Dev/staging mode: show verification link directly */}
            {devToken && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-left">
                <p className="text-xs font-semibold text-amber-700 mb-1">測試模式 — 驗證連結</p>
                <a
                  href={`${apiBase}/api/auth/verify-email?token=${devToken}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 underline break-all"
                >
                  點擊此連結驗證 Email
                </a>
                <p className="text-xs text-amber-600 mt-1">（正式環境將寄送至您的信箱，此連結不會出現）</p>
              </div>
            )}

            {resendStatus && (
              <p className="text-sm text-green-600">{resendStatus}</p>
            )}

            <button
              type="button"
              onClick={handleResendVerification}
              className="w-full h-10 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              重新發送驗證信
            </button>

            <button
              type="button"
              onClick={() => onSwitchToLogin ? onSwitchToLogin() : navigate('/login')}
              className="w-full h-10 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-bold transition-colors"
            >
              前往登入
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (

    <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4">
            <span className="text-white font-black text-2xl">L</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">AI 朗讀助教</h1>
          <p className="text-gray-500 text-sm mt-1">教師註冊</p>
        </div>

        {/* Student notice */}
        <div className="bg-amber-100 border border-amber-300 text-amber-800 text-sm rounded-lg px-4 py-3 mb-2">
          學生帳號由老師在班級管理中建立，請聯繫你的老師取得帳號。
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
              placeholder="至少 8 個字元，包含英文字母與數字"
              className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            />
            <PasswordStrengthIndicator password={password} />
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

        {/* Google Sign-In */}
        <div className="mt-4">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-amber-50 text-gray-400">或</span>
            </div>
          </div>
          <div className="mt-4">
            <GoogleSignInButton onCredential={handleGoogleCredential} width={352} />
          </div>
        </div>

        {/* Switch to Login */}
        <p className="text-center text-sm text-gray-500 mt-6">
          已經有帳號？{' '}
          <button
            type="button"
            onClick={() => onSwitchToLogin ? onSwitchToLogin() : navigate('/login')}
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
