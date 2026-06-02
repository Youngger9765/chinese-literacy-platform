import { getToneForChar } from './toneData';

const prevCharSet1 = new Set([
  '第', '説', '说', '唯', '惟', '统', '統', '独', '獨', '劃', '划', '萬', '專', '某',
  '十', '九', '八', '七', '六', '五', '四', '三', '二', '一', '〇', '零',
]);

const nextCharSet1 = new Set([
  '是', '日', '月', '的', '或', '物', '片', '系',
  '十', '九', '八', '七', '六', '五', '四', '三', '二', '一', '〇', '零', '百', '千', '萬',
  '元', '則', '節', '台', '同', '名', '回', '堂', '層', '幅', '幢', '年', '息', '成', '排',
  '提', '搏', '擊', '擲', '旁', '時', '枚', '格', '條', '樓', '流', '環', '篇', '級', '群',
  '言', '連', '門', '間',
  '天', '經', '方', '對', '次', '家', '鳴', '命', '份', '件', '尊', '聲', '歲', '副', '本', '批',
]);

const specialYiCases: Record<string, [string, boolean, boolean]> = {
  '個': ['0000', false, false],
  '个': ['0000', false, false],
  '會': ['0000', false, false],
  '切': ['0000', false, false],
  '不': ['0000', true, true],
};

const specialBuCases: Record<string, [string, boolean, boolean]> = {
  '禁': ['0000', false, false],
  '菲': ['0000', false, false],
  '勝': ['0000', false, false],
  '著': ['0000', false, false],
  '了': ['0000', false, false],
  '好': ['0000', false, false],
  '假': ['0000', false, false],
  '當': ['ss01', false, false],
};

/**
 * 以下處理一、不的方法是基於 jeffreyxuan 的原始碼
 * https://github.com/jeffreyxuan/toneoz-font-zhuyin/blob/main/src/js/ybtone.js
 * 同時也請參考教育部國語辭典說明：https://dict.concised.moe.edu.tw/page.jsp?ID=55
 *
 * Returns [newSs, skipNext, skipPrev]
 */
export function getNewToneForYiBu(
  prevChar: string | null,
  currentChar: string,
  nextChar: string | null,
  prevTone: number | null,
  nextTone: number | null,
  skipPrev: boolean,
): [string, boolean, boolean] {
  if (currentChar === '一') {
    if (!skipPrev && (prevChar == null || prevCharSet1.has(prevChar))) {
      return ['0000', false, true];
    } else if (nextChar != null && nextChar in specialYiCases) {
      return specialYiCases[nextChar]!;
    } else if (nextChar == null || nextChar === '' || nextCharSet1.has(nextChar)) {
      return ['0000', true, true];
    } else if (prevChar === nextChar ||
        ['看', '聽', '寫', '用', '說', '動', '搖', '問'].includes(nextChar ?? '')) {
      return ['0000', true, true];
    } else if (nextTone != null && (nextTone === 1 || nextTone === 2 || nextTone === 3)) {
      return ['ss02', true, true]; // Fourth tone
    } else if (nextTone != null && nextTone === 4) {
      return ['ss01', true, true]; // Second tone
    } else {
      return ['0000', false, true];
    }
  } else if (currentChar === '不') {
    if (nextChar != null && nextChar in specialBuCases) {
      return specialBuCases[nextChar]!;
    }
    if (nextTone != null && (nextTone === 1 || nextTone === 2 || nextTone === 3 || nextTone === 5)) {
      return ['0000', false, true]; // Remain 四聲
    } else if (nextTone != null && nextTone === 4) {
      return ['ss01', true, true]; // Change to second tone
    } else {
      return ['0000', false, true];
    }
  }

  return ['0000', false, false]; // Default case
}
