/**
 * /help 實機截圖的規格（#3151）
 *
 * 每一筆 = 一張圖。`id` 要跟 `helpContent.ts` 裡 `shots` 欄位引用的字串一致。
 *
 * `annotate` 畫紅框（要讀者看的地方），`sanitize` 把內部字樣換成中性示範文字。
 *
 * ⛔ 這個 repo 是 PUBLIC。截圖直接進 `frontend/public/` 等於對外發佈，而 staging 上
 * 有內部測試用的班級名稱。所以那些一律 `sanitize`。示範帳號（李老師／小明）本身是
 * 種子資料，可以留。
 *
 * ⛔ **規則一律按結構寫，不准比對敏感字串。** 寫 `:has-text("<內部班名>")` 會把那個
 * 名字留在這個檔案裡 —— 而這個檔案也在 public repo，等於換個地方洩漏。所以用「這一排
 * 按鈕」「這一格標題」這種結構選擇器，再用陣列輪替餵中性文字。
 *
 * ⛔ **選擇器沒命中會讓整支腳本失敗**，不是靜默跳過。第一版是靜默的，結果四個規則全沒中、
 * 班級卡片整排明文躺在圖上，輸出跟「本來就沒東西要遮」長得一模一樣，我是親眼看圖才發現。
 *
 * `clip` 指定要裁切到哪個元素（加 padding），沒給就整頁。裁切不只為了檔案小 ——
 * 整頁圖在 iPad 尺寸下字會小到看不清要看的地方。
 */

export const DEVICES = {
  desktop: { width: 1440, height: 900, label: '電腦 · iPad 橫式' },
  ipad:    { width: 834,  height: 1112, label: 'iPad 直式' },
};

/** 側邊欄整塊 —— 很多張圖都要標它，抽出來免得寫錯 */
const SIDEBAR_TEACHER = 'nav[aria-label="教師導覽"]';
const SIDEBAR_STUDENT = 'nav[aria-label="學生導覽"]';

export const SHOTS = [
  // ---------------- 老師 ----------------
  {
    id: 'teacher-create-classroom',
    role: 'teacher',
    path: '/teacher',
    annotate: [
      { sel: SIDEBAR_TEACHER, note: '從這裡進班級管理' },
      { sel: 'button:has-text("建立班級")', note: '點這顆開新班級' },
    ],
    // 班級卡片會露出內部測試班名與人數，而這張的主題是「按鈕在哪」
    sanitize: [
      { sel: 'div.grid h3', text: ['三年甲班', '五年三班', '六年一班'] },
      { sel: 'div.grid p:has-text("位學生")', text: ['28 位學生', '26 位學生', '30 位學生'] },
    ],
  },
  {
    id: 'teacher-assignments',
    role: 'teacher',
    path: '/teacher/assignments',
    annotate: [
      { sel: 'button:has-text("建立作業")', note: '出作業從這裡' },
    ],
    // 敏感的是班級下拉選單的 option（其中一個是內部的示範班）。
    // 作業名稱與課文名是真實教材內容，留著對讀者有幫助，不動。
    sanitize: [
      { sel: 'select option', text: ['五年三班（5 年級）', '六年一班（6 年級）', '三年甲班（3 年級）'] },
    ],
  },
  {
    id: 'teacher-login',
    role: 'anon',
    path: '/login',
    annotate: [{ sel: 'form, main', note: '三種登入方式都在這一頁' }],
    clip: 'form, main',
  },

  // ---------------- 學生 ----------------
  {
    id: 'student-join',
    role: 'student',
    path: '/join',
    annotate: [
      { sel: 'input', note: '在這裡輸入老師給的加入代碼' },
      { sel: 'button:has-text("加入班級")', note: '然後點這顆' },
    ],
    clip: 'main, form',
  },
  {
    id: 'student-assignments',
    role: 'student',
    path: '/assignments',
    annotate: [
      { sel: SIDEBAR_STUDENT, note: '老師出的作業在「班級作業」' },
    ],
    // 橫幅那行與篩選鈕上都是內部測試班名
    // 三處各自不同的形狀：
    //  - 橫幅是單一一格，整格換
    //  - 篩選鈕實際有 5 顆（全部 ＋ 4 個班），標籤要給滿 5 個，否則陣列輪替會出現重複的班名
    //  - 卡片上的班名跟「｜老師指派」住在同一格，所以用 mode 'own' 只換自身文字、留下子元素
    // 班名用**隱藏**而不是替換。替換連續咬了三次（沒命中、外層內層各寫一次造成三連、
    // 憑空在標題列生出一個班名），而隱藏不可能重複也不可能無中生有。
    // 讀者不需要知道這份作業屬於哪個班，那不是這張圖要教的事。
    // 每條規則都宣告 `expect`，匹配數不符就當場失敗。
    sanitize: [
      { sel: 'span:has-text("你在")', text: '你在 2 個班級：五年三班・六年一班', expect: 1 },
      { sel: 'button.rounded-full', hide: true, expect: 5 },
      // 4 不是 2。我前三次都以為是 2（探測時只數了「自身文字含班名」的那些），
      // 每張卡片其實有兩個這種 chip —— 標題列一個、下面那行一個。`expect` 當場把真相講出來。
      { sel: 'span.text-xs.text-accent.font-medium', hide: true, expect: 4 },
    ],
  },
  {
    id: 'student-library',
    role: 'student',
    path: '/library',
    annotate: [
      { sel: 'button:has-text("全部級別")', note: '用級別篩選' },
      { sel: 'button:has-text("只看未讀")', note: '只看還沒讀過的' },
    ],
  },
  {
    id: 'student-home-recommend',
    role: 'student',
    path: '/student',
    annotate: [
      { sel: SIDEBAR_STUDENT, note: 'AI 推薦在「主頁」，不在圖書館' },
    ],

  },
  {
    id: 'student-help-entry',
    role: 'student',
    path: '/student',
    annotate: [
      { sel: `${SIDEBAR_STUDENT} >> text=使用說明`, note: '這一頁從這裡進來' },
    ],
    clip: SIDEBAR_STUDENT,
  },
];
