import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

type ManualTab = 'teacher' | 'student' | 'parent' | 'admin';

interface Section {
  heading: string;
  content: string;
}

interface ManualContent {
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  sections: Section[];
}

const MANUALS: Record<ManualTab, ManualContent> = {
  student: {
    title: '學生使用手冊',
    subtitle: '了解如何登入、選課文、完成六個學習步驟',
    icon: '📖',
    color: 'text-blue-600 bg-blue-50 border-blue-200',
    sections: [
      {
        heading: '什麼是 LingoLeap？',
        content:
          'LingoLeap 是一個幫助你學習國語文的 AI 學習平台！你可以練習朗讀課文（AI 會聽你讀並給建議）、跟 AI 做對話練習、練習生字筆順，以及查看學習成果報告。',
      },
      {
        heading: '如何登入',
        content:
          '1. 打開 LingoLeap 網站\n2. 輸入老師給你的帳號（Email）和密碼\n3. 點選「登入」\n\n忘記密碼？點選登入頁面的「忘記密碼」，輸入 Email 後查收重設密碼信件。',
      },
      {
        heading: '加入班級',
        content:
          '1. 登入後，點選「加入班級」\n2. 輸入老師給你的邀請碼（例如：ABC123）\n3. 點選「加入」\n4. 成功加入後，就能看到老師指派的課文',
      },
      {
        heading: '六個學習步驟',
        content:
          '每篇課文有 6 個步驟：\n\n步驟 1：簡介 — AI 介紹課文背景\n步驟 2：逐段朗讀 — 按住錄音鍵大聲朗讀，AI 給建議\n步驟 3：生字練習 — 學習筆順與注音\n步驟 4：課文理解 — 和 AI 問答對話\n步驟 5：全文朗讀 — 完整朗讀整篇課文\n步驟 6：報告 — 查看學習成果',
      },
      {
        heading: '麥克風沒有聲音怎麼辦？',
        content:
          '請確認瀏覽器有獲得麥克風權限。通常瀏覽器右上角會出現「允許麥克風」的請求，點選「允許」即可。也可以試試靠近麥克風說話、找安靜的地方，或用 Chrome 瀏覽器。',
      },
    ],
  },
  teacher: {
    title: '教師使用手冊',
    subtitle: '建立班級、指派課文、查看報告、使用通知中心',
    icon: '👩‍🏫',
    color: 'text-green-700 bg-green-50 border-green-200',
    sections: [
      {
        heading: '快速開始',
        content:
          '首次使用流程：登入 → 建立班級 → 邀請學生加入 → 指派課文 → 查看報告\n\nLingoLeap 協助教師追蹤學生朗讀與理解進度、指派課文、透過 AI 蘇格拉底對話促進學生思考，並生成個人化學習報告。',
      },
      {
        heading: '建立班級',
        content:
          '1. 登入後進入「教師儀表板」\n2. 點選「新增班級」按鈕\n3. 填寫班級名稱（如「五年三班」）和學年度\n4. 點選「建立」\n\n建立後系統會產生專屬邀請碼，分享給學生輸入加入班級。也可分享 QR Code 讓學生掃描加入。',
      },
      {
        heading: '學生標籤系統',
        content:
          '教師可為學生新增標籤方便分組與追蹤：\n1. 在學生名單中，點選學生姓名旁的標籤圖示\n2. 選擇或新增標籤（如「需要加強」、「表現優異」）\n3. 標籤只有教師可見，學生看不到',
      },
      {
        heading: '指派課文',
        content:
          '1. 在班級頁面點選「指派課文」\n2. 瀏覽 57 篇課文（可依年級、類型、難度篩選）\n3. 選定課文後點選「指派給班級」\n4. 設定截止日期（選填）\n5. 學生下次登入即可看到新指派的課文',
      },
      {
        heading: '查看學習報告',
        content:
          '班級效能熱圖：一眼看出每位學生在各課文的學習狀況（深綠=完成，淺色=進行中）\n\n個人報告：點選學生姓名，查看朗讀評分、理解測驗品質、生字完成度、學習時間\n\n六環節診斷報告：完整評估每位學生的朗讀、理解、練習成果',
      },
      {
        heading: '通知中心',
        content:
          '點選右上角鈴鐺圖示查看通知：\n• 學生完成課文\n• 學生加入班級\n• 系統公告\n\n紅點代表有未讀通知。',
      },
    ],
  },
  parent: {
    title: '家長使用手冊',
    subtitle: '連結孩子帳號、查看學習進度',
    icon: '👨‍👩‍👧',
    color: 'text-purple-700 bg-purple-50 border-purple-200',
    sections: [
      {
        heading: '建立家長帳號',
        content:
          '1. 前往 LingoLeap 網站，點選「註冊」\n2. 選擇「我是家長」\n3. 填寫姓名、Email、密碼\n4. 閱讀並同意服務條款\n5. 查收 Email，點選驗證連結完成註冊',
      },
      {
        heading: '連結孩子帳號',
        content:
          '首先請孩子：\n1. 孩子登入 LingoLeap\n2. 進入「個人設定」→「產生家長連結碼」\n3. 將 6 位數連結碼告知您\n\n然後您：\n1. 登入家長帳號\n2. 點選「連結孩子帳號」\n3. 輸入連結碼並確認\n\n注意：連結碼 24 小時內有效。',
      },
      {
        heading: '查看學習進度',
        content:
          '家長儀表板顯示：\n• 本週學習時間\n• 完成課文數\n• 待完成作業\n• 最近學習課文\n\n點選課文可查看朗讀評分、理解程度、學習時間等詳細資料。',
      },
      {
        heading: '隱私與安全',
        content:
          '孩子的學習資料僅限授權人員（孩子本人、老師、您）查看。所有資料均加密儲存，LingoLeap 不會將個人資料出售或分享給第三方。\n\n孩子可在「個人設定」中移除家長連結。',
      },
    ],
  },
  admin: {
    title: '管理員手冊',
    subtitle: '部署、監控、故障排除、CI/CD 流程',
    icon: '⚙️',
    color: 'text-gray-700 bg-gray-50 border-gray-200',
    sections: [
      {
        heading: '系統架構',
        content:
          '前端：React 19 + TypeScript + Tailwind → Cloud Run (lingoleap-frontend)\n後端：FastAPI + SQLAlchemy → Cloud Run (lingoleap-backend)\n資料庫：PostgreSQL 15 on Cloud SQL (asia-east1)\nAI：Vertex AI Gemini 2.5 Flash (us-central1)',
      },
      {
        heading: '切換 GCP 設定',
        content:
          'gcloud config configurations activate lingoleap\n\n注意：Vertex AI 必須使用 us-central1，asia-east1 不支援 Gemini 模型。',
      },
      {
        heading: '查看服務日誌',
        content:
          'gcloud logging read \\\n  "resource.type=cloud_run_revision AND resource.labels.service_name=lingoleap-backend" \\\n  --limit 100 --project lingoleap-dev\n\n只看錯誤：加上 AND severity>=ERROR',
      },
      {
        heading: '常見故障排除',
        content:
          'API 503：查看 backend 日誌，確認 Vertex AI 連線和 Cloud SQL 狀態\n\nAI 失效：確認 AI service location 為 us-central1，確認 service account 有 roles/aiplatform.user\n\n422 Session Not Found：Cloud Run 重啟後 session 被清除，學生重新整理頁面即可（前端有自動重建機制）',
      },
      {
        heading: 'CI/CD Workflows',
        content:
          'deploy.yml → push to main → Production\nstaging-deploy.yml → push to staging → Staging\npreview-deploy.yml → PR opened/closed → PR Preview（臨時，PR 關閉後自動刪除）\n\n查看狀態：gh run list --limit 10',
      },
    ],
  },
};

const HelpPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ManualTab>('student');
  const [expandedSection, setExpandedSection] = useState<number | null>(null);
  const navigate = useNavigate();

  const manual = MANUALS[activeTab];

  const tabs: { key: ManualTab; label: string; icon: string }[] = [
    { key: 'student', label: '學生', icon: '📖' },
    { key: 'teacher', label: '教師', icon: '👩‍🏫' },
    { key: 'parent', label: '家長', icon: '👨‍👩‍👧' },
    { key: 'admin', label: '管理員', icon: '⚙️' },
  ];

  const handleTabChange = (tab: ManualTab) => {
    setActiveTab(tab);
    setExpandedSection(null);
  };

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <header className="bg-white border-b border-amber-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="text-gray-500 hover:text-gray-800 transition-colors p-1 rounded-lg hover:bg-gray-100"
              aria-label="返回"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900">LingoLeap 使用說明</h1>
              <p className="text-xs text-gray-500">選擇您的角色查看對應說明</p>
            </div>
          </div>
        </div>
      </header>

      {/* Tab navigation */}
      <nav className="bg-white border-b border-amber-100" aria-label="使用手冊分類">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-amber-500 text-amber-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                aria-current={activeTab === tab.key ? 'page' : undefined}
              >
                <span aria-hidden="true">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Manual header */}
        <div className={`rounded-xl border p-5 mb-6 ${manual.color}`}>
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden="true">{manual.icon}</span>
            <div>
              <h2 className="text-xl font-bold">{manual.title}</h2>
              <p className="text-sm opacity-80 mt-0.5">{manual.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Accordion sections */}
        <div className="space-y-3">
          {manual.sections.map((section, idx) => (
            <div
              key={idx}
              className="bg-white rounded-2xl shadow-card overflow-hidden"
            >
              <button
                className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                onClick={() =>
                  setExpandedSection(expandedSection === idx ? null : idx)
                }
                aria-expanded={expandedSection === idx}
              >
                <h3 className="font-semibold text-gray-800 text-sm">{section.heading}</h3>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ml-2 ${
                    expandedSection === idx ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSection === idx && (
                <div className="px-5 pb-5">
                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                      {section.content}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer links to full docs */}
        <div className="mt-8 bg-white rounded-2xl shadow-card p-5">
          <h3 className="font-semibold text-gray-800 mb-3 text-sm">完整文件</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: '教師完整手冊', href: '/docs/manuals/teacher-guide.md' },
              { label: '學生完整手冊', href: '/docs/manuals/student-guide.md' },
              { label: '家長完整手冊', href: '/docs/manuals/parent-guide.md' },
              { label: '管理員手冊', href: '/docs/manuals/admin-guide.md' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber-700 hover:text-amber-900 hover:underline flex items-center gap-1"
              >
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Feedback prompt */}
        <p className="text-center text-xs text-gray-400 mt-6">
          找不到答案？點選右下角「回饋」按鈕告訴我們。
        </p>
      </main>
    </div>
  );
};

export default HelpPage;
