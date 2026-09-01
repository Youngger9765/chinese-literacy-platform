/**
 * difficultSpanRenderer.tsx
 *
 * Renders a zhuyin-processed line while keeping the zhuyin FONT scoped to only
 * the character runs that were actually selected by processLinesSelective()'s
 * 'difficult' mode (#3022).
 *
 * Background: BpmfZihiSerif / BpmfIansui is an IVS font that draws bopomofo
 * for EVERY character rendered in it, using the font's default reading when
 * no SS_MAPPING variant-selector codepoint follows a character. Applying that
 * font at the container level (as every call site used to do, gated only on
 * "is any zhuyin mode active") therefore annotates the whole subtree the
 * instant 'difficult' mode turns the font on -- including plain passage
 * characters processLinesSelective() never touched, and any interface text
 * (buttons, labels, hint banners) that happens to share the same container.
 *
 * 'all' mode is unaffected by this file: the whole line is meant to be
 * annotated, so callers keep applying the zhuyin font at the container level
 * for that mode. This module only matters for 'difficult' mode's per-run
 * output, which processLinesSelective() marks with DIFFICULT_SPAN_START/END
 * (see bopomoConstants.ts for why those specific codepoints are safe to
 * thread through the existing PUA-selector-aware pipeline).
 */
import React from 'react';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from './bopomoConstants';
import { ZHUYIN_FONT_STACK, SERIF_FONT_STACK } from '../../constants/fonts';

export interface DifficultSegment {
  /** Segment text with the sentinel markers already stripped. */
  text: string;
  /** True when this run should render in the zhuyin font. */
  difficult: boolean;
}

/**
 * Split a processLinesSelective('difficult') string into plain/difficult runs.
 *
 * Tolerant of a marker being cut off mid-string (see hasSpanStart below) so
 * callers that slice the string for other reasons (e.g. KeyPassageReading's
 * karaoke highlight, which cuts a line at a live playback position) can run
 * this on each half independently: a half that starts already "inside" a
 * span (no leading START) is treated as difficult from its first character
 * until the marker/end; a half that ends still "inside" a span (no trailing
 * END) is treated as difficult through to its last character.
 *
 * Pure function -- no React, easy to unit test and mutation-test in isolation.
 */
export function splitDifficultSegments(text: string): DifficultSegment[] {
  const segments: DifficultSegment[] = [];
  let cursor = 0;
  let inSpan = false;

  const push = (chunk: string, difficult: boolean) => {
    if (chunk.length === 0) return;
    // Merge with the previous segment when it has the same difficulty --
    // keeps output minimal and makes React keys/tests easier to reason about.
    const last = segments[segments.length - 1];
    if (last && last.difficult === difficult) {
      last.text += chunk;
    } else {
      segments.push({ text: chunk, difficult });
    }
  };

  while (cursor < text.length) {
    if (inSpan) {
      const endIdx = text.indexOf(DIFFICULT_SPAN_END, cursor);
      if (endIdx === -1) {
        // Cut off mid-span (e.g. a karaoke-highlight slice) -- the rest of
        // this string is still difficult.
        push(text.slice(cursor), true);
        break;
      }
      push(text.slice(cursor, endIdx), true);
      cursor = endIdx + DIFFICULT_SPAN_END.length;
      inSpan = false;
      continue;
    }

    const startIdx = text.indexOf(DIFFICULT_SPAN_START, cursor);
    const endIdx = text.indexOf(DIFFICULT_SPAN_END, cursor);

    // An END with no START before it in this substring is an orphaned
    // closer -- this string began life already "inside" a span (the other
    // half of a karaoke-highlight slice). Everything up to and including
    // that END is difficult.
    if (endIdx !== -1 && (startIdx === -1 || endIdx < startIdx)) {
      push(text.slice(cursor, endIdx), true);
      cursor = endIdx + DIFFICULT_SPAN_END.length;
      continue;
    }

    if (startIdx === -1) {
      push(text.slice(cursor), false);
      break;
    }

    push(text.slice(cursor, startIdx), false);
    cursor = startIdx + DIFFICULT_SPAN_START.length;
    inSpan = true;
  }

  return segments;
}

/** True when the text contains at least one difficult-span marker. */
export function hasDifficultSpans(text: string): boolean {
  return text.indexOf(DIFFICULT_SPAN_START) !== -1 || text.indexOf(DIFFICULT_SPAN_END) !== -1;
}

/**
 * Render a processLinesSelective('difficult') string as React nodes, with the
 * zhuyin font applied ONLY to the marked-difficult runs. Plain runs get an
 * explicit serif font too (rather than relying on ancestor inheritance) so
 * the result is correct regardless of what font the surrounding container
 * happens to use.
 */
export function renderDifficultAwareText(text: string, keyPrefix: string | number = 'seg'): React.ReactNode {
  const segments = splitDifficultSegments(text);
  if (segments.length === 0) return '';
  if (segments.length === 1 && !segments[0].difficult) {
    // Fast path: no markers at all -- just return plain text so callers that
    // concatenate the result with other plain strings/`Fragment` keys keep
    // behaving exactly like they did before this file existed.
    return segments[0].text;
  }
  return segments.map((seg, i) => (
    <span
      key={`${keyPrefix}-${i}`}
      style={{ fontFamily: seg.difficult ? ZHUYIN_FONT_STACK : SERIF_FONT_STACK }}
    >
      {seg.text}
    </span>
  ));
}

/**
 * Per-UTF-16-code-unit "is this character inside a marked run" flags, indexed
 * against the PUA-STRIPPED string (#3022).
 *
 * WHY: AnnotatedParagraph's annotated branch has to slice by raw character
 * offset, so it renders from stripPUASelectors(text) -- and that strip throws
 * the DIFFICULT_SPAN markers away along with the tone selectors, because they
 * live in the same Variation Selectors Supplement block. Before the container
 * font was narrowed to 'all', difficult-mode ruby still showed up there as
 * spillover from the page-wide font (i.e. the bug was covering for it). Narrow
 * the font without carrying the marker information across the strip and the
 * ruby disappears for the whole paragraph the instant the student marks one
 * word -- which is the main thing they do on that screen.
 *
 * Flags are per CODE UNIT, not per code point, so `flags.slice(a, b)` lines up
 * with `stripped.slice(a, b)` even when a character is outside the BMP.
 */
export function difficultFlagsByRawIndex(text: string): boolean[] {
  const flags: boolean[] = [];
  let inSpan = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Variation Selectors Supplement: high surrogate 0xDB40 + a low surrogate.
    // stripPUASelectors removes exactly this pair, so it must not take a slot.
    if (code === 0xdb40 && i + 1 < text.length) {
      const pair = text.slice(i, i + 2);
      if (pair === DIFFICULT_SPAN_START) inSpan = true;
      else if (pair === DIFFICULT_SPAN_END) inSpan = false;
      // Any other selector (a tone variant) is dropped without a flag too.
      i++; // consume the low surrogate
      continue;
    }
    flags.push(inSpan);
  }
  return flags;
}

/**
 * Render `text` with the zhuyin font on the code units whose flag is true.
 * `flags` must be aligned to `text` (see difficultFlagsByRawIndex).
 *
 * Emits no span at all when nothing is flagged, so 'none' and 'all' modes --
 * where there are never any markers -- render byte-identical to before.
 */
export function renderDifficultFlagged(
  text: string,
  flags: boolean[],
  key: string | number,
): React.ReactNode {
  if (!flags.some(Boolean)) return text;

  const out: React.ReactNode[] = [];
  let runStart = 0;
  const flush = (end: number, difficult: boolean) => {
    if (end <= runStart) return;
    const chunk = text.slice(runStart, end);
    out.push(
      difficult ? (
        <span key={`${key}-d${runStart}`} style={{ fontFamily: ZHUYIN_FONT_STACK }}>
          {chunk}
        </span>
      ) : (
        <React.Fragment key={`${key}-p${runStart}`}>{chunk}</React.Fragment>
      ),
    );
    runStart = end;
  };

  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || flags[i] !== flags[runStart]) {
      flush(i, flags[runStart] === true);
    }
  }
  return out;
}
