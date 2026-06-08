/**
 * annotationOffsets.ts
 *
 * Pure helpers for computing raw-character offsets in paragraphs that may
 * contain BpmfIansui PUA Variation Selector surrogate pairs.
 *
 * Extracted from ReadingAnnotation.tsx as part of #1855 refactor.
 */

/**
 * Strip BpmfIansui PUA Variation Selector surrogate pairs from a string.
 *
 * Both buildZhuyinString() and some YAML lesson files embed PUA Variation
 * Selectors Supplement (U+E0100–U+E01EF) directly in the paragraph text.
 * Each occupies 2 UTF-16 code units (surrogate pair: 0xDB40 + 0xDD00–0xDDEF).
 * These have no semantic content — they are font rendering hints only.
 * Stripping them gives a string where .length equals the raw character count,
 * so standard Array/String slice operations work correctly with raw char indices.
 */
export function stripPUASelectors(text: string): string {
  return text.replace(/\uDB40[\uDC00-\uDFFF]/g, '');
}

/**
 * Count raw (non-selector) characters in a string, stopping after `upTo`
 * UTF-16 code units have been consumed.  When `upTo` is omitted the entire
 * string is scanned.
 *
 * BpmfIansui uses Unicode Variation Selectors Supplement (U+E0100–U+E01EF)
 * to select polyphonic-character pronunciation variants.  buildZhuyinString()
 * appends one of U+E01E1–U+E01E5 after each non-default character.  These
 * code points are above U+FFFF so each occupies 2 UTF-16 code units (a
 * surrogate pair).  The browser's Selection API reports offsets in UTF-16
 * code units, so without correction the reported charStart is inflated by
 * 2 × (number of PUA selectors before the selection point).
 *
 * This helper strips those selectors so we always get an index into the
 * original raw paragraph text.
 */
export function countRawChars(text: string, upTo?: number): number {
  // PUA range used by BpmfIansui variant selectors: U+E0100–U+E01EF.
  // In UTF-16 these are the surrogate pair: high D83C + low DC00..DCEF.
  const limit = upTo ?? text.length;
  let rawCount = 0;
  let i = 0;
  while (i < limit) {
    const code = text.charCodeAt(i);
    // High surrogate of the PUA Variation Selectors Supplement block
    // U+E0100–U+E01EF encodes as high surrogate 0xDB40 + low 0xDD00–0xDDEF.
    if (code === 0xDB40 && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xDD00 && low <= 0xDDEF) {
        // This is a PUA selector — skip both code units, don't count
        i += 2;
        continue;
      }
    }
    rawCount++;
    i++;
  }
  return rawCount;
}

export interface SelectionInfo {
  paragraphIndex: number;
  charStart: number;
  charEnd: number;
  rect: DOMRect;
}

/**
 * Returns true when a node is inside a <rt> element (ruby pronunciation text).
 * BpmfIansui renders zhuyin purely via CSS font features, so <rt> is only present
 * when the page uses HTML ruby markup. We always skip <rt> content so that
 * phonetic annotations never inflate char offsets.
 */
function isInsideRt(node: Node): boolean {
  let cur: Node | null = node.parentNode;
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    if ((cur as Element).tagName === 'RT') return true;
    cur = cur.parentNode;
  }
  return false;
}

/**
 * Given a Selection that spans inside a paragraph <p data-para-idx="N">,
 * compute character offsets into the raw paragraph text.
 * Returns null if selection is empty or crosses paragraph boundaries.
 *
 * Bug fix (#2154): Added <rt> exclusion so ruby phonetic text nodes never
 * contribute to the raw-character offset accumulation. Also tightened the
 * paragraph identity check so selection offset is computed relative to
 * the exact [data-para-idx] container that owns the selection start.
 */
export function getSelectionInfo(): SelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;

  // Find the [data-para-idx] paragraph element that contains each selection
  // boundary. Walk up from the selection container node itself (not just its
  // parentElement) so that offset computation starts from the right <p>.
  const startNode = range.startContainer;
  const endNode   = range.endContainer;

  const startEl = (startNode.nodeType === Node.ELEMENT_NODE
    ? (startNode as Element)
    : startNode.parentElement
  )?.closest('[data-para-idx]') as HTMLElement | null;

  const endEl = (endNode.nodeType === Node.ELEMENT_NODE
    ? (endNode as Element)
    : endNode.parentElement
  )?.closest('[data-para-idx]') as HTMLElement | null;

  if (!startEl || !endEl) return null;

  // Must be same paragraph
  const paraIdxStr = startEl.getAttribute('data-para-idx');
  if (!paraIdxStr || startEl !== endEl) return null;

  const paragraphIndex = parseInt(paraIdxStr, 10);
  const paraEl = startEl;

  // Compute char offsets relative to the original paragraph text.
  // Walk text nodes with a TreeWalker to get the actual character offset from
  // the Range, so duplicate text in the same paragraph is handled correctly.
  const selectedText = range.toString();
  if (!selectedText.trim()) return null;

  // Walk all text nodes inside the paragraph to find where range.startContainer
  // sits and accumulate the character offset up to range.startOffset.
  //
  // Rules:
  // 1. Skip text nodes inside <rt> (HTML ruby phonetic text) — these are never
  //    part of the raw paragraph text and must not inflate offsets.
  // 2. When zhuyin is active, text nodes may contain BpmfIansui PUA variant
  //    selectors (U+E01E1–U+E01E5, stored as surrogate pairs = 2 UTF-16 units
  //    each). countRawChars() strips them so stored indices always refer to
  //    raw-text positions.
  let charStart = 0;
  let found = false;
  const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    // Skip phonetic ruby text — its characters are not part of the raw content.
    if (isInsideRt(node)) continue;

    if (node === range.startContainer) {
      // range.startOffset is a UTF-16 offset into this text node; convert to
      // raw-character count by stripping PUA selectors up to that point.
      charStart += countRawChars(node.textContent ?? '', range.startOffset);
      found = true;
      break;
    }
    // Accumulate raw (non-selector) character count for completed nodes.
    charStart += countRawChars(node.textContent ?? '');
  }
  if (!found) return null;

  // selectedText from range.toString() also includes PUA selector code points;
  // strip them to get the raw character count of the selection.
  const rawSelectedLength = countRawChars(selectedText);
  const charEnd = charStart + rawSelectedLength;

  if (charStart >= charEnd) return null;

  const rect = range.getBoundingClientRect();
  return { paragraphIndex, charStart, charEnd, rect };
}
