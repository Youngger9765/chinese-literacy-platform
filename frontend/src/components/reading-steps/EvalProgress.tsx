import { useEffect, useRef, useState } from 'react';

/**
 * EvalProgress — 共用評估進度指示器（逐段朗讀 + 全文朗讀共用，#2396）
 *
 * 解掉舊版假掃描進度（EVAL_STEPS 固定 minMs 步驟）的兩個毛病：
 *   - 快完成 → 動畫沒播完被硬中斷（尷尬）
 *   - >20s → 卡死在最後一步發呆
 *
 * 機制：
 *   1. duration 動態 — 用實際錄音長度估預期評估時間 expectedMs = BASE + K×recordingMs
 *      （短錄音→快、長錄音→慢，自動貼合）
 *   2. 緩動漸近 — 進度條用 1-e^(-t/τ) 逼近 TARGET(92%)，自己永遠跑不完 → 不卡死、永遠在動
 *   3. snap — active 轉 false（真結果到）→ 衝 100% + 閃「完成」再收掉 → 不管快慢都平滑收尾
 *
 * K / BASE 是第一版估值，可從真實 telemetry（評估秒數 / 錄音秒數）再校準；
 * 漸近 + snap 設計讓估錯也不尷尬，故 K 不需精準。
 */

const BASE_MS = 2500; // 固定開銷（冷啟動 + setup）
const K = 0.6; // 評估時間 ≈ K × 錄音長度（tunable）
const TARGET = 0.92; // 結果到之前的漸近上限

interface EvalProgressProps {
  /** 是否正在評估（true = 顯示進度；轉 false = 真結果到，觸發 snap 收尾） */
  active: boolean;
  /** 實際錄音長度（ms），用來動態配節奏 */
  recordingMs: number;
  /** 評估中主文案（預設「AI 評估中…」） */
  label?: string;
}

export function EvalProgress({ active, recordingMs, label = 'AI 評估中…' }: EvalProgressProps) {
  const [pct, setPct] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (active) {
      setFinishing(false);
      setPct(0);
      setElapsedSecs(0);
      startRef.current = Date.now();
      const expectedMs = BASE_MS + K * Math.max(0, recordingMs);
      const tau = Math.max(1500, expectedMs * 0.55); // 時間常數：~TARGET 落在 expectedMs 附近
      const id = setInterval(() => {
        const t = Date.now() - startRef.current;
        setPct(TARGET * (1 - Math.exp(-t / tau)));
        setElapsedSecs(Math.floor(t / 1000));
      }, 120);
      return () => clearInterval(id);
    }
    // active 轉 false：若有跑過 → snap 100% + 閃「完成」再收
    if (pct > 0) {
      setFinishing(true);
      setPct(1);
      const id = setTimeout(() => {
        setFinishing(false);
        setPct(0);
      }, 450);
      return () => clearTimeout(id);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, recordingMs]);

  if (!active && !finishing) return null;

  const widthPct = Math.round(pct * 100);

  return (
    <div className="w-full flex flex-col items-center gap-3">
      <div className="w-full rounded-2xl overflow-hidden shadow-[0_12px_48px_rgba(0,105,71,0.2)] bg-gradient-to-br from-[#006947] to-[#34d399]">
        {/* 進度條（緩動寬度 + 掃描光點） */}
        <div className="relative h-1.5 bg-white/20">
          <div
            className="absolute inset-y-0 left-0 bg-white/80 rounded-full"
            style={{ width: `${widthPct}%`, transition: 'width 0.3s ease-out' }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white shadow-[0_0_8px_4px_rgba(255,255,255,0.5)]"
            style={{ left: `calc(${widthPct}% - 4px)`, transition: 'left 0.3s ease-out' }}
          />
        </div>
        {/* 單一誠實文案 + elapsed（不再假裝後端在跑哪一步） */}
        <div className="px-5 py-4 flex items-center gap-3">
          <span className="text-lg leading-none select-none">{finishing ? '✅' : '🤖'}</span>
          <span className="flex-1 text-sm font-bold text-white">
            {finishing ? '完成' : label}
          </span>
          {!finishing && (
            <span className="text-xs font-medium text-white/70 tabular-nums">{elapsedSecs}s</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default EvalProgress;
