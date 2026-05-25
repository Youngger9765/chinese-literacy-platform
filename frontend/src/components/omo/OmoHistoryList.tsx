/**
 * OmoHistoryList — presentational card list for OMO upload history (#1975).
 *
 * Stateless: receives the items + click handler from a parent that owns
 * fetching, pagination, and routing. Keeps this component testable in
 * isolation and reusable in dashboards later.
 */
import React from 'react';
import type { OmoHistoryItem } from '../../services/omoApi';

interface OmoHistoryListProps {
  items: OmoHistoryItem[];
  onSelect: (uploadId: number) => void;
}

function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return '—';
  return `${Math.round(score * 100)} 分`;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '剛剛';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小時前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} 天前`;
  // > 1 week: show absolute date
  return new Date(iso).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'graded':
      return { label: '已批改', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'grading':
      return { label: '批改中', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
    case 'identified':
      return { label: '待確認', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    default:
      return { label: status, cls: 'bg-gray-50 text-gray-600 border-gray-200' };
  }
}

const HistoryCard: React.FC<{
  item: OmoHistoryItem;
  onClick: () => void;
}> = ({ item, onClick }) => {
  const badge = statusBadge(item.status);
  const title = item.lesson_title || '（尚未辨識課程名稱）';

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-stretch gap-3 p-3 bg-white rounded-2xl border border-gray-200 shadow-sm
        hover:bg-gray-50 active:bg-gray-100
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
        transition-colors text-left"
    >
      {/* Thumbnail (or 📄 placeholder) */}
      <div className="shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center">
        {item.thumbnail_url ? (
          <img
            src={item.thumbnail_url}
            alt={`${title} 縮圖`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-3xl" aria-hidden="true">📄</span>
        )}
      </div>

      {/* Right: title + meta */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 min-w-0">
          {item.grade_code && (
            <span className="shrink-0 text-[11px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
              {item.grade_code}
            </span>
          )}
          <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${badge.cls}`}
          >
            {badge.label}
          </span>
          <span className="text-xs text-gray-500">{formatScore(item.overall_score)}</span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-500">共 {item.answers_count} 題</span>
        </div>
        <p className="text-xs text-gray-400" title={item.created_at}>
          {formatRelativeTime(item.created_at)}
        </p>
      </div>
    </button>
  );
};

const OmoHistoryList: React.FC<OmoHistoryListProps> = ({ items, onSelect }) => {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <div className="text-5xl" aria-hidden="true">🗂️</div>
        <p className="text-sm text-gray-600">還沒有任何批改記錄</p>
        <p className="text-xs text-gray-400">上傳學習單後，批改完成的紀錄會出現在這裡</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <HistoryCard
          key={item.upload_id}
          item={item}
          onClick={() => onSelect(item.upload_id)}
        />
      ))}
    </div>
  );
};

export default OmoHistoryList;
