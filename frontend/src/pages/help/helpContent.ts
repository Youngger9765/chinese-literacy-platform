/**
 * /help 的內容來源（#3142）
 *
 * 為什麼內容要住在這裡，而不是散在 HelpPage.tsx 的字串裡：
 * 同一份說明原本有三份各自漂移的副本（`docs/manuals/*.md`、HelpPage 的硬編字串、
 * `public/presentation/full.html`），所以「57 篇課文」「六個學習步驟」這種錯誤
 * 會在多處同時存在。這裡是唯一一份。
 *
 * ⛔ 不要把「會變的事實」寫成字面值。關卡清單從 `stepConfig` 推導、課文總數從
 * API 的 `total` 取得 —— 那兩個數字過去就是這樣過期的。
 *
 * 對象只有老師與學生：
 *   - 管理員的 gcloud / CI-CD 內容搬到 `docs/production/deployment-guide.md`，
 *     那是工程 runbook，不該出現在給老師看的頁面上
 *   - 家長入口的後端旗標 `parent_portal_enabled` 目前是關的，沒有可寫的真流程
 *
 * 文案風格：網頁 UI 不加句號，用換行斷句。
 */

export type HelpRole = 'teacher' | 'student';

/**
 * 截圖的兩種裝置版本（#3151）。
 *
 * 為什麼只有兩種：實測側邊欄在所有寬度都固定 223px 不收合，唯一的版面差異是
 * 卡片欄數（≤834 為 2 欄、≥1024 為 3 欄），所以兩個斷點就涵蓋得到。
 */
export const HELP_DEVICES = {
  desktop: { label: '電腦・iPad 橫式' },
  ipad: { label: 'iPad 直式' },
} as const;

export type HelpDevice = keyof typeof HELP_DEVICES;

export interface HelpEntry {
  /** 用使用者會問的問句，不要用名詞標題 —— 「作業管理」沒有人會這樣找 */
  q: string;
  /** 編號步驟；一步一行 */
  steps?: string[];
  /** 補充說明或原理，放在步驟下面 */
  note?: string;
  /** 實機查證出來、現行說明完全沒寫的坑 */
  gotcha?: string;
  /** 搜尋用的額外關鍵字（同義詞、使用者可能打的錯字） */
  keywords?: string[];
  /**
   * 實機截圖的 id（#3151）。對應 `public/help-shots/<id>-<device>.png`。
   *
   * ⛔ 這裡只寫 id，不寫路徑也不寫裝置 —— 裝置由讀者在頁面上切換。
   *    圖是用 `tools/help-screenshots/capture.mjs` 對 staging 真機產的，
   *    內部班級名稱在截圖前就被隱藏掉（該腳本有洩漏自檢，突變驗過）。
   * ⚠️ 加新 id 之前先跑 `node tools/help-screenshots/capture.mjs --check`，
   *    確認選擇器還命中；UI 改版後過期的截圖比沒有截圖更糟。
   */
  shots?: string[];
}

export interface HelpSection {
  title: string;
  entries: HelpEntry[];
}

export interface HelpRoleContent {
  label: string;
  icon: string;
  /** tab 上的一句話，說清楚這個分頁是給誰看的 */
  blurb: string;
  sections: HelpSection[];
}

const TEACHER: HelpRoleContent = {
  label: '老師',
  icon: '👩‍🏫',
  blurb: '建立班級、把學生加進來、指派課文與出作業、看學生的進度與成果',
  sections: [
    {
      title: '班級與學生',
      entries: [
        {
          q: '我要怎麼建立一個班級？',
          shots: ['teacher-create-classroom'],
          steps: [
            '左側點「班級管理」',
            '點「建立班級」',
            '填班級名稱（例如：五年三班），選年級',
            '送出後就會看到這個班級的卡片',
          ],
          keywords: ['開班', '新增班級', '班級'],
        },
        {
          q: '學生要怎麼加入我的班級？',
          steps: [
            '進入該班級',
            '找到「加入代碼」區塊',
            '把代碼念給學生，或點 QR Code 按鈕投影出來讓學生掃',
            '學生那邊在「加入班級」輸入代碼，或直接掃碼',
          ],
          gotcha:
            '加入代碼區塊會依班級狀況自動收合 —— 班上還沒有學生時預設展開，'
            + '一旦有學生加入就收合，QR Code 按鈕會跟著藏起來，看起來像功能消失了 '
            + '；下次要投影 QR 時先把那個區塊點開',
          keywords: ['邀請碼', '加入代碼', 'QR', 'qrcode', '掃碼'],
        },
        {
          q: '學生說看不到我派的作業，怎麼辦？',
          steps: [
            '先確認那位學生真的在這個班級的名單裡',
            '回到「作業管理」，確認這份作業的狀態與對象班級',
            '確認你做的是「出作業」而不是只有「指派課文」（見下一題）',
            '請學生重新整理，或登出再登入一次',
          ],
          keywords: ['看不到作業', '沒有作業', '作業不見'],
        },
      ],
    },
    {
      title: '指派課文與作業',
      entries: [
        {
          q: '「指派課文」和「出作業」有什麼不一樣？',
          shots: ['teacher-assignments'],
          note:
            '指派課文只是把課文開放給班上練習\n'
            + '出作業才會在學生端產生「待完成」的任務，也才有繳交與批改',
          gotcha:
            '只做「指派課文」的話，作業管理仍然會顯示「共 0 份作業」，'
            + '學生端也不會出現待完成任務 —— 這是最常被誤會的一步',
          keywords: ['指派', '出作業', '派作業', '0 份作業'],
        },
        {
          q: '我要怎麼看學生的學習成果？',
          steps: [
            '進入班級後選「課堂即時」看當下的作答狀況',
            '或到「作業管理」點進某份作業看繳交與批改',
            '個別學生的歷程從班級名單點該學生進去',
          ],
          gotcha:
            '「課堂即時」顯示「尚無資料」不代表學生沒在練 —— 它只涵蓋會記錄答題資料的題型，'
            + '學生正在朗讀的時候就會顯示尚無資料',
          keywords: ['進度', '成果', '報表', '課堂即時', '尚無資料'],
        },
      ],
    },
    {
      title: '登入',
      entries: [
        {
          q: '有哪些登入方式？',
          shots: ['teacher-login'],
          note:
            '三種都可以：\n'
            + '輸入 Email 與密碼\n'
            + '用 Google 帳號登入\n'
            + '用均一帳號登入',
          keywords: ['登入', 'Google', '均一', '密碼'],
        },
        {
          q: '我忘記密碼了？',
          steps: [
            '在登入頁點「忘記密碼」',
            '輸入註冊時用的 Email',
            '到信箱收重設密碼的信並照著設定',
          ],
          keywords: ['忘記密碼', '重設密碼'],
        },
      ],
    },
  ],
};

const STUDENT: HelpRoleContent = {
  label: '學生',
  icon: '📖',
  blurb: '加入班級、完成老師出的作業、自己找課文練習',
  sections: [
    {
      title: '開始使用',
      entries: [
        {
          q: '下次要怎麼再找到這一頁？',
          steps: [
            '登入後看左側側邊欄',
            '最下面那個「使用說明」就是這一頁',
          ],
          note: '老師端也在同一個位置',
          shots: ['student-help-entry'],
          keywords: ['說明', '幫助', 'help', '找不到說明'],
        },
        {
          q: '我要怎麼加入老師的班級？',
          shots: ['student-join'],
          steps: [
            '左側點「加入班級」',
            '輸入老師給的加入代碼，或用手機掃老師投影的 QR Code',
            '送出後就會在「班級作業」看到老師出的作業',
          ],
          keywords: ['加入班級', '邀請碼', 'QR', '掃碼'],
        },
        {
          q: '有哪些登入方式？',
          note:
            '三種都可以：\n'
            + '輸入 Email 與密碼\n'
            + '用 Google 帳號登入\n'
            + '用均一帳號登入',
          keywords: ['登入', 'Google', '均一'],
        },
      ],
    },
    {
      title: '練習',
      entries: [
        {
          q: '老師出的作業在哪裡？',
          shots: ['student-assignments'],
          steps: [
            '左側點「班級作業」',
            '選一份還沒完成的作業點進去',
            '照著關卡一關一關做完',
          ],
          keywords: ['作業', '待完成', '班級作業'],
        },
        {
          q: '我想自己找課文練習，要去哪裡？',
          shots: ['student-library', 'student-home-recommend'],
          steps: [
            '左側點「圖書館」',
            '用年級或類別篩選，或直接搜尋課文名稱',
            '點進課文就可以開始練習',
          ],
          gotcha:
            'AI 推薦不在圖書館，在你的「主頁」 —— 而且要先有練習紀錄才會有推薦，'
            + '剛註冊的新帳號那一區是空的',
          keywords: ['圖書館', '自主練習', '選課文', 'AI 推薦', '推薦'],
        },
        {
          q: '一篇課文要做哪些關卡？',
          note: '每篇課文的關卡由老師的學習單決定，實際清單見下方列表',
          keywords: ['步驟', '關卡', '流程'],
        },
      ],
    },
    {
      title: '遇到問題',
      entries: [
        {
          q: '麥克風沒有聲音怎麼辦？',
          steps: [
            '看瀏覽器網址列附近有沒有「允許使用麥克風」的提示，點允許',
            '如果之前按過封鎖，到瀏覽器的網站設定把麥克風改成允許',
            '確認系統音量與輸入裝置沒有被靜音',
            '換到安靜一點的地方，嘴巴靠近麥克風再試',
          ],
          keywords: ['麥克風', '錄音', '沒聲音', '收音'],
        },
        {
          q: '朗讀一直判斷不出來，是我唸錯嗎？',
          note:
            '先確認麥克風有收到聲音（上一題）\n'
            + '環境太吵或離麥克風太遠都會影響判斷\n'
            + '放慢速度、把每個字唸清楚會比唸快更容易被辨識',
          keywords: ['朗讀', '辨識', '唸不出來'],
        },
      ],
    },
  ],
};

export const HELP_CONTENT: Record<HelpRole, HelpRoleContent> = {
  teacher: TEACHER,
  student: STUDENT,
};

export const HELP_ROLE_ORDER: HelpRole[] = ['teacher', 'student'];

/** 一段可搜尋的字串（給某一則用） */
export function entryHaystack(e: HelpEntry): string {
  return [e.q, ...(e.steps || []), e.note || '', e.gotcha || '', ...(e.keywords || [])]
    .join('\n');
}

/**
 * 全部角色的全部文字。
 *
 * 存在的理由是回歸鎖：原本那幾條「不准出現 X」的測試是 render 完掃 `document.body`，
 * 而停用關卡、舊課文數、工程用語全都在**別的分頁**上 —— 預設分頁看不到，
 * 於是斷言恆真、測試全綠卻什麼都沒證明。掃這裡才涵蓋每個角色。
 */
/**
 * 全部被引用到的 shot id（去重、保序）。
 *
 * 回歸鎖用它來斷言「引用的圖檔案真的存在」。刻意不做反向斷言（manifest 裡的每張都要
 * 被引用）—— 那個方向會逼人為了讓測試綠而把圖硬塞進不相干的問答裡。
 */
export function allHelpShots(): string[] {
  const out: string[] = [];
  for (const role of HELP_ROLE_ORDER) {
    for (const sec of HELP_CONTENT[role].sections) {
      for (const e of sec.entries) {
        for (const id of e.shots || []) if (!out.includes(id)) out.push(id);
      }
    }
  }
  return out;
}

export function allHelpText(): string {
  return HELP_ROLE_ORDER
    .map((role) => {
      const c = HELP_CONTENT[role];
      return [
        c.label,
        c.blurb,
        ...c.sections.flatMap((s) => [s.title, ...s.entries.map(entryHaystack)]),
      ].join('\n');
    })
    .join('\n');
}
