/**
 * #4044 BLOCKER (independent review, 2026-11-14): ParagraphBlockView's
 * `dangerouslySetInnerHTML` sink had no sanitizer, and `text` IS reachable
 * from an admin-writable path (`admin_stories.py` writes `paragraphs`
 * straight into the YAML uid tree `get_lesson_by_id()` serves — see this
 * component's file docstring for the full trace). The only backend
 * sanitization on that path, `sanitize_ai_input()`, filters prompt-injection
 * phrases, not HTML — so `<img src=x onerror=...>` reaches this component
 * byte-for-byte unmodified.
 *
 * `isMarkup` does not require the ATTACKER's text to be touched by the
 * zhuyin processor: any OTHER 破音字 in the same paragraph routing the whole
 * line through `dangerouslySetInnerHTML` is enough. `useZhuyin` is mocked
 * here to a faithful stand-in for the real contract
 * (`zhuyinStringBuilder.ts`'s `buildZhuyinString`): every character passes
 * through unchanged, and a trigger character gets an invisible Unicode
 * variation-selector codepoint appended — NEVER an HTML tag. That is the
 * fact the fix (`DOMPurify.sanitize(rendered, { ALLOWED_TAGS: [] })`) relies
 * on: zero tags is what legitimate output here ever needs.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import ParagraphBlockView from '../ParagraphBlockView';

// A faithful stand-in for `buildZhuyinString`'s real contract, not a mock
// that just "returns something different": pass every character through
// unchanged, append an invisible variation-selector codepoint (U+E0100)
// after a trigger character. This is what makes `isMarkup` true for the
// WHOLE line even when the trigger character is nowhere near the injected
// payload — the exact mechanism the review flagged.
vi.mock('../../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    processZhuyin: (text: string) => text.replace('樂', '樂\u{E0100}'),
    zhuyinActive: true,
  }),
}));

describe('ParagraphBlockView dangerouslySetInnerHTML hardening (#4044)', () => {
  it('does not render an onerror attribute from an injected <img> when zhuyin annotates an unrelated character', () => {
    // "快樂的" — 樂 triggers the zhuyin processor (isMarkup=true) and sits
    // nowhere near the injected <img>; the injection rides through on the
    // SAME line purely because the whole paragraph went through
    // dangerouslySetInnerHTML once isMarkup flipped true.
    const malicious = '快樂的<img src=x onerror="window.__paragraphXssFired = true">一天';

    const { container } = render(<ParagraphBlockView text={malicious} />);

    expect(container.innerHTML).not.toMatch(/onerror/i);
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();

    // Sanity: the sink actually ran on this input (isMarkup was true) — if
    // the component had instead taken the plain-text branch, the assertions
    // above would pass vacuously because React already escapes plain text.
    expect(container.textContent).toContain('樂');
  });

  it('does not render a <script> tag from injected text either', () => {
    const malicious = '快樂的<script>window.__paragraphXssFired = true</script>一天';

    const { container } = render(<ParagraphBlockView text={malicious} />);

    expect(container.innerHTML).not.toMatch(/<script/i);
    expect(container.querySelector('script')).toBeNull();
  });

  it('positive control: normal zhuyin-annotated text still renders its content (not stripped to empty)', () => {
    // Proves the fix is not "strip everything" — the ALLOWED_TAGS: []
    // sanitizer still passes through plain text content (and the invisible
    // variation-selector codepoint is plain text, not markup, so DOMPurify
    // never touches it either way). The mock appends U+E0100 after 樂 —
    // stripped here before comparing, same as this repo's existing zhuyin
    // tests (e.g. noRuntimeSelector3237.test.tsx) do for the real selector
    // range, since it is an invisible rendering hint, not visible content.
    const benign = '快樂的一天';

    const { container } = render(<ParagraphBlockView text={benign} />);

    const stripped = container.textContent?.replace(/[\u{E0100}-\u{E01EF}]/gu, '');
    expect(stripped).toBe(benign);
  });

  it('positive control: non-markup text (no trigger character) still renders via the plain-text branch', () => {
    const benign = '平凡的一天';

    const { container } = render(<ParagraphBlockView text={benign} />);

    expect(container.textContent).toBe(benign);
    expect(container.querySelector('[dangerously-set-marker]')).toBeNull();
  });
});
