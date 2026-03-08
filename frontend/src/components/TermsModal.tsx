/**
 * TermsModal — shown when a user has not yet accepted the Terms of Service.
 *
 * The user must check all four agreement items and click the confirm button
 * before they can access the platform. The modal cannot be dismissed without
 * accepting.
 */

import React, { useState } from 'react';

interface TermsModalProps {
  /** Called after the user successfully accepts terms (API call already done). */
  onAccepted: () => void;
  /** Called to perform the API accept-terms request. */
  onAccept: () => Promise<void>;
}

const AGREEMENT_ITEMS = [
  '我確認建立的班級及學生確實與實體教學一致',
  '我確認上傳的課文來自學校合法採購的教科書',
  '我確認未使用任何未經授權的課文',
  '我同意系統在學期結束後一週自動刪除課文文本',
];

const TermsModal: React.FC<TermsModalProps> = ({ onAccepted, onAccept }) => {
  const [checked, setChecked] = useState<boolean[]>(
    new Array(AGREEMENT_ITEMS.length).fill(false),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = checked.every(Boolean);

  const toggleItem = (index: number) => {
    setChecked((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!allChecked || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onAccept();
      onAccepted();
    } catch {
      setError('同意使用條款時發生錯誤，請稍後再試。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    /* Backdrop — non-dismissable (no onClick on backdrop) */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">使用條款同意書</h2>
          <p className="mt-1 text-sm text-gray-500">
            請閱讀並勾選以下所有同意事項，方可使用本平台。
          </p>
        </div>

        {/* Terms content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Legal preamble */}
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900 leading-relaxed">
            <p className="font-semibold mb-2">著作權保護聲明</p>
            <p>
              本平台提供之 AI 輔助閱讀功能僅供合法授權之教學使用。為保護著作權並確保教學資源的合法性，
              使用本平台前請確認您已充分理解並同意下列事項。
            </p>
          </div>

          {/* Agreement checkboxes */}
          <div className="space-y-3">
            {AGREEMENT_ITEMS.map((item, index) => (
              <label
                key={index}
                className="flex items-start gap-3 cursor-pointer group"
              >
                <div className="mt-0.5 flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={checked[index]}
                    onChange={() => toggleItem(index)}
                    className="w-4 h-4 rounded border-gray-300 text-accent accent-amber-500 cursor-pointer"
                  />
                </div>
                <span className="text-sm text-gray-700 leading-relaxed group-hover:text-gray-900">
                  {item}
                </span>
              </label>
            ))}
          </div>

          {/* Version notice */}
          <p className="text-xs text-gray-400 pt-2">
            使用條款版本：1.0 &nbsp;|&nbsp; 生效日期：2026-01-01
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-4 border-t border-gray-100">
          {error && (
            <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button
            onClick={handleConfirm}
            disabled={!allChecked || isSubmitting}
            className="w-full py-3 rounded-xl font-bold text-white transition-all
              bg-amber-500 hover:bg-amber-600
              disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {isSubmitting ? '處理中...' : '我同意使用條款，進入平台'}
          </button>
          {!allChecked && (
            <p className="mt-2 text-xs text-center text-gray-400">
              請勾選所有同意事項後方可繼續
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TermsModal;
