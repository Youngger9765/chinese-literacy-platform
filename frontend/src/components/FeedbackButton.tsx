/* eslint-disable no-use-before-define -- pre-existing pattern, not TDZ risk (#2289) */
import React, { useState, useRef, useEffect } from 'react';
import { submitFeedback, type FeedbackCategory } from '../services/feedbackApi';
import { useFocusTrap } from '../hooks/useFocusTrap';

const CATEGORY_OPTIONS: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: '問題回報' },
  { value: 'feature', label: '功能建議' },
  { value: 'question', label: '使用疑問' },
  { value: 'other', label: '其他' },
];

type ModalState = 'idle' | 'open' | 'submitting' | 'success' | 'error';

const FeedbackButton: React.FC = () => {
  const [modalState, setModalState] = useState<ModalState>('idle');
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showTooltip, setShowTooltip] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isOpen = modalState !== 'idle';

  // Focus trap — active when modal is open.
  useFocusTrap(dialogRef, isOpen);

  // Escape key closes the modal.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const openModal = () => {
    setCategory('bug');
    setTitle('');
    setDescription('');
    setErrorMessage('');
    setModalState('open');
  };

  const closeModal = () => {
    setModalState('idle');
    // Restore focus to the trigger button after a short delay to allow DOM update.
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setModalState('submitting');
    try {
      await submitFeedback({
        category,
        title: title.trim(),
        description: description.trim() || undefined,
        page_url: window.location.pathname,
      });
      setModalState('success');
      // Auto-close after 2 seconds
      setTimeout(() => {
        setModalState('idle');
      }, 2000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '提交失敗，請稍後再試');
      setModalState('error');
    }
  };

  const handleRetry = () => {
    setModalState('open');
    setErrorMessage('');
  };

  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-6 right-6 z-40">
        <div className="relative">
          {showTooltip && (
            <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg">
              回報問題
            </div>
          )}
          <button
            ref={triggerRef}
            onClick={openModal}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            className="w-12 h-12 bg-accent hover:bg-accent-hover text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
            aria-label="回報問題"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Modal overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          aria-modal="true"
          role="dialog"
          aria-labelledby="feedback-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            ref={dialogRef}
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
          >

            {/* Success state */}
            {modalState === 'success' && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="font-semibold text-gray-900">感謝您的回報！</p>
                <p className="text-sm text-gray-500">我們會盡快處理您的問題</p>
              </div>
            )}

            {/* Error state */}
            {modalState === 'error' && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
                  <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="font-semibold text-gray-900">提交失敗</p>
                <p className="text-sm text-red-500">{errorMessage}</p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleRetry}
                    className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors"
                  >
                    重試
                  </button>
                  <button
                    onClick={closeModal}
                    className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* Form state (open or submitting) */}
            {(modalState === 'open' || modalState === 'submitting') && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <h2 id="feedback-modal-title" className="text-lg font-bold text-gray-900">回報問題</h2>
                  <button
                    onClick={closeModal}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label="關閉"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Category */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      問題類型 <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                      disabled={modalState === 'submitting'}
                    >
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      標題 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="請簡短描述問題..."
                      maxLength={200}
                      required
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                      disabled={modalState === 'submitting'}
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      詳細說明
                      <span className="text-gray-400 text-xs ml-1">(選填)</span>
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="請描述問題的詳細情況、重現步驟等..."
                      rows={4}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-none"
                      disabled={modalState === 'submitting'}
                    />
                  </div>

                  {/* Page URL info */}
                  <p className="text-xs text-gray-400">
                    目前頁面：{window.location.pathname} (自動記錄)
                  </p>

                  {/* Buttons */}
                  <div className="flex gap-2 justify-end pt-1">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                      disabled={modalState === 'submitting'}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={!title.trim() || modalState === 'submitting'}
                      className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-gray-300 disabled:text-gray-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                    >
                      {modalState === 'submitting' && (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                      {modalState === 'submitting' ? '提交中...' : '送出回報'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default FeedbackButton;
