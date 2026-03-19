import React from 'react';
import { useNavigate } from 'react-router-dom';

interface LinkItem {
  title: string;
  description: string;
  href: string;
  external?: boolean;
  badge?: string;
}

interface SectionCardProps {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

const REPO_BLOB_BASE =
  'https://github.com/Youngger9765/chinese-literacy-platform/blob/staging';

const importantLinks: LinkItem[] = [
  {
    title: 'PRD',
    description: '產品需求文件，包含功能範圍、User Stories 與驗收標準。',
    href: `${REPO_BLOB_BASE}/docs/PRD.md`,
    badge: 'Core',
  },
  {
    title: '里程碑',
    description: '6 個月 roadmap 與階段性目標。',
    href: 'https://youngger9765.github.io/chinese-literacy-platform/roadmap-6month.html',
    external: true,
    badge: 'Roadmap',
  },
  {
    title: '會議紀錄',
    description: '查看最近的週會紀錄與決策。',
    href: `${REPO_BLOB_BASE}/docs/meetings/2026-03-13.md`,
    badge: 'Meeting',
  },
  {
    title: '學生貢獻度',
    description: '追蹤實習生本週輸出、PR 狀態與 issue 進度。',
    href: `${REPO_BLOB_BASE}/docs/meetings/team-contributions.md`,
    badge: 'Team',
  },
  {
    title: '學生學習歷程儀表板',
    description: '查看學生學習歷程與訓練儀表板。',
    href: 'https://lingoleap-frontend-958347263320.asia-east1.run.app/intern-training/dashboard.html',
    external: true,
    badge: 'Dashboard',
  },
];

const quickLinks: LinkItem[] = [
  {
    title: '本週週報',
    description: '2026-03-19 週報，整理本週交付、風險與下週重點。',
    href: `${REPO_BLOB_BASE}/docs/meetings/2026-03-19-weekly-report.md`,
  },
  {
    title: '明天會議議程',
    description: '2026-03-20 會議議程，開會前可直接照這份走。',
    href: `${REPO_BLOB_BASE}/docs/meetings/2026-03-20-agenda.md`,
  },
];

const weeklyHighlights: string[] = [
  'ROADMAP v3.3、模組架構重整與實習生技能樹已更新完成。',
  '啟翔的 #445 已 merge，#262 仍待改成 CustomEvent 做法。',
  '靖杭的 #217 與 PR #314 都有進度，但仍卡在 review 與方向確認。',
  '本週重點從大量開發切回「收斂、review、測試、決策」四件事。',
];

const agendaItems: string[] = [
  '5 分鐘：確認上次 action items 是否完成。',
  '10 分鐘：review 靖杭 PR #451、啟翔 PR #450 的阻塞點。',
  '10 分鐘：決定下週 issue 分配，避免兩位學生卡在同一層級問題。',
  '10 分鐘：確認學生貢獻追蹤方式與 dashboard 使用方式。',
  '5 分鐘：收斂本週技術風險與下週 demo / 測試安排。',
];

const studentContributions: string[] = [
  '啟翔：本週已完成 #445 修復，顯示 bug fix 速度與精準度有提升。',
  '啟翔：#262 已找到 root cause，下一步是把同步機制改成 CustomEvent。',
  '靖杭：#217 已整理成可 review 的 PR，但需要先處理 rebase 與 hook 抽象重用。',
  '靖杭：主動發現 SQLite / PostgreSQL 相容問題，代表對部署一致性開始有意識。',
];

const studentDashboardSummary: string[] = [
  '可作為學生訓練進度、任務完成度與觀察紀錄的單一入口。',
  '明天會議可直接打開 dashboard 對照實習生本週輸出與下週安排。',
];

const SectionCard: React.FC<SectionCardProps> = ({
  eyebrow,
  title,
  description,
  children,
}) => (
  <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/70 backdrop-blur">
    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">{eyebrow}</p>
    <div className="mt-3">
      <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </div>
    <div className="mt-5">{children}</div>
  </section>
);

const ResourceLinkCard: React.FC<LinkItem> = ({ title, description, href, external, badge }) => (
  <a
    href={href}
    target={external ? '_blank' : '_self'}
    rel={external ? 'noreferrer' : undefined}
    className="group rounded-2xl border border-slate-200 bg-slate-50/80 p-4 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-white hover:shadow-md"
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
      </div>
      {badge ? (
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
          {badge}
        </span>
      ) : null}
    </div>
    <div className="mt-3 text-sm font-medium text-emerald-700 group-hover:text-emerald-800">
      前往連結
    </div>
  </a>
);

const ProjectHubPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eefbf5_52%,#f8fafc_100%)]">
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">
              LingoLeap Hub
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">專案文件入口</h1>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
          >
            返回
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <section className="rounded-[2rem] border border-slate-200/80 bg-slate-900 px-6 py-8 text-white shadow-xl shadow-emerald-100 sm:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.32em] text-emerald-300">
              Route
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">`/hub`</h2>
            <p className="mt-4 text-sm leading-7 text-slate-200 sm:text-base">
              這頁把週報、明天會議議程、學生貢獻重點、學生儀表板和核心文件集中在同一個入口。
              也保留 ` /docs ` 可直接打開同一頁，方便沿用原本記法。
            </p>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {quickLinks.map((link) => (
              <ResourceLinkCard key={link.title} {...link} />
            ))}
          </div>
        </section>

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <SectionCard
            eyebrow="Weekly Report"
            title="本週週報"
            description="本週重點是收斂現有成果，讓 review、文件與決策跟上開發速度。"
          >
            <ul className="space-y-3 text-sm leading-6 text-slate-700">
              {weeklyHighlights.map((item) => (
                <li key={item} className="rounded-2xl bg-slate-50 px-4 py-3">
                  {item}
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard
            eyebrow="Tomorrow"
            title="2026-03-20 會議議程"
            description="明天開會可以直接照這五段走，時間控制在 40 分鐘內。"
          >
            <ol className="space-y-3 text-sm leading-6 text-slate-700">
              {agendaItems.map((item, index) => (
                <li key={item} className="flex gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionCard
            eyebrow="Interns"
            title="學生貢獻"
            description="整理兩位學生本週可被明確觀察到的輸出與下一步。"
          >
            <ul className="space-y-3 text-sm leading-6 text-slate-700">
              {studentContributions.map((item) => (
                <li key={item} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                  {item}
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard
            eyebrow="Dashboard"
            title="學生儀表板"
            description="把 dashboard 當成會議時的共同畫面，快速對齊進度與訓練狀態。"
          >
            <ul className="space-y-3 text-sm leading-6 text-slate-700">
              {studentDashboardSummary.map((item) => (
                <li key={item} className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <ResourceLinkCard
                title="打開學生學習歷程儀表板"
                description="會直接前往既有 dashboard 頁面。"
                href="https://lingoleap-frontend-958347263320.asia-east1.run.app/intern-training/dashboard.html"
                external
                badge="Live"
              />
            </div>
          </SectionCard>
        </div>

        <SectionCard
          eyebrow="Resources"
          title="重要文件連結"
          description="把最常用的文件集中成一排，開會或同步時不用再找。"
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {importantLinks.map((link) => (
              <ResourceLinkCard key={link.title} {...link} />
            ))}
          </div>
        </SectionCard>
      </main>
    </div>
  );
};

export default ProjectHubPage;
