import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { forgotPassword, resetPassword, AuthError } from '../services/authApi';
import PasswordStrengthIndicator from '../components/PasswordStrengthIndicator';

type Step = 'request' | 'reset' | 'done';

const ForgotPassword: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // If URL includes ?token=..., skip straight to reset step
  const tokenFromUrl = searchParams.get('token') ?? '';
  const [step, setStep] = useState<Step>(tokenFromUrl ? 'reset' : 'request');

  // Step 1: request
  const [identifier, setIdentifier] = useState('');
  const [requestError, setRequestError] = useState('');
  const [isRequestSubmitting, setIsRequestSubmitting] = useState(false);
  // P0: token shown in UI for testing
  const [returnedToken, setReturnedToken] = useState('');

  // Step 2: reset
  const [resetToken, setResetToken] = useState(tokenFromUrl);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [isResetSubmitting, setIsResetSubmitting] = useState(false);

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestError('');

    if (!identifier.trim()) {
      setRequestError('請輸入電子郵件或使用者名稱');
      return;
    }

    setIsRequestSubmitting(true);
    try {
      const resp = await forgotPassword(identifier.trim());
      // P0: show the token so the flow can be completed without email
      setReturnedToken(resp.reset_token);
      setResetToken(resp.reset_token);
      setStep('reset');
    } catch (err) {
      if (err instanceof AuthError) {
        setRequestError(err.message);
      } else {
        setRequestError('請求失敗，請稍後再試');
      }
    } finally {
      setIsRequestSubmitting(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');

    if (!newPassword || !confirmPassword) {
      setResetError('請填寫所有欄位');
      return;
    }

    if (newPassword.length < 8) {
      setResetError('密碼至少需要 8 個字元');
      return;
    }

    if (!/[a-zA-Z]/.test(newPassword)) {
      setResetError('密碼必須包含至少一個英文字母');
      return;
    }

    if (!/\d/.test(newPassword)) {
      setResetError('密碼必須包含至少一個數字');
      return;
    }

    if (newPassword !== confirmPassword) {
      setResetError('兩次輸入的密碼不一致');
      return;
    }

    setIsResetSubmitting(true);
    try {
      await resetPassword(resetToken, newPassword);
      setStep('done');
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.status === 400) {
          setResetError('重設連結無效或已過期，請重新申請。');
        } else if (err.status === 422) {
          setResetError(err.message);
        } else {
          setResetError(err.message);
        }
      } else {
        setResetError('密碼重設失敗，請稍後再試');
      }
    } finally {
      setIsResetSubmitting(false);
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
          <p className="text-gray-500 text-sm mt-1">
            {step === 'request' && '重設密碼'}
            {step === 'reset' && '設定新密碼'}
            {step === 'done' && '密碼已重設'}
          </p>
        </div>

        {/* Step 1: Request token */}
        {step === 'request' && (
          <form
            onSubmit={handleRequestSubmit}
            className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4"
          >
            <p className="text-sm text-gray-600">
              輸入您的電子郵件或使用者名稱，我們將為您產生重設連結。
            </p>

            {requestError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {requestError}
              </div>
            )}

            <div>
              <label htmlFor="fp-identifier" className="block text-sm font-medium text-gray-700 mb-1">
                電子郵件或使用者名稱
              </label>
              <input
                id="fp-identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="email@example.com 或 username"
                className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={isRequestSubmitting}
              className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
            >
              {isRequestSubmitting ? '處理中...' : '取得重設連結'}
            </button>
          </form>
        )}

        {/* Step 2: Enter new password */}
        {step === 'reset' && (
          <form
            onSubmit={handleResetSubmit}
            className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4"
          >
            {/* P0 notice: show token for testing */}
            {returnedToken && returnedToken !== 'account-not-found' && (
              <div className="bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded-lg px-3 py-2 break-all">
                <span className="font-semibold">測試模式 Token：</span> {returnedToken}
                <br />
                <span className="text-blue-500 mt-1 block">（正式環境此 token 將寄送至 Email）</span>
              </div>
            )}

            {resetError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {resetError}
              </div>
            )}

            {/* Token input (editable in case URL param is used or user wants to paste) */}
            <div>
              <label htmlFor="fp-token" className="block text-sm font-medium text-gray-700 mb-1">
                重設 Token
              </label>
              <input
                id="fp-token"
                type="text"
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                placeholder="貼上重設 token"
                className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors font-mono text-xs"
              />
            </div>

            {/* New Password */}
            <div>
              <label htmlFor="fp-new-password" className="block text-sm font-medium text-gray-700 mb-1">
                新密碼
              </label>
              <input
                id="fp-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 8 個字元，包含英文字母與數字"
                className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
              <PasswordStrengthIndicator password={newPassword} />
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="fp-confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                確認新密碼
              </label>
              <input
                id="fp-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再輸入一次新密碼"
                className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={isResetSubmitting}
              className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
            >
              {isResetSubmitting ? '重設中...' : '重設密碼'}
            </button>

            <button
              type="button"
              onClick={() => { setStep('request'); setResetToken(''); }}
              className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors text-center"
            >
              重新申請重設連結
            </button>
          </form>
        )}

        {/* Step 3: Done */}
        {step === 'done' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4 text-center">
            <div className="text-green-500 text-4xl">✓</div>
            <p className="text-gray-700 font-medium">密碼已成功重設！</p>
            <p className="text-gray-500 text-sm">請使用新密碼登入。</p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="w-full h-11 bg-accent hover:bg-accent-hover text-white rounded-lg font-bold text-sm transition-colors"
            >
              前往登入
            </button>
          </div>
        )}

        {/* Back to login */}
        {step !== 'done' && (
          <p className="text-center text-sm text-gray-500 mt-6">
            想起密碼了？{' '}
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="text-accent hover:text-accent-hover font-medium transition-colors"
            >
              返回登入
            </button>
          </p>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
