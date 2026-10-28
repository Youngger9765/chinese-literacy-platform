/**
 * StudentArchipelagoPage — `/student/archipelago` (#3780 D3).
 *
 * 我的群島頁：列出全部課程的「島」，顯示佔領狀態與站數進度，可依年級篩選、
 * 搜尋課名，點一座島進 `/lab/island/:storyId`。頁面上方顯示文字寶貝數，
 * 連到 `/lab/word-babies`。
 *
 * PRD §5.7：只打兩支 API，各打一次——`fetchStories()`（全部課程清單，內部
 * 已經是 `page_size=300` 一次拿完，見 services/api.ts）跟 `getStudentProgress()`
 * （`is_occupied`/`stations_done`/`stations_total` 已由伺服器算好，§5.6）。
 * 文字寶貝數另外加一支 `fetchMyWordBabies`（PRD 寫這份文件時文字寶貝養成
 * 系統還沒做，§5.4 原本要求留空／「即將開放」——team-lead 2026-10-28 現在
 * 明確要求顯示真實寶貝數並連到 /lab/word-babies，這份系統這次 session 已經
 * 做完，所以用真數字，不是當初 PRD 寫的佔位文字）。
 *
 * 合併/篩選/文案的純函式邏輯都在 archipelagoDomain.ts（已獨立測試），這個
 * 檔案只負責 fetch 三支 API 一次＋render。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStories } from '../../services/api';
import { getStudentProgress } from '../../services/progressApi';
import { fetchMyWordBabies } from '../../services/wordBabyApi';
import { gradeLabel } from '../../utils/gradeLabel';
import {
  buildArchipelago,
  filterArchipelago,
  islandStatusLabel,
  splitGradeOptions,
  storiesPageMismatchMessage,
  type ArchipelagoIsland,
} from './archipelagoDomain';

const STATUS_BADGE_CLASS: Record<ArchipelagoIsland['status'], string> = {
  occupied: 'bg-amber-100 text-amber-700 border-amber-300',
  in_progress: 'bg-sky-100 text-sky-700 border-sky-300',
  not_started: 'bg-gray-100 text-gray-500 border-gray-200',
};

const IslandCard: React.FC<{ island: ArchipelagoIsland; onOpen: () => void }> = ({ island, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="group flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
  >
    <div className="flex items-start justify-between gap-2">
      <span className="text-base font-bold text-gray-900">{island.title}</span>
      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
        {gradeLabel(island.grade)}
      </span>
    </div>
    <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-bold ${STATUS_BADGE_CLASS[island.status]}`}>
      {islandStatusLabel(island)}
    </span>
  </button>
);

const StudentArchipelagoPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [islands, setIslands] = useState<ArchipelagoIsland[] | null>(null);
  const [grades, setGrades] = useState<string[]>([]);
  const [babyCount, setBabyCount] = useState<{ owned: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!token || !user) return;
    let alive = true;
    (async () => {
      try {
        const [storiesRes, progressRes, babiesRes] = await Promise.all([
          fetchStories(token),
          getStudentProgress(token, user.id),
          fetchMyWordBabies(user.id, token),
        ]);
        if (!alive) return;
        // PRD §6（§5.7）：page_size=300 理論上一次拿滿全部課程；分頁漏課不會
        // 報錯，只會讓群島看起來「少了幾座」，所以用斷言式檢查主動印警告。
        const mismatch = storiesPageMismatchMessage(storiesRes.stories.length, storiesRes.total);
        if (mismatch) console.error(mismatch);
        const stories = storiesRes.stories.map((s) => ({ id: s.id, title: s.title, grade: s.grade ?? '' }));
        setIslands(buildArchipelago(stories, progressRes.texts));
        setGrades(storiesRes.grades);
        setBabyCount({ owned: babiesRes.babies_owned_count, total: babiesRes.babies_total_species });
      } catch {
        if (alive) setError('載入群島資料失敗，請重新整理再試一次');
      }
    })();
    return () => { alive = false; };
  }, [token, user]);

  const filtered = useMemo(
    () => (islands ? filterArchipelago(islands, { grade: selectedGrade ?? undefined, search: searchQuery }) : []),
    [islands, selectedGrade, searchQuery],
  );

  // 年級跟「文言文／品格教育」這類特殊主題分開顯示（code review 2026-10-28：
  // 混在同一排四年級會看不懂差別）。
  const { grades: gradeOptions, themes: themeOptions } = useMemo(() => splitGradeOptions(grades), [grades]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-black text-gray-900">我的群島</h1>
        <p className="text-sm text-gray-500">每一課都是一座島，讀完全部站點就能佔領它</p>
      </header>

      {/* 文字寶貝數 + 連到 /lab/word-babies（team-lead 2026-10-28 要求） */}
      <button
        type="button"
        onClick={() => navigate('/lab/word-babies')}
        className="flex w-full items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left transition-all hover:border-amber-400"
      >
        <span className="text-base font-bold text-amber-800">
          {babyCount ? `文字寶貝 ${babyCount.owned}/${babyCount.total} 隻` : '文字寶貝載入中…'}
        </span>
        <span className="text-sm font-semibold text-amber-600 underline">看我的寶貝 →</span>
      </button>

      {error && (
        <div className="rounded-lg bg-red-50 py-4 text-center text-red-600">
          <p>{error}</p>
        </div>
      )}

      {!error && islands === null && (
        <p className="py-8 text-center text-gray-400">載入中…</p>
      )}

      {islands !== null && (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedGrade(null)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  selectedGrade === null ? 'bg-accent text-white' : 'border border-gray-200 bg-white text-gray-600 hover:border-accent'
                }`}
              >
                全部年級
              </button>
              {gradeOptions.map((grade) => (
                <button
                  key={grade}
                  type="button"
                  onClick={() => setSelectedGrade(grade)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                    selectedGrade === grade ? 'bg-accent text-white' : 'border border-gray-200 bg-white text-gray-600 hover:border-accent'
                  }`}
                >
                  {gradeLabel(grade)}
                </button>
              ))}
            </div>

            {/* 「文言文」「品格教育」不是年級，用不同顏色＋「主題」標籤分開
                一排，四年級一眼看得出跟上面的年級不是同一種東西 */}
            {themeOptions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-400">主題</span>
                {themeOptions.map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => setSelectedGrade(theme)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                      selectedGrade === theme
                        ? 'bg-purple-600 text-white'
                        : 'border border-purple-200 bg-purple-50 text-purple-700 hover:border-purple-400'
                    }`}
                  >
                    {theme}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋課名…"
              className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="py-8 text-center text-gray-400">找不到符合的課，換個關鍵字或年級看看</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filtered.map((island) => (
                <IslandCard
                  key={island.storySlug}
                  island={island}
                  onOpen={() => navigate(`/lab/island/${island.storySlug}`)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default StudentArchipelagoPage;
