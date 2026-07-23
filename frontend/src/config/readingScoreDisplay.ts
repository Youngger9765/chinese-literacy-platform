/**
 * 朗讀計分「顯示」設定 (Issue #2568 / #2566)。
 *
 * 教授審查會議決議：重點朗讀「以流暢率為主 + 口音通融」，捨棄「正確率」、只保留
 * 「流暢度（綠色字/分 = WPM）」作為單一指標，方便現場對學生解說。
 *
 * 只「隱藏正確率的顯示」——計算（matchRate / accuracy）仍保留，之後若要調整或做
 * 不同 label 呈現時可直接翻回 true。
 */
export const SHOW_READING_ACCURACY = false;
