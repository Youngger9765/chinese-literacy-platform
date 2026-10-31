import type { IslandStop } from './islandTemplate';

interface IslandListModeProps {
  stops: IslandStop[];
  doneIndexes: number[];
  unlockedZone: number;
  onEnter: (index: number) => void;
  onClose: () => void;
  /** 開門動畫進行中（door !== null）時傳 true，停用全部「進入」按鈕——
   *  真正擋重複開站的是 openModule 自己的防護，這裡只是不讓按鈕看起來
   *  像點了有用（team-lead 2026-10-26 明令）。 */
  disabled?: boolean;
}

/**
 * 清單模式（PRD §8）：舊裝置跑不動 3D、或需要無障礙進入方式時，
 * 用這個清單取代第一人稱走動/上帝視角點擊。「進入」走的是跟 3D 完全
 * 同一條路徑（呼叫方把 onEnter(index) 接到 openModule(index)），
 * 開門動畫、iframe、回島、亮燈、光柱、霧散全部沿用既有機制，這裡
 * 只是另一種「選到第幾站」的輸入方式。
 */
export default function IslandListMode({ stops, doneIndexes, unlockedZone, onEnter, onClose, disabled = false }: IslandListModeProps) {
  return (
    <div role="dialog" aria-label="站點清單" className="absolute inset-0 z-50 flex items-center justify-center bg-[#0f2535]/90 p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/20 bg-[#f8f3e5] p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-xl font-black text-[#284650]">站點清單</h2>
          <button type="button" aria-label="關閉清單" onClick={onClose} className="rounded-full border border-[#284650]/30 px-3 py-1 text-sm font-bold text-[#284650]">關閉</button>
        </div>
        <ul className="flex flex-col gap-2">
          {stops.map((stop, index) => {
            const locked = stop.zone > unlockedZone;
            const done = doneIndexes.includes(index);
            return (
              <li key={stop.name} className="flex items-center justify-between gap-3 rounded-xl border border-[#284650]/15 bg-white/70 px-4 py-3">
                <div>
                  <p className="font-bold text-[#284650]">{stop.name}</p>
                  <p className="text-xs text-[#526969]">{locked ? '還在霧裡' : done ? '已亮燈' : '未開始'}</p>
                </div>
                {locked ? null : (
                  <button
                    type="button"
                    aria-label={`進入${stop.name}`}
                    disabled={disabled}
                    onClick={() => onEnter(index)}
                    className="shrink-0 rounded-lg bg-[#32796e] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    進入
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
