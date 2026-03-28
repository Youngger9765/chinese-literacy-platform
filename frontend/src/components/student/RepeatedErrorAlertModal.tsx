import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { RepeatedErrorAlertItem } from '../../services/progressApi';

interface Props {
  alerts: RepeatedErrorAlertItem[];
  onDismiss: () => void;
}

/**
 * RepeatedErrorAlertModal — Post-session modal shown when the student has
 * reached the ≥3 repeated-error threshold for one or more characters.
 *
 * Directs the student to the "我的生字" page for targeted vocab practice.
 * Issue #248: repeated error detection + vocabulary recommendation.
 */
const RepeatedErrorAlertModal: React.FC<Props> = ({ alerts, onDismiss }) => {
  const navigate = useNavigate();

  const handleGoToVocab = () => {
    onDismiss();
    navigate('/my-vocabulary');
  };

  const topAlerts = alerts.slice(0, 5);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="重複錯誤提醒"
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="text-3xl" aria-hidden="true">!</span>
          <div>
            <h2 className="text-lg font-bold text-gray-900">需要加強的生字</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              這些字你已讀錯 3 次以上，建議加強練習
            </p>
          </div>
        </div>

        {/* Character list */}
        <div className="flex flex-wrap gap-2">
          {topAlerts.map((item) => (
            <div
              key={item.character}
              className="flex flex-col items-center bg-red-50 border border-red-200 rounded-xl px-4 py-3"
            >
              <span className="text-3xl font-bold text-gray-900">{item.character}</span>
              <span className="text-xs text-red-600 mt-1 font-medium">
                錯 {item.error_count} 次
              </span>
            </div>
          ))}
          {alerts.length > 5 && (
            <div className="flex items-center justify-center bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <span className="text-sm text-gray-500">+{alerts.length - 5} 個字</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onDismiss}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            稍後練習
          </button>
          <button
            onClick={handleGoToVocab}
            className="px-4 py-2 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
          >
            立即練習生字
          </button>
        </div>
      </div>
    </div>
  );
};

export default RepeatedErrorAlertModal;
