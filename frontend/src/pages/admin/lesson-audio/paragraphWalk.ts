/**
 * The state of a whole-lesson playback walk.
 *
 * Split out of LessonAudioTable for one reason: the walk used to hold only the
 * story *id*, so advancing to the next paragraph meant re-fetching the entire
 * story detail to find out what the next paragraph said. The text does not
 * change while a lesson is playing, so that round trip was pure silence — once
 * per paragraph, every paragraph.
 *
 * Holding the paragraphs here removes the fetch and, just as importantly, makes
 * the next paragraph's text available *during* the current one, which is what
 * lets the caller prefetch across the boundary.
 */

export interface ParagraphWalk {
  storyId: number;
  /** Index of the paragraph to play next. */
  next: number;
  total: number;
  /** Identifies this walk; a newer click bumps it so a stale walk can't resume. */
  requestId: number;
  textAt(idx: number): string | undefined;
  readonly isFinished: boolean;
}

export function planParagraphWalk(init: {
  storyId: number;
  paragraphs: string[];
  requestId: number;
  /** Where to resume; defaults to 1 because paragraph 0 starts immediately. */
  next?: number;
}): ParagraphWalk {
  const paragraphs = [...init.paragraphs];
  return {
    storyId: init.storyId,
    next: init.next ?? 1,
    total: paragraphs.length,
    requestId: init.requestId,
    textAt(idx: number) {
      return paragraphs[idx];
    },
    get isFinished() {
      return this.next >= this.total;
    },
  };
}
