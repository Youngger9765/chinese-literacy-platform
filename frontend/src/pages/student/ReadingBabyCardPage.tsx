/**
 * ReadingBabyCardPage — `/student/reading-babies/:lessonUid`（#3780
 * reading-babies PRD §4「寶貝卡」）。
 *
 * 內容：這一課的主要能力（課綱代碼放小字）、技能清單、碎片收藏牆、下一步
 * 要去的站名＋建築、一鍵直達按鈕（game-design.md §4.2：直接用既有的
 * `world.travelTo()`——這裡不是在 3D 世界裡，所以做法是帶
 * `?focusStation=<station>` 導到該課的單課島頁，`ReadingIslandLab.tsx` 進頁
 * 時讀這個參數呼叫既有的 travelTo）。全部通過時顯示「這一課你都學會了」。
 *
 * 主要能力代碼與技能清單目前後端 API 沒有回傳（見
 * `readingBabyLessonSkills.ts` 檔頭說明），用前端這份靜態課綱資料補。
 *
 * G6 兒童適切文案：不出現升級／餵食／領取字樣。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchReadingBabyCard, type ReadingBabyCardResponse } from '../../services/readingBabyApi';
import { lessonSkillsFor } from '../../data/readingBabyLessonSkills';
import { storyIdForLesson } from '../../data/readingBabyStoryIds';

const ReadingBabyCardPage: React.FC = () => {
  const { lessonUid = '' } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [card, setCard] = useState<ReadingBabyCardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    if (!token || !user || !lessonUid) return;
    setError(null);
    try {
      const res = await fetchReadingBabyCard(user.id, lessonUid, token);
      setCard(res);
    } catch {
      setError('寶貝卡載入失敗，請重新整理再試一次');
    }
    // user?.id（不是整個 user 物件）——同 ReadingBabyAtlasPage 的理由，
    // 避免某些 useAuth() 呼叫端每次 render 回傳新物件參照造成無限 fetch。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id, lessonUid]);

  useEffect(() => { void load(); }, [load, attempt]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-6 text-center">
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

  if (!card) {
    return <p className="py-16 text-center text-gray-400">寶貝卡載入中…</p>;
  }

  const skillsData = lessonSkillsFor(card.lesson_uid);
  const fragmentPieces = Array.from({ length: card.fragments_count });

  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
      <button type="button" onClick={() => navigate('/student/reading-babies')} className="text-sm text-gray-500 hover:text-accent">
        ← 回圖鑑
      </button>

      <header>
        <h1 className="text-xl font-black text-gray-900">{card.title ?? card.lesson_uid}</h1>
        <p className="text-sm font-bold text-gray-700">
          主要能力：{card.ability_family_name ?? '未分類'}
          {skillsData?.primaryIndicatorCode && (
            <span className="ml-1 text-xs font-normal text-gray-400">（{skillsData.primaryIndicatorCode}）</span>
          )}
        </p>
      </header>

      {skillsData && skillsData.skills.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-bold text-gray-700">技能</h2>
          <ul className="flex flex-wrap gap-2">
            {skillsData.skills.map((s, i) => (
              <li key={`${s.indicator ?? i}-${i}`} className="rounded-full bg-accent-bg px-3 py-1 text-xs font-medium text-accent">
                {s.skill ?? s.indicator}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-sm font-bold text-gray-700">碎片收藏牆（{card.fragments_count} 片）</h2>
        <div data-testid="fragment-wall" className="flex flex-wrap gap-2">
          {fragmentPieces.length === 0 ? (
            <p className="text-xs text-gray-400">還沒有收集到碎片，去學習看看吧</p>
          ) : (
            fragmentPieces.map((_, i) => (
              <span
                key={i}
                data-testid="fragment-piece"
                aria-hidden="true"
                className="h-6 w-6 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 shadow-inner"
              />
            ))
          )}
        </div>
      </section>

      {card.all_cleared ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
          <p className="text-base font-bold text-amber-800">這一課你都學會了！</p>
          <button
            type="button"
            onClick={() => navigate('/student/archipelago')}
            className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover"
          >
            回群島看看其他課
          </button>
        </section>
      ) : card.next_step ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-bold text-gray-700">下一步</h2>
          <p className="text-sm text-gray-600">
            去「{card.next_step.building ?? card.next_step.station}」看看
          </p>
          {(() => {
            const storyId = storyIdForLesson(card.lesson_uid);
            if (!storyId) {
              // 待補對照表沒有這一課時，仍然告訴學生要去哪裡，只是不提供
              // 一鍵直達——比起整段消失（看起來像壞掉），誠實顯示缺口更好。
              return <p className="mt-3 text-xs text-gray-400">（這一課還不能一鍵直達，先從群島點進去吧）</p>;
            }
            return (
              <button
                type="button"
                onClick={() => navigate(`/lab/island/${storyId}?focusStation=${encodeURIComponent(card.next_step!.station)}`)}
                className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover"
              >
                一鍵直達
              </button>
            );
          })()}
        </section>
      ) : null}
    </div>
  );
};

export default ReadingBabyCardPage;
