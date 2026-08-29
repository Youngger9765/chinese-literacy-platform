
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { stepPath } from '../../config/stepPath';
import { useNavigate } from 'react-router-dom';
import { Story } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { fontForZhuyin } from '../../constants/fonts';
import { resolveActiveSteps } from '../../config/stepConfig';
import { useAuth } from '../../contexts/AuthContext';
import { getOmoImageSignedUrl, getPriorOmoUploadByLesson } from '../../services/omoApi';
import type { OmoPriorUploadResponse } from '../../services/omoApi';
import { downloadRemoteFile } from '../../utils/downloadRemoteFile';
import { gradeLabel } from '../../utils/gradeLabel';

/**
 * 「💡 本課學習策略」要顯示的字串，找不到就回空字串。
 *
 * ⚠️ 抽成獨立函式是為了測得到 —— 原本這段內聯在 JSX 的 IIFE 裡，
 * 測試只能在自己那邊重排一次同樣的判斷，那是打在複製品上：
 * 改壞這裡不會讓測試變紅。
 *
 * 鏈的順序有意義，不是隨手排的：
 *   1. `worksheetIntro.target_strategy` — Layer-1/2 欄位
 *   2. `intro.author` 的 " · " 後半      — 同上
 *   3. `goal_box.strategy_line`          — 學習單原文（**最權威**，逐字印在紙上）
 *   4. `readingStrategy`                 — 總表的策略名
 *
 * 前兩個是二修的 uid tree **從來不寫**的欄位。第三個只有 52 課有。
 * 所以在接上第四個之前，這個框對 175 課裡的 123 課是空的 ——
 * 而 `readingStrategy` 171 課都有值，`types.ts` 甚至標著
 * `// for future Intro enhancement`：欄位是為了這個框加的，加了之後沒接上。
 *
 * 3 排在 4 前面因為它是學習單上逐字印的那句；兩者內容其實一樣，只差前綴：
 *     readingStrategy        '讀出故事道理'
 *     goal_box.strategy_line '目標策略：讀出故事道理'
 */
export function resolveRawStrategy(story: {
  worksheetIntro?: { target_strategy?: string };
  intro?: { author?: string };
  goalBox?: { strategy_line?: string };
  readingStrategy?: string;
}): string {
  const goalBoxStrategy = story.goalBox?.strategy_line
    ? story.goalBox.strategy_line.replace(/^目標策略[:：]\s*/, '').replace(/\n/g, '，')
    : '';
  return (
    story.worksheetIntro?.target_strategy ||
    (story.intro?.author?.includes(' · ')
      ? story.intro.author.split(' · ').slice(1).join(' · ')
      : '') ||
    goalBoxStrategy ||
    story.readingStrategy ||
    ''
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  Fable: '寓言故事',
  Science: '自然科學',
  History: '歷史故事',
  Daily: '生活文化',
};

interface IntroProps {
  story: Story;
  onStartReading: () => void;
  onBack: () => void;
}

const Intro: React.FC<IntroProps> = ({ story, onStartReading, onBack }) => {
  const [showWorksheetModal, setShowWorksheetModal] = useState(false);
  const [showUploadedModal, setShowUploadedModal] = useState(false);
  const [priorUpload, setPriorUpload] = useState<OmoPriorUploadResponse | null>(null);
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const { token } = useAuth();
  const worksheetModalRef = useRef<HTMLDivElement>(null);
  const uploadedModalRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useFocusTrap(worksheetModalRef, showWorksheetModal);
  useFocusTrap(uploadedModalRef, showUploadedModal);

  /**
   * Issue #1637: navigate to /omo with lesson_code query param so OmoPage
   * can pass it as a hint to the backend (skip Gemini fuzzy-match).
   */

  const handleDownloadWorksheet = useCallback(async (url: string, ext: 'pdf' | 'docx') => {
    const filename = story.lesson_code ? `${story.lesson_code}.${ext}` : undefined;
    try {
      await downloadRemoteFile(url, filename);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [story.lesson_code]);

  const handleUploadWorksheet = useCallback(() => {
    const lessonCode = story.lesson_code ?? '';
    const params = lessonCode ? `?lesson_code=${encodeURIComponent(lessonCode)}` : '';
    navigate(`/omo${params}`);
  }, [navigate, story.lesson_code]);

  useEffect(() => {
    if (!showWorksheetModal && !showUploadedModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowWorksheetModal(false);
        setShowUploadedModal(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showUploadedModal, showWorksheetModal]);

  useEffect(() => {
    let cancelled = false;
    const lessonId = Number.parseInt(story.id, 10);
    setPriorUpload(null);

    if (!token || !story.lesson_code || !Number.isFinite(lessonId)) {
      return () => {
        cancelled = true;
      };
    }

    getPriorOmoUploadByLesson(lessonId, token)
      .then((data) => {
        if (!cancelled) {
          setPriorUpload(data.has_prior_upload ? data : null);
        }
      })
      .catch(() => {
        if (!cancelled) setPriorUpload(null);
      });

    return () => {
      cancelled = true;
    };
  }, [story.id, story.lesson_code, token]);

  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === worksheetModalRef.current) {
      setShowWorksheetModal(false);
    }
  }, []);

  const handleUploadedBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === uploadedModalRef.current) {
      setShowUploadedModal(false);
    }
  }, []);

  const handleOpenUploadedModal = useCallback(() => {
    setShowUploadedModal(true);
    if (!token || !priorUpload?.upload_id || priorUpload.images.length === 0) return;

    const uploadId = priorUpload.upload_id;
    void Promise.all(
      priorUpload.images.map(async (image) => {
        try {
          const signed = await getOmoImageSignedUrl(uploadId, image.attempt_id, image.index, token);
          return { ...image, url: signed.url ?? image.url ?? null };
        } catch {
          return image;
        }
      }),
    ).then((images) => {
      setPriorUpload((current) => (
        current?.upload_id === uploadId ? { ...current, images } : current
      ));
    });
  }, [priorUpload, token]);

  // #1598: 課文簡介 teaser. Never falls back to strategy/target text (which
  // would show "圖文題就是..." instead of the actual lesson topic).
  //
  // #2719: the #2607 "AI 朗讀全文 / 展開看全文" controls that used to sit under
  // this teaser were removed — reading and listening to the full lesson body
  // belongs to step 2「讀全文－做記號」(FullReading), and having it here too
  // duplicated that step and blurred what the intro page is for. The intro page
  // is now teaser + strategy + worksheet + step chips only; do NOT re-add a
  // full-text player here. (The pre-#2607 speechSynthesis button that narrated
  // this teaser is deliberately not restored either: PR #2608 verified 8/8
  // sampled lessons have no real course_intro, so the teaser is a hard-truncated
  // ~103-char slice of the lesson body that cuts off mid-word.)
  const introText = story.lessonIntro?.course_intro || story.intro?.background || '';

  return (
    <div
      className="flex-1 flex flex-col bg-amber-50 overflow-hidden"
      style={{
        fontFamily: fontForZhuyin(zhuyinActive),
      }}
    >

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

          {/* Hero: thumbnail + title */}
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
            {/* 二修的 175 課一張封面都沒有，`story.thumbnail` 是空字串 ——
                `<img src="">` 在瀏覽器裡就是一個破圖 icon，看起來像壞掉，
                而不是像「這課還沒有封面」。缺資料的狀態不要畫成錯誤狀態。
                上午修過圖書館列表（StoryCard），課內這個是第二處。 */}
            {story.thumbnail ? (
              <img
                src={story.thumbnail}
                alt={`《${story.title}》課文封面圖`}
                className="w-32 h-24 object-cover rounded-xl border border-gray-200 flex-shrink-0"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : null}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-accent-bg-subtle text-accent-hover border border-accent-bg-subtle uppercase tracking-widest">
                  {CATEGORY_LABEL[story.category] ?? story.category}
                </span>
                {/* #2082 A13: neutral level format — avoids "四年級" which feels
                    discouraging for older students. Mapping: story.level is
                    already a numeric level (e.g. 4), shown as 「第 N 級」.
                    Product-tunable: owner may prefer pure number or different label. */}
                <span className="text-[10px] text-gray-400">{gradeLabel(String(story.level))}</span>
              </div>
              <h1 className={`text-2xl font-normal text-on-surface ${zhuyinActive ? 'leading-[2.4rem] tracking-[0.15em]' : 'leading-[1.5]'}`}>
                {processZhuyin(story.title)}
              </h1>
              {/* #2139: genre/strategy subtitle removed here — replaced by the
                  prominent 本課學習策略 yellow box moved directly below the title. */}
            </div>
          </div>

          {/* 💡 本課學習策略 — #2139: moved here (directly below the title,
              replacing the old grey subtitle) so the strategy is prominent,
              not buried as a subtitle. Origins: #1598 + #2082 A2. */}
          {(() => {
            // #2082 A2: the strategy name source. worksheetIntro.target_strategy is empty
            // for the real lesson data (verified: all G6/G7 demo lessons), so fall back to
            // the strategy portion of story.intro.author, which holds e.g.
            // "說明文 · 摘要策略-問題.解決.結果結構". Take the part after the last " · " separator
            // (drops the genre prefix like 說明文) so the box highlights the strategy itself.
            //
            // #2752 Phase 2: neither of the two sources above is ever populated for the
            // uid-tree (v3) lessons — worksheetIntro/intro.author are Layer-1/2 fields
            // this pipeline never writes. `goal_box.strategy_line` is the actual worksheet
            // text this box was designed to show, printed verbatim as "目標策略：<text>"
            // (sometimes with an embedded `\n` mid-phrase, e.g. "寫作手法──\n排比─..." —
            // normalized to a comma so it reads as one line instead of a raw newline).
            const rawStrategy = resolveRawStrategy(story);
            // For structure-type strategies, wrap the three stage words in corner quotes and
            // keep 結構 outside, e.g. 〈「問題、解決、結果」結構〉. Matches ASCII '.', middot, hyphen,
            // and CJK separators (the demo data uses ASCII '.').
            const strategyName = rawStrategy.includes('「問題')
              ? rawStrategy
              : rawStrategy.replace(
                  /(問題)[.·\-．。,，、]?(解決)[.·\-．。,，、]?(結果)(結構)/,
                  '「$1、$2、$3」$4'
                );
            const hasBody = story.lessonIntro?.text && story.lessonIntro.source !== 'excel';
            if (!strategyName && !hasBody) return null;
            return (
            <div className="bg-amber-100/60 border-2 border-amber-300 rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden="true">💡</span>
                <span className="text-xs font-bold text-amber-800 uppercase tracking-widest">本課學習策略</span>
              </div>

              {/* goal_box.title (#2752 Phase 2) — a decorative unit tagline some
                  lessons print near the title (e.g. "閱讀之旅的起點"). Deliberately
                  NOT rendering goal_box.level_badge here — that's a "Level N・文體"
                  format already shown by the category/grade badges above the title,
                  so showing it again would just repeat the same information. */}
              {story.goalBox?.title && (
                <p className="text-sm text-amber-700 italic">{processZhuyin(story.goalBox.title)}</p>
              )}

              {strategyName && (
                // #2082 A2: prominent highlight box for strategy name
                <div className="bg-amber-200/70 border-2 border-amber-400 rounded-xl px-4 py-3">
                  <p className={`text-amber-900 text-xl font-bold ${zhuyinActive ? 'leading-[2.8rem] tracking-[0.25em]' : 'leading-[1.4]'}`}>
                    {processZhuyin(strategyName)}
                  </p>
                  {/* #2898 — the name alone is a 13-character label. Owner, seeing
                      「推論策略──推論代名詞」 and nothing else: 「就這麼短嗎？」
                      This is 2-3 sentences generated once per lesson and stored in
                      metadata.strategy_explained, grounded in this article rather
                      than in the strategy in the abstract. 160 of 175 lessons have
                      one; the rest keep the bare name, which is what the source has. */}
                  {story.readingStrategyExplained && (
                    <p className={`mt-2 text-amber-900/80 text-sm whitespace-pre-line ${zhuyinActive ? 'leading-[2.4rem] tracking-[0.15em]' : 'leading-[1.8]'}`}>
                      {processZhuyin(story.readingStrategyExplained)}
                    </p>
                  )}
                </div>
              )}

              {story.lessonIntro?.text && story.lessonIntro.source !== 'excel' && (
                <p className={`text-amber-800 ${zhuyinActive ? 'text-base leading-[2.4rem] tracking-[0.2em]' : 'text-sm leading-[1.7]'}`}>
                  {processZhuyin(story.lessonIntro.text)}
                </p>
              )}
              {/* #2082 A2: instructions (▷ triangle items) removed from intro page —
                  they belong to the read-text phase (ParagraphReading / annotations), not intro. */}
            </div>
            );
          })()}

          {/* 知識補給站 YouTube embed was removed — intro page shows course intro only */}

          {/* 紙本學習單 PDF button (#1444) + 上傳學習單 button (#1637) */}
          {(story.worksheetPdfUrl || story.worksheetDocxUrl || story.lesson_code) && (
            <div className="flex flex-wrap items-center gap-2">
              {/* PDF first — mobile Quick Look cannot render complex docx text boxes */}
              {story.worksheetPdfUrl ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowWorksheetModal(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
                    aria-label="查看紙本學習單 PDF"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    查看紙本學習單
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleDownloadWorksheet(story.worksheetPdfUrl!, 'pdf'); }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1"
                    aria-label="下載紙本學習單 PDF"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    下載 PDF
                  </button>
                  {/* #2422 教授 6/5 #15：Word + PDF 同時上架讓老師自選（docx 已上 GCS，先前被 PDF 分支吞掉拿不到）*/}
                  {story.worksheetDocxUrl && (
                    <button
                      type="button"
                      onClick={() => { void handleDownloadWorksheet(story.worksheetDocxUrl!, 'docx'); }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-1"
                      aria-label="下載紙本學習單 Word"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      下載 Word
                    </button>
                  )}
                </>
              ) : story.worksheetDocxUrl ? (
                <button
                  type="button"
                  onClick={() => { void handleDownloadWorksheet(story.worksheetDocxUrl!, 'docx'); }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
                  aria-label="下載紙本學習單"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  下載紙本學習單
                </button>
              ) : null}

            </div>
          )}

          {/* 課文簡介 — #1598: only uses lessonIntro.course_intro (AI/PDF generated)
              or intro.background fallback. No longer falls back to strategy
              content (which used to leak into 課文簡介 and confuse students). */}
          {(() => {
            if (!introText) {
              return (
                <div className="bg-surface-container-low border border-gray-200 rounded-2xl p-6 text-gray-500 text-sm">
                  這篇課文目前沒有簡介資料。
                </div>
              );
            }

            const sourceLabel = story.lessonIntro?.course_intro_source?.startsWith('ai-generated')
              ? `資料來源：AI 生成（${story.lessonIntro.course_intro_source.replace('ai-generated-', '')}）`
              : null;

            return (
              <div className="bg-surface-container-low border border-gray-200 rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-xs font-bold text-accent-light uppercase tracking-widest">課文簡介</span>
                </div>
                <p className={`text-on-surface text-2xl ${zhuyinActive ? 'leading-[2.4rem] tracking-[0.15em]' : 'leading-[1.6]'}`}>
                  {processZhuyin(introText)}
                </p>

                {sourceLabel && (
                  <p className="text-xs text-on-surface-variant">{sourceLabel}</p>
                )}
              </div>
            );
          })()}

          {/* 導讀 (#2752) — 文言文 lessons carry their own worksheet 導讀 paragraph
              (`intro_guide.yml`, no big-question number, printed under the title).
              This is DIFFERENT content from 課文簡介 above (that's an AI/PDF teaser
              of the lesson body; 導讀 is the worksheet author's own framing of the
              story) — shown as its own box, and only for the 4 lessons that have
              one (`story.introGuide` is undefined for every other lesson). */}
          {story.introGuide?.text && (
            <div className="bg-surface-container-low border border-gray-200 rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-lg text-accent-light" aria-hidden="true">auto_stories</span>
                <span className="text-xs font-bold text-accent-light uppercase tracking-widest">
                  {story.introGuide.section_name || '導讀'}
                </span>
              </div>
              <p className={`text-on-surface text-base ${zhuyinActive ? 'leading-[2.2rem] tracking-[0.15em]' : 'leading-[1.7]'}`}>
                {processZhuyin(story.introGuide.text)}
              </p>
            </div>
          )}

          {/* #2139: 本課學習策略 yellow box relocated above (directly below title). */}

          {/* 數位學習步驟 — #2196: clickable step chips (quick-jump shortcut).
              #2082 A4 removed the non-clickable ol — do NOT restore a static ol.
              This uses chip badges so each step is directly accessible. */}
          {(() => {
            const digitalSteps = resolveActiveSteps(story.stepSequence).filter(s => s.id !== 'lesson-intro');
            if (digitalSteps.length === 0) return null;
            return (
              <div className="space-y-2 pb-2">
                <p className="text-xs text-gray-400 text-center">
                  {/* 這份清單**不含**課程簡介本身（人就在這頁，連過去沒意義），所以它不是
                      「本課的步驟總數」—— 底部進度條數的是含簡介的 N+1。原本寫「本課共 N 個步驟」，
                      學生會看到「共 10 個步驟」配上「第 11 步」，兩個數字互相打架。 */}
                  接下來還有 {digitalSteps.length} 個步驟，點擊可快速跳轉
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {digitalSteps.map((step, idx) => (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => navigate(stepPath(story.id, step.id))}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 bg-white hover:border-accent hover:text-accent hover:bg-accent/5 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
                      aria-label={`跳轉到第 ${idx + 1} 步：${step.label}`}
                    >
                      <span className="w-4 h-4 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      {step.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

        </div>
      </div>

      {/* Bottom action — #2082 A3: 開始學習 promoted to large primary CTA,
          返回圖書館 demoted to a secondary text link */}
      <div className="flex-shrink-0 bg-surface-container-lowest border-t border-gray-200 px-6 py-4 flex flex-col sm:flex-row items-center gap-3">
        {/* Primary CTA — full-width on mobile, min-height ~56px */}
        <button
          type="button"
          onClick={onStartReading}
          className="w-full sm:flex-1 min-h-[56px] rounded-2xl font-bold text-lg bg-accent hover:bg-accent-hover text-white shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          開始學習
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {/* Secondary — clearly less prominent */}
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-700 transition-colors underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 rounded"
        >
          返回圖書館
        </button>
      </div>

      {/* 紙本學習單 PDF Modal (#1444) */}
      {showWorksheetModal && story.worksheetPdfUrl && (
        <div
          ref={worksheetModalRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="紙本學習單"
          onClick={handleBackdropClick}
        >
          <div className="relative flex flex-col bg-white w-full h-full sm:rounded-2xl sm:max-w-4xl sm:h-[90vh] shadow-2xl overflow-hidden">
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 sm:rounded-t-2xl">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm font-bold text-gray-700 flex-shrink-0">紙本學習單</span>
                <span className="text-xs text-gray-400 hidden sm:inline truncate">— {story.title}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* #2087: download button inside modal header */}
                <button
                  type="button"
                  onClick={() => { void handleDownloadWorksheet(story.worksheetPdfUrl!, 'pdf'); }}
                  className="p-1.5 rounded-full hover:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                  aria-label="下載學習單 PDF"
                  title="下載 PDF"
                >
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setShowWorksheetModal(false)}
                  className="p-1.5 rounded-full hover:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                  aria-label="關閉學習單"
                >
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <iframe
              src={story.worksheetPdfUrl}
              title="紙本學習單"
              className="flex-1 w-full bg-gray-100"
            />
          </div>
        </div>
      )}

      {showUploadedModal && priorUpload?.has_prior_upload && (
        <div
          ref={uploadedModalRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="已上傳學習單"
          onClick={handleUploadedBackdropClick}
        >
          <div className="relative flex flex-col bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-800">已上傳學習單</p>
                <p className="text-xs text-gray-400 truncate">{story.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadedModal(false)}
                className="p-1.5 rounded-full hover:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 flex-shrink-0"
                aria-label="關閉已上傳學習單"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto p-4">
              {priorUpload.images.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {priorUpload.images.map((image) => (
                    <div
                      key={`${image.attempt_id}-${image.index}`}
                      className="aspect-[3/4] rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center"
                    >
                      {image.url ? (
                        <img
                          src={image.url}
                          alt={`已上傳學習單第 ${image.index + 1} 張`}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className="px-3 text-center text-xs text-gray-400">
                          圖片暫時無法預覽
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-sm text-gray-400">
                  目前沒有可預覽的圖片
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Intro;
