/**
 * ReadingBabyAtlasPage — `/student/reading-babies`（#3780 reading-babies
 * PRD §3「圖鑑頁：179 格」，取代 v1 WordBabiesLab 的唯一寶貝圖鑑入口）。
 *
 * 179 格依教授課程地圖家族分組——直接讀 API 回的 `ability_family`（#3780
 * 第三階段起後端已改成教授家族，跟寶貝卡同一個欄位）；
 * readingBabyProfessorFamilies.ts 只拿來決定家族的顯示順序。
 *
 * 每格顯示：階段（基礎／中階／進階）、碎片數、還沒遇見的狀態（灰階、
 * `aria-disabled`、點了不會導頁）。全部通過時改顯示「這一課你都學會了」
 * 由寶貝卡負責，這裡圖鑑格只顯示階段本身。
 *
 * G6 兒童適切文案：不出現升級／餵食／領取字樣——這裡只講「遇見」「長大」
 * 「學會了」。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchReadingBabyAtlas, type ReadingBabyLessonGrowth } from '../../services/readingBabyApi';
import { PROFESSOR_FAMILY_ORDER } from '../../data/readingBabyProfessorFamilies';
import ReadingBabyAvatar from '../../components/readingBaby/ReadingBabyAvatar';

const STAGE_LABEL: Record<ReadingBabyLessonGrowth['stage'], string> = {
  not_encountered: '還沒遇見',
  basic: '基礎',
  intermediate: '中階',
  advanced: '進階',
};

const STAGE_BADGE_CLASS: Record<ReadingBabyLessonGrowth['stage'], string> = {
  not_encountered: 'bg-gray-100 text-gray-400 border-gray-200',
  basic: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  intermediate: 'bg-sky-50 text-sky-700 border-sky-200',
  advanced: 'bg-amber-50 text-amber-700 border-amber-300',
};

const ReadingBabyCell: React.FC<{ baby: ReadingBabyLessonGrowth; onOpen: () => void }> = ({ baby, onOpen }) => {
  const unseen = baby.stage === 'not_encountered';
  return (
    <button
      type="button"
      data-testid={`reading-baby-cell-${baby.lesson_uid}`}
      aria-disabled={unseen}
      onClick={() => { if (!unseen) onOpen(); }}
      className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center shadow-sm transition-all ${
        unseen
          ? 'cursor-default border-gray-100 bg-gray-50 opacity-60'
          : 'border-gray-200 bg-white hover:-translate-y-0.5 hover:border-accent hover:shadow-md'
      }`}
    >
      <ReadingBabyAvatar lessonUid={baby.lesson_uid} stage={baby.stage} name={baby.title} size={84} />
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${STAGE_BADGE_CLASS[baby.stage]}`}>
        {STAGE_LABEL[baby.stage]}
      </span>
      <span className={`text-sm font-bold ${unseen ? 'text-gray-400' : 'text-gray-900'}`}>
        {unseen ? '？？？' : baby.title ?? baby.lesson_uid}
      </span>
      {!unseen && (
        <span className="text-xs text-gray-500">碎片 {baby.fragments_count} 片</span>
      )}
    </button>
  );
};

const ReadingBabyAtlasPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [babies, setBabies] = useState<ReadingBabyLessonGrowth[] | null>(null);
  const [totalLessons, setTotalLessons] = useState<number | null>(null);
  const [totalFragments, setTotalFragments] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    if (!token || !user) return;
    setError(null);
    try {
      const res = await fetchReadingBabyAtlas(user.id, token);
      setBabies(res.babies);
      setTotalLessons(res.total_lessons);
      setTotalFragments(res.total_fragments);
    } catch {
      // #3780 PRD §2 修的那個 bug 的反面教訓：讀取失敗要能重試，不能永遠
      // 停在「載入中」（舊 v1 badge 曾經這樣壞掉）。
      setError('閱讀寶貝圖鑑載入失敗，請重新整理再試一次');
    }
    // `user?.id` 不是 `user`（整個物件）——沿用 StudentArchipelagoPage.tsx
    // `refreshProgress` 既有的寫法：`useAuth()` 若在某些呼叫端每次 render
    // 回傳新的物件參照，整個物件放進 deps 會讓這個 callback 每次 render
    // 都換身分，effect 跟著每次重跑，變成無限 fetch 迴圈。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id]);

  useEffect(() => { void load(); }, [load, attempt]);

  const grouped = useMemo(() => {
    if (!babies) return [];
    const byFamily = new Map<string, { name: string; babies: ReadingBabyLessonGrowth[] }>();
    for (const baby of babies) {
      const family = baby.ability_family ?? 'AI00';
      if (!byFamily.has(family)) byFamily.set(family, { name: baby.ability_family_name ?? family, babies: [] });
      byFamily.get(family)!.babies.push(baby);
    }
    const rank = (code: string) => {
      const i = PROFESSOR_FAMILY_ORDER.indexOf(code);
      return i === -1 ? PROFESSOR_FAMILY_ORDER.length : i;
    };
    return Array.from(byFamily.entries())
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([code, group]) => ({
        code,
        name: group.name,
        babies: group.babies.sort((a, b) => a.lesson_uid.localeCompare(b.lesson_uid)),
      }));
  }, [babies]);

  const encounteredCount = useMemo(
    () => (babies ? babies.filter((b) => b.stage !== 'not_encountered').length : 0),
    [babies],
  );

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <p className="mb-4 text-red-600">{error}</p>
        <button
          type="button"
          onClick={() => setAttempt((a) => a + 1)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover"
        >
          重新載入
        </button>
      </div>
    );
  }

  if (babies === null || totalLessons === null) {
    return <p className="py-16 text-center text-gray-400">閱讀寶貝圖鑑載入中…</p>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-black text-gray-900">閱讀寶貝圖鑑</h1>
        <p className="text-sm text-gray-500">
          已遇見 {encounteredCount} / {totalLessons} 隻 · 碎片收藏 {totalFragments ?? 0} 片
        </p>
        <p className="mt-1 text-xs text-gray-400">課綱分類為草稿，待老師審核</p>
      </header>

      {grouped.map((group) => (
        <section key={group.code} aria-labelledby={`family-${group.code}`}>
          <h2 id={`family-${group.code}`} className="mb-2 text-sm font-bold text-gray-700">
            {group.name}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {group.babies.map((baby) => (
              <ReadingBabyCell
                key={baby.lesson_uid}
                baby={baby}
                onOpen={() => navigate(`/student/reading-babies/${baby.lesson_uid}`)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default ReadingBabyAtlasPage;
