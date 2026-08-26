import React from 'react';

/**
 * 「現在念的是系統語音，不是 AI 朗讀」——降級提示（#2609 / #2930）。
 *
 * 後端連不上時朗讀會降到瀏覽器內建語音。那不是失敗（聲音照樣出來），
 * 所以不該顯示錯誤與重試，而該告訴人「你現在聽到的不是 AI 的聲音」。
 *
 * 抽成共用元件是因為它原本只寫在念順順裡，讀全文完全沒有 ——
 * 擁有者在讀全文聽到機器音，畫面上一句話都沒說。
 * 兩份各自維護遲早會再分岔一次。
 */
const TtsDegradedNotice: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={className}>
    <div
      role="status"
      className="flex items-start gap-3 px-5 py-4 rounded-2xl bg-amber-50 border border-amber-300 shadow-md"
    >
      <span className="material-symbols-outlined text-amber-600 shrink-0 mt-0.5">warning</span>
      <div className="flex-1">
        <p className="text-base font-bold text-amber-800">現在念的是系統語音，不是 AI 朗讀</p>
        <p className="text-sm text-amber-700 mt-0.5">
          AI 朗讀暫時連不上，先用手機或電腦內建的語音幫你唸，聲音可能比較機械。等一下可以再按一次試試看。
        </p>
      </div>
    </div>
  </div>
);

export default TtsDegradedNotice;
