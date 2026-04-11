/**
 * NoTeacherPage — shown to students who have not yet joined any classroom.
 *
 * Issue #457: students without a classroom cannot access learning features.
 * This page explains the situation in a friendly way and lets them:
 *  1. Enter a classroom join code (if they have one from their teacher).
 *  2. Log out and wait for their teacher to add them.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { joinClassroomByCode, ClassroomApiError } from '../../services/classroomApi';

const NoTeacherPage: React.FC = () => {
  const { token, logout, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setJoinCode(val);
    setError('');
  };

  const handleJoin = async (e: React.FormEvent) => {
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
      setSuccess(`成功加入「${result.classroom_name}」！`);
      // Refresh user profile so hasClassroom updates, then navigate home
      await refreshUser();
      setTimeout(() => navigate('/'), 1500);
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
    <div className="min-h-screen flex items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-md">
        {/* Illustration area */}
        <div className="text-center mb-8">
          <div
            className="w-24 h-24 mx-auto mb-6 rounded-full bg-purple-100 flex items-center justify-center"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-12 h-12 text-purple-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4-4a4 4 0 100-8 4 4 0 000 8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">還沒加入班級</h1>
          <p className="text-gray-600 leading-relaxed">
            你的帳號還沒有被加入任何班級
            <br />
            請聯繫你的老師，請老師把你加入班級
          </p>
        </div>

        {/* Join by code card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-4">
          <h2 className="text-base font-semibold text-gray-800 mb-1">有加入代碼？</h2>
          <p className="text-sm text-gray-500 mb-4">如果老師給了你 6 碼代碼，可以在這裡輸入</p>

          <form onSubmit={handleJoin} noValidate>
            <div className="mb-3">
              <label htmlFor="join-code" className="block text-sm font-medium text-gray-700 mb-1">
                班級代碼
              </label>
              <input
                id="join-code"
                type="text"
                value={joinCode}
                onChange={handleCodeChange}
                placeholder="例如：AB1234"
                maxLength={6}
                autoComplete="off"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-center text-lg font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent transition"
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-600 mb-3">
                {error}
              </p>
            )}
            {success && (
              <p role="status" className="text-sm text-green-600 mb-3">
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting || joinCode.length !== 6}
              className="w-full py-2.5 rounded-lg bg-purple-600 text-white font-medium text-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isSubmitting ? '加入中...' : '加入班級'}
            </button>
          </form>
        </div>

        {/* Logout */}
        <p className="text-center text-sm text-gray-500">
          帳號不對？{' '}
          <button
            type="button"
            onClick={logout}
            className="text-purple-600 hover:text-purple-700 underline underline-offset-2 focus:outline-none"
          >
            登出
          </button>
        </p>
      </div>
    </div>
  );
};

export default NoTeacherPage;
