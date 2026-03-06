import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { joinClassroomByCode, ClassroomApiError } from '../services/classroomApi';

const JoinClassroomPage: React.FC = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect to home after successful join
  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => navigate('/'), 2000);
    return () => clearTimeout(timer);
  }, [successMessage, navigate]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Auto-uppercase, max 6 characters, alphanumeric only
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setJoinCode(val);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (joinCode.length !== 6) {
      setError('請輸入完整的 6 碼加入代碼');
      return;
    }

    if (!token) {
      setError('請先登入');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await joinClassroomByCode(token, joinCode);
      setSuccessMessage(`成功加入「${result.classroom_name}」！`);
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        if (err.status === 404) {
          setError('找不到此加入代碼，請確認代碼是否正確');
        } else if (err.status === 409) {
          setError('你已經加入這個班級了');
        } else if (err.status === 400) {
          setError(err.message || '加入代碼無效');
        } else {
          setError(err.message || '加入失敗，請稍後再試');
        }
      } else {
        setError('加入失敗，請稍後再試');
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
          <h1 className="text-2xl font-black text-gray-900">加入班級</h1>
          <p className="text-gray-500 text-sm mt-1">輸入老師提供的加入代碼</p>
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

          {/* Success Message */}
          {successMessage && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
              {successMessage}
              <p className="text-xs text-green-600 mt-1">2 秒後自動返回首頁...</p>
            </div>
          )}

          {/* Join Code Input */}
          {!successMessage && (
            <div>
              <label htmlFor="join-code" className="block text-sm font-medium text-gray-700 mb-1">
                加入代碼
              </label>
              <input
                id="join-code"
                type="text"
                value={joinCode}
                onChange={handleCodeChange}
                placeholder="輸入 6 碼加入代碼"
                autoComplete="off"
                autoFocus
                className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
              <p className="text-xs text-gray-400 mt-1">由英文字母與數字組成，共 6 碼</p>
            </div>
          )}

          {/* Submit */}
          {!successMessage && (
            <button
              type="submit"
              disabled={isSubmitting || joinCode.length !== 6}
              className="w-full h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
            >
              {isSubmitting ? '加入中...' : '加入班級'}
            </button>
          )}
        </form>

        {/* Back link */}
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

export default JoinClassroomPage;
