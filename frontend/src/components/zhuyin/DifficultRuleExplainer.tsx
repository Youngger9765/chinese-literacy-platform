/**
 * DifficultRuleExplainer — 把「難字是怎麼判定的」講給人聽（#3257）
 *
 * ## 為什麼要有這個東西
 *
 * 難字模式的判定法對使用者是**隱形的**：學生看到某個字有注音，不知道為什麼；
 * 家長看到「很簡單的字也標了」，會以為是 bug。
 *
 * 那個資訊落差本身就是誤判的來源，而且已經害過一次 —— #3247 的起點是家長在四年級
 * 課文上看到標了「之 加 千 同 大 失 小 手 成」，判定判定法壞了。實際上那是走到
 * 第三層（生詞拆字）的正常結果。規則如果講清楚，那次誤判不會發生。
 *
 * ## 三個設計判斷
 *
 * ① **放在控制項旁邊，不做逐字 tooltip**
 *    規則說明該住在「改變規則的那個控制項」旁邊 —— 會去調門檻的就是想知道它是什麼
 *    意思的人。逐字 tooltip 資訊量最大，但它跟「讀」搶注意力，而這是閱讀產品；
 *    而且平板沒有 hover，小朋友多半在平板上。學生要的具體資訊改用**面板裡的字表**
 *    給，課文畫面一個字都不動。
 *
 * ② **收合預設關閉**
 *    關著的時候寬度成本是一顆 icon。這個開關同時出現在沉浸模式的頂欄與手機側欄，
 *    兩邊寬度都是稀缺的（門檻控制項當初就是為此才做成只在難字模式出現）。
 *
 * ③ **一個面板同時服務學生與家長**
 *    兩者問的是同三件事（哪一層生效／那層什麼意思／它的限制），差別只在深度：
 *    學生要具體（我的字、錯幾次），家長要抽象（規則可不可信）。所以順序是
 *    **具體 → 規則 → 限制**，前面服務學生、後面服務家長，而不是拆成兩個畫面
 *    （拆開的話家長永遠找不到他那一份）。
 *
 * ## ⛔ 限制一律寫出來，不隱藏
 *
 * 這是信任的核心，也是這張票的重點之一。三個限制都是真的：
 *   - 語音辨識對小孩發音會誤判 → 清單裡會有**假的**錯字
 *   - **跳過沒唸的字永遠不會進清單**，不管多難（這條最反直覺）
 *   - 「少見」是按這套教材的課文算的，不是中文常用字頻 → 生活常用字可能被標
 *     （四年級是這套教材的地板，`generate_char_difficulty.py` 檔頭有完整說明）
 *
 * ⛔ 尤其不可以隱藏第三層（生詞）那段 —— 它正是被誤判成 bug 的那個狀態。
 *    把唯一會產生困惑輸出的那一層藏起來，等於這個面板白做。
 *
 * ## ⛔ 層級判定不在這裡
 *
 * `source` 由 `ZhuyinContext` 的 `resolveDifficultSource` 給，這個元件只負責描述。
 * 在這裡重判一次就會變成同一條規則有兩份實作 —— 那正是 #3218 付過大代價的形狀。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useZhuyin, THRESHOLD_MIN } from '../../context/ZhuyinContext';
import type { DifficultExplain } from '../../context/ZhuyinContext';

/** 把 ISO 日期寫成「8/24」。拿不到或壞掉就回 null（不顯示，不要印 Invalid Date） */
export function formatErrorDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 這一層叫什麼、一句話是什麼意思 */
function layerCopy(explain: DifficultExplain, threshold: number) {
  if (explain.source === 'errors') {
    return {
      badge: '你唸錯過的字',
      lead: '這些是你朗讀的時候唸錯過的字',
      rule: `你朗讀時唸錯 ${threshold} 次以上的字就會標注音，後來唸對了就不再標`,
      note:
        threshold > THRESHOLD_MIN
          ? `現在設 ${threshold} 次 —— 按「−」會標更多字`
          : '現在設 1 次，錯一次就標 —— 按「＋」會標更少字',
    };
  }
  if (explain.source === 'grade') {
    return {
      badge: '這一課比較少見的字',
      lead: '你在這一課還沒有唸錯紀錄，所以先按課文的難度標',
      rule: '取這一課裡對你這個年級最少見的字，一課大約 3%',
      note: '等你唸過、有了唸錯紀錄，就會換成你自己的字',
    };
  }
  // 'vocab'：兩種完全不同的情況，不可以混在一起講
  if (!explain.lessonLoaded) {
    return {
      badge: '還沒進到課文',
      lead: '進到課文之後，這裡會說明這一課標了哪些字、為什麼',
      rule: '判定的順序是：你唸錯過的字 → 這一課少見的字 → 本課生詞',
      note: null as string | null,
    };
  }
  return {
    badge: '本課生詞裡的字',
    lead: '這一課還沒算出難字，暫時用生詞清單代替',
    rule: '生詞是「這一課要教什麼」，不是「你還不會什麼」—— 所以可能標到你早就會的字',
    note: null as string | null,
  };
}

export default function DifficultRuleExplainer() {
  const { difficultExplain, difficultThreshold } = useZhuyin();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Escape 關閉，並把焦點還給觸發的按鈕（否則鍵盤使用者會掉在頁面開頭）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // 點外面關閉。⛔ 兩個「不算外面」的例外：
  //   ① trigger 本身 —— 否則點 trigger 會先被這裡關掉、再被 onClick 開起來，
  //      變成永遠關不掉
  //   ② 整個 `[data-zhuyin-controls]` 控制群（門檻的 −／＋）—— 面板正在解釋門檻，
  //      按一下就把解釋關掉是反效果。留著不關，調數字時面板上那排字會當場變多變少，
  //      規則變成看得到的東西而不只是一句話
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest('[data-zhuyin-controls]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const copy = layerCopy(difficultExplain, difficultThreshold);
  const dates = difficultExplain.errors.map((e) => formatErrorDate(e.lastDate));

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="這些字為什麼有注音"
        title="這些字為什麼有注音"
        className="h-8 sm:h-9 w-8 sm:w-9 inline-flex items-center justify-center rounded-full bg-surface-container-high font-headline font-bold text-sm text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 active:scale-95 transition-all duration-200"
      >
        ？
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="難字的判定方式"
          className="absolute right-0 top-full mt-2 z-50 w-[20rem] max-w-[calc(100vw-2rem)] rounded-2xl bg-surface-container-lowest p-4 text-left shadow-card ring-1 ring-black/5 font-body"
        >
          <p className="font-headline font-bold text-sm text-on-surface">
            為什麼這些字有注音
          </p>

          {/* ① 具體 —— 先給學生他自己的字 */}
          <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
            現在標的是
            <span className="mx-1 inline-block rounded-full bg-accent-bg px-2 py-0.5 font-bold text-accent">
              {copy.badge}
            </span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{copy.lead}</p>

          {difficultExplain.source === 'errors' && difficultExplain.errors.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="你唸錯過的字">
              {difficultExplain.errors.map((e, i) => (
                <li
                  key={e.char}
                  className="inline-flex items-baseline gap-1 rounded-lg bg-surface-container-low px-2 py-1 text-xs text-on-surface-variant"
                >
                  <span className="font-bold text-base text-on-surface">{e.char}</span>
                  <span className="tabular-nums">
                    錯 {e.count} 次{dates[i] ? ` · ${dates[i]}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {difficultExplain.source === 'grade' && difficultExplain.chars.length > 0 && (
            <p
              className="mt-2 rounded-lg bg-surface-container-low px-2 py-1.5 text-base font-bold tracking-widest text-on-surface"
              aria-label="這一課標的字"
            >
              {difficultExplain.chars.join(' ')}
            </p>
          )}

          {/* ② 規則 —— 家長要的那一段從這裡開始 */}
          <p className="mt-3 font-headline font-bold text-xs text-on-surface">怎麼判定的</p>
          <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{copy.rule}</p>
          {copy.note && (
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{copy.note}</p>
          )}

          {/* ③ 限制 —— ⛔ 不隱藏，這是信任的核心 */}
          <p className="mt-3 font-headline font-bold text-xs text-on-surface">會標不準的地方</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-on-surface-variant">
            <li>語音辨識可能聽錯小朋友的發音，所以有些你其實會的字也會被標</li>
            <li>你跳過沒唸出來的字不會進清單，不管那個字多難</li>
            {difficultExplain.source === 'grade' && (
              <li>
                「少見」是按這套教材的課文算的，不是一般中文常用字 —— 所以像「休 玉 拍 棒」
                這種生活裡常用的字也可能被標
              </li>
            )}
          </ul>
        </div>
      )}
    </span>
  );
}
