/**
 * GuestReadingPage — 讀全文-做記號 for a visitor with no account (#2649).
 *
 * A student scans a QR code printed on a paper worksheet. The QR points at
 * /learn/{id}/full-text-annotate, they have never logged in, and if that URL
 * just showed them a password box the code would be pointless. So they get the
 * lesson text and the whole-lesson audio, and nothing that writes.
 *
 * Why this is a separate page rather than the normal shell with things hidden:
 * the authenticated shell opens a DB learning session on mount. Mounting it
 * without a user fires authenticated calls that 401 and leaves a half-built
 * session behind. This page talks to two endpoints, both verified public:
 *
 *   GET /api/stories/{id}   → 200 (8.6 KB) anonymous
 *
 * Annotating stays behind the login wall — a mark has to belong to somebody.
 * The invitation to log in is right there, so the path onward is one tap.
 *
 * The audio is deliberately NOT a separate source. An earlier version played a
 * pre-generated whole-lesson mp3 here, and the two paths drifted apart within
 * days: that file predated a pronunciation fix and, as it turned out, held the
 * key passage rather than the whole text. Owner, hearing the difference: 「全文
 * 朗讀的登錄的前後那個用的音怎麼不一樣啊」. Both paths now use the same
 * paragraph walk over the same canonical sentences, so there is nothing left to
 * drift.
 */
import React, { useEffect, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';

import ReadingAnnotation from '../components/reading-steps/FullTextAnnotate';
import { resolveStepId, moduleForStep } from '../config/stepConfig';
import { deliversFullText } from '../components/qr/lessonQr';
import { fetchStory, storyForStep } from '../services/api';
import { sectionSlugForStep } from '../config/roundScope';
import type { Story } from '../types';

const GuestReadingPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  // The step is NOT a route param here. The gate that renders this page sits on
  // /learn/:storyId, so the step is the third path segment — read it from the
  // location, exactly as LearningRouteGate does when deciding to render us.
  const loc = useLocation();
  const step = loc.pathname.split('/')[3] ?? '';
  // 一課多篇時，QR 用 `?p=` 說明掃的是哪一節（#2916）。
  //
  // ⚠️ 這一段本來不存在，而它的缺席在**每一項機器檢查底下都是綠的**：
  //    資料層對、API 回應對、頁面打得開、0 pageerror。
  //    2026-08-25 用真瀏覽器走 QR 那條路才看到 —— L0063 三篇的讀全文
  //    掃出來逐字相同（各 2822 字元）。輪次切換做在 LearningLayout 上，
  //    而掃 QR 進來的人是**未登入的訪客**，根本不經過那一層。
  const roundSlug = new URLSearchParams(loc.search).get('p') || '';
  const [story, setStory] = useState<Story | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!storyId) return;
    let cancelled = false;
    setFailed(false);
    fetchStory(storyId)
      .then((s) => {
        if (!cancelled) setStory(s);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storyId]);

  if (failed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-surface">
        <p className="text-lg text-on-surface-variant">找不到這一課</p>
        <Link to="/login" className="text-accent underline">
          回到登入
        </Link>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <p className="text-on-surface-variant">載入中…</p>
      </div>
    );
  }

  // The worksheet carries two codes and they must not show the same thing.
  // 段落 shows only the 念順順 passage; 全文 shows the lesson. When a lesson has
  // no passage recorded, the passage code falls back to the whole text rather
  // than showing an empty page.
  // QR 要印**這一節自己的**代號。多篇課從 `?p=` 拿；單篇課網址沒有 `?p=`，
  // 從帳本拿（`manifestSections`）—— 不然 170 課的 QR 全部退回長網址。
  const qrSectionSlug = sectionSlugForStep(
    story.manifestSections, roundSlug ? `${resolveStepId(step)}#${roundSlug}` : resolveStepId(step),
    moduleForStep,
  );
  const wantsPassage = resolveStepId(step) === 'key-passage-reading';
  // 先換成這一節所屬的那一篇，再決定要顯示全文還是重點段 ——
  // 順序不能反：反過來的話重點段仍然取自第 1 篇。
  const scoped = roundSlug
    ? (storyForStep(story, `${resolveStepId(step)}#${roundSlug}`) ?? story)
    : story;
  const passage = scoped.keyReading?.passage?.trim();
  const shown: Story =
    wantsPassage && passage ? { ...scoped, content: [passage] } : scoped;

  return (
    <div className="min-h-screen bg-surface" data-testid="guest-reading-page">
      {/* Top bar — the player lives here so it stays reachable while reading. */}
      <div className="sticky top-0 z-30 backdrop-blur bg-surface/85 border-b border-outline-variant/20">
        <div className="max-w-4xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-headline font-bold text-lg text-on-surface truncate">
              {story.title}
            </h1>
            <p className="text-xs text-on-surface-variant">
              {wantsPassage && passage ? '重點段落朗讀' : '課文朗讀'}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/login"
              className="text-sm font-medium text-accent whitespace-nowrap hover:underline"
            >
              登入做記號
            </Link>
          </div>
        </div>
      </div>

      {/* #2886: this page stands in for BOTH steps, so it — not the component —
          decides which code to offer. Passing nothing gave the 全文 code on the
          重點 page. Same rules as the signed-in pages: 全文 only for the grades
          the spec gives one to, 重點 only where a 念順順段 exists. */}
      <ReadingAnnotation
        // 掃 QR 進來的人走這一頁 —— 頁面上那顆 QR 按鈕也要印短網址（#2916）。
        // ⚠️ 這個 prop 漏了三次都是同一個原因：訪客路徑不經過 LearningLayout，
        //    所以每次「登入端修好了」都不等於這裡修好了。
        //    單篇課的網址沒有 `?p=`，所以退回用 story 帶的代號。
        sectionSlug={qrSectionSlug}
        story={shown}
        // 這一頁顯示的是重點段，不是課文 —— 用課號定址會唸出課文第一段（#2930）
        disableCanonicalMapping={Boolean(wantsPassage && passage)}
        onFinish={() => {}}
        hideAnnotation
        qrStep={
          wantsPassage
            ? (passage ? 'key-passage-reading' : null)
            : (deliversFullText(story.grade) ? 'full-text-annotate' : null)
        }
      />
    </div>
  );
};

export default GuestReadingPage;
