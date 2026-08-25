/**
 * 步驟的網址 —— **全站唯一的組法**（#2916）。
 *
 * 步驟 id 帶輪次時長這樣：`full-text-annotate#p3kud`。
 * ⛔ 不可以直接塞進路徑：`/learn/20063/full-text-annotate#p3kud` 的 `#`
 * 會被瀏覽器當成 fragment，前端讀不到，於是三篇的讀全文
 * **網址不一樣、slug 也對，內容卻一模一樣**（2026-08-25 staging 實測，
 * 三篇各 3093 字、同樣開頭）。owner：「怎麼都長一樣？？」
 *
 * 輪次一律走 `?p=` —— `/q/{代號}` 轉址產的也是這個形式，全站一種形狀。
 */
export function stepPath(storyId: number | string, stepId: string): string {
  const i = stepId.indexOf('#');
  if (i < 0) return `/learn/${storyId}/${stepId}`;
  const base = stepId.slice(0, i);
  const round = stepId.slice(i + 1);
  return round ? `/learn/${storyId}/${base}?p=${round}` : `/learn/${storyId}/${base}`;
}
