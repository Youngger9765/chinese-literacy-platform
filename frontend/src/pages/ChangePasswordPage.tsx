import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { changePassword, AuthError } from '../services/authApi';
import PasswordStrengthIndicator from '../components/PasswordStrengthIndicator';

const ChangePasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const { token, mustChangePassword, loginPassword, clearMustChangePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If user arrived here without must_change_password flag, redirect to home
  if (!mustChangePassword || !token || !loginPassword) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-gray-500 text-sm mb-4">無需變更密碼</p>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="text-accent hover:text-accent-hover font-medium text-sm transition-colors"
          >
            回到首頁
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newPassword || !confirmPassword) {
      setError('請填寫所有欄位');
      return;
    }

    if (newPassword.length < 8) {
      setError('新密碼至少需要 8 個字元');
      return;
    }

    if (!/[a-zA-Z]/.test(newPassword)) {
      setError('新密碼必須包含至少一個英文字母');
      return;
    }

    if (!/\d/.test(newPassword)) {
      setError('新密碼必須包含至少一個數字');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('兩次輸入的密碼不一致');
      return;
    }

    if (newPassword === loginPassword) {
      setError('新密碼不能與舊密碼相同');
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(loginPassword, newPassword, token);
      clearMustChangePassword();
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof AuthError) {
        setError(err.message);
      } else {
        setError('密碼變更失敗，請稍後再試');
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
          <h1 className="text-2xl font-black text-gray-900">首次登入</h1>
          <p className="text-gray-500 text-sm mt-1">請設定新密碼</p>
        </div>

        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4"
        >
          {/* Info */}
          <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-4 py-3">
            為了帳號安全，首次登入需要設定新密碼。
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* New Password */}
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
              新密碼
            </label>
            <input
              id="new-password"
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
            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
              確認新密碼
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再輸入一次新密碼"
              className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
          >
            {isSubmitting ? '設定中...' : '設定新密碼'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordPage;
