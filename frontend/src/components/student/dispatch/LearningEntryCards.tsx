/**
 * LearningEntryCards — 「這次想怎麼練」兩張並排入口卡（#4163）
 *
 * - AI 派發：系統每次給 2 課擇 1（見 DispatchPicker）
 * - 自主練習：進圖書館自己挑課
 * 老師指派的作業另放一條提醒列在兩張卡上方，不混進這兩種模式。
 * 首頁與課文清單頂端共用。
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DispatchPicker from './DispatchPicker';

interface Props {
  /** 老師指派、還沒完成的作業數；0 不顯示提醒列 */
  pendingAssignments?: number;
  /** 課文清單頁已經在圖書館，「自主練習」改成捲到清單，不再跳頁 */
  onPickSelf?: () => void;
}

const cardClass = 'rounded-2xl border border-[#E5E0D5] bg-surface-container-lowest p-5 flex flex-col gap-2';

const LearningEntryCards: React.FC<Props> = ({ pendingAssignments = 0, onPickSelf }) => {
  const navigate = useNavigate();
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <section aria-label="這次想怎麼練" data-testid="learning-entry" className="space-y-3">
      {pendingAssignments > 0 && (
        <button
          type="button"
          data-testid="assignment-reminder"
          onClick={() => navigate('/assignments')}
          className="w-full text-left rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex items-center justify-between gap-3 hover:bg-amber-100"
        >
          <span>老師指派的作業還有 <strong>{pendingAssignments}</strong> 個沒完成，先做作業</span>
          <span className="font-bold shrink-0">去做作業</span>
        </button>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div className={cardClass} data-testid="entry-ai">
          <h3 className="font-headline font-bold text-lg text-on-surface">AI 派發</h3>
          <p className="text-sm text-on-surface-variant">
            AI 看你的年級和最近的練習，每次挑 2 課讓你選 1 課。做完會告訴你哪裡答得好、哪裡要再練，還能再派下一組
          </p>
          <button
            type="button"
            onClick={() => setAiOpen((o) => !o)}
            aria-expanded={aiOpen}
            className="mt-auto h-11 rounded-full bg-accent text-white font-bold hover:bg-accent-hover"
          >
            {aiOpen ? '收起' : '讓 AI 派一課'}
          </button>
        </div>

        <div className={cardClass} data-testid="entry-self">
          <h3 className="font-headline font-bold text-lg text-on-surface">自主練習</h3>
          <p className="text-sm text-on-surface-variant">
            自己到圖書館挑想讀的課，想練哪課就練哪課。每一關做完馬上看到對錯，全部做完有成績單
          </p>
          <button
            type="button"
            onClick={() => (onPickSelf ? onPickSelf() : navigate('/library'))}
            className="mt-auto h-11 rounded-full border-2 border-accent text-accent font-bold hover:bg-accent-bg"
          >
            自己挑課
          </button>
        </div>
      </div>

      {aiOpen && <DispatchPicker />}
    </section>
  );
};

export default LearningEntryCards;
