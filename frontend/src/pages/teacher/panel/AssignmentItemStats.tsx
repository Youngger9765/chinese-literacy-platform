/**
 * 逐大題全班統計 (#3367)
 *
 * 老師回饋：每個作業要能橫向展開，看到每一大題是否完成、正確率、錯誤率。
 * 後端已依正確率由低到高排好，最弱的一項標紅，老師一眼知道全班卡在哪。
 */
import React from 'react';
import { AssignmentItemStatsResponse } from '../../../services/teacherApi';

interface AssignmentItemStatsProps {
  data: AssignmentItemStatsResponse;
}

const fmt = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);

const AssignmentItemStats: React.FC<AssignmentItemStatsProps> = ({ data }) => {
  if (data.submitted_count === 0) {
    return (
      <div className="rounded-xl border border-gray-200 p-5 text-gray-500">
        還沒有學生交這份作業，交了之後這裡會顯示每一大題的全班正確率
      </div>
    );
  }

  // Submitted, but none of the parts was recorded (older practice flow, or a
  // score-only submission). Saying "完成率 0%" would read as "nobody did it".
  if (data.items.every((i) => i.completed === 0)) {
    return (
      <div className="rounded-xl border border-gray-200 p-5 text-gray-600">
        已交 {data.submitted_count} 人，但這份作業沒有記錄到分項成績（朗讀、理解、生字）
      </div>
    );
  }

  const weakestKey = data.items.find((i) => i.correct_rate !== null)?.key;

  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <h3 className="text-base font-semibold text-gray-900">逐大題全班統計</h3>
      <p className="text-sm text-gray-500 mt-0.5 mb-4">
        {data.submitted_count} / {data.assigned_count} 人已交・完成率以全班計・依正確率由低到高排序
      </p>
      <ul className="space-y-1" aria-label="逐大題統計">
        {data.items.map((item) => {
          const weakest = item.key === weakestKey;
          return (
            <li
              key={item.key}
              data-weakest={weakest || undefined}
              className={`grid grid-cols-1 sm:grid-cols-[7rem_1fr_auto] items-center gap-2 sm:gap-4 rounded-lg px-3 py-2.5 ${weakest ? 'bg-red-50' : ''}`}
            >
              <span className={`font-semibold ${weakest ? 'text-red-700' : 'text-gray-800'}`}>
                {weakest && <span aria-hidden="true">⚠ </span>}
                {item.label}
              </span>
              <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${weakest ? 'bg-red-500' : 'bg-accent'}`}
                  style={{ width: `${item.correct_rate ?? 0}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-4 text-right text-sm tabular-nums">
                <span>
                  <span className="block font-medium text-gray-800">{item.completed}/{item.total}</span>
                  <span className="text-xs text-gray-500">完成率 {fmt(item.completion_rate)}</span>
                </span>
                <span>
                  <span className={`block font-medium ${weakest ? 'text-red-700' : 'text-gray-800'}`}>{fmt(item.correct_rate)}</span>
                  <span className="text-xs text-gray-500">正確率</span>
                </span>
                <span>
                  <span className={`block font-medium ${weakest ? 'text-red-700' : 'text-gray-800'}`}>{fmt(item.error_rate)}</span>
                  <span className="text-xs text-gray-500">錯誤率</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-400 mt-3">
        目前只到「大題」層級，逐題答錯哪個選項需要另外記錄作答資料，尚無此資料
      </p>
    </div>
  );
};

export default AssignmentItemStats;
