/**
 * 每題「第一次」的對錯（#4081）。
 *
 * 渲染器回報的 feedback 是每題最新一次的判定；要全對才能完成的關卡（閱讀聚光燈），
 * 最後一定是全對。把第一次判定出來的對錯記下來、之後不覆蓋，報告才看得出哪幾題錯過。
 * 回傳新物件，不改動傳入的 `first`。
 */
export function mergeFirstVerdicts(
  first: Record<string, boolean>,
  latest: unknown,
): Record<string, boolean> {
  const out = { ...first };
  if (latest && typeof latest === 'object') {
    for (const [id, verdict] of Object.entries(latest as Record<string, unknown>)) {
      if ((verdict === true || verdict === false) && !(id in out)) out[id] = verdict;
    }
  }
  return out;
}
