/**
 * ParagraphBlockView — renders a `paragraph` block as a numbered line + 注音.
 *
 * Numbered-line + zhuyin markup extracted from the legacy StoryTextCard
 * (ComprehensionLayout.tsx:174-203); reuses the shared `useZhuyin()` processor so
 * bopomofo behavior stays consistent across the app.
 *
 * #4044 (second finding from #4043's critic-agent review, 2026-11-13) —
 * CORRECTION: this file previously claimed `text` was not reachable from any
 * admin-writable path. That was wrong — an independent second review
 * (2026-11-14) found the actual path:
 *
 *   BlockRenderer → `<ParagraphBlockView text={block.text} />`
 *   `block` comes from `lesson.blocks`, and `lesson` is EITHER (a) the
 *   backend spotlight adapter (curriculum-only, unaffected) OR (b) the
 *   frontend `storyToLesson()` fallback built from `selectedStory.paragraphs`
 *   — `story["paragraphs"]` from `GET /api/stories/{id}`
 *   (`backend/app/routes/stories.py:get_story`), which reads
 *   `get_lesson_by_id()` (`backend/app/services/lesson_loader.py`).
 *
 *   `get_lesson_by_id()` has no DB session, but it DOES read the on-disk
 *   YAML uid tree (`backend/data/lessons/<uid>/<version>/lesson.yml`) — and
 *   `backend/app/routes/admin_stories.py`'s `create_story`/`update_story`
 *   (system_admin role) write `paragraphs` directly into that SAME tree, then
 *   call `_reload_lessons()` to bust the in-memory caches `get_lesson_by_id()`
 *   reads. So an admin-authored paragraph IS reachable here. The only
 *   sanitization on that write path is `sanitize_ai_input()`
 *   (`backend/app/services/input_sanitizer.py`) — a prompt-injection-phrase
 *   filter (strips strings like "ignore previous instructions"), NOT an HTML
 *   sanitizer; it leaves `<img>`/`onerror=` etc. completely untouched.
 *   (The DB-backed `texts` table from `teacher_texts.py` is still correctly
 *   NOT reachable here — that part of the original trace held.)
 *
 * The actual trigger for `dangerouslySetInnerHTML` (`isMarkup`, below) does
 * not require the attacker's own injected text to be touched by the zhuyin
 * processor — ANY other character in the same paragraph needing a
 * non-default reading (one common 破音字) is enough to route the WHOLE
 * line, injected payload included, through the unsanitized sink.
 *
 * Fixed: sanitize with `DOMPurify`, allowing ZERO tags/attributes (see
 * `safeMarkup` below) — confirmed safe to be this strict because
 * `buildZhuyinString` (`zhuyinStringBuilder.ts`) NEVER emits HTML markup: it
 * only ever copies each character through unchanged and optionally appends
 * one invisible Unicode variation-selector codepoint (U+E0100–U+E01EF) after
 * a character needing a non-default reading. Zero tags is what legitimate
 * output here ever needs. See `__tests__/ParagraphBlockView.test.tsx` for
 * the regression lock (red before this fix, green after) and a positive
 * control proving normal zhuyin text still renders.
 */
import React from 'react';
import DOMPurify from 'dompurify';
import { useZhuyin } from '../../../context/ZhuyinContext';

interface Props {
  text: string;
  /** 1-based line number badge (position within the lesson's paragraph run). */
  lineNumber?: number;
}

const ParagraphBlockView: React.FC<Props> = ({ text, lineNumber }) => {
  const { processZhuyin, zhuyinActive } = useZhuyin();
  const rendered = processZhuyin(text);
  const isMarkup = rendered !== text; // processor emitted ruby markup

  // #4044 — see file docstring. `rendered` is `text` (admin-writable, see
  // above) passed through a processor that never emits tags, so ALLOWED_TAGS
  // is deliberately empty: any `<...>` here can only be an injection, not
  // legitimate zhuyin output.
  const safeMarkup = isMarkup
    ? DOMPurify.sanitize(rendered, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
    : rendered;

  return (
    <div className="flex gap-3 items-start">
      {lineNumber != null && (
        <span className="text-xs font-headline font-bold text-on-surface-variant/30 pt-1 select-none shrink-0 w-5 text-right">
          {String(lineNumber).padStart(2, '0')}
        </span>
      )}
      <p
        className={`text-lg md:text-xl text-on-surface leading-[2rem] md:leading-[2.2rem] ${
          zhuyinActive ? 'tracking-[0.15em]' : ''
        }`}
        {...(isMarkup ? { dangerouslySetInnerHTML: { __html: safeMarkup } } : {})}
      >
        {isMarkup ? undefined : text}
      </p>
    </div>
  );
};

export default ParagraphBlockView;
