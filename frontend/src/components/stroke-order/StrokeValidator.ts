/**
 * StrokeValidator — issue #1935
 *
 * Pure service: compares a student-drawn stroke against the expected
 * median path and returns a correctness verdict.
 *
 * All heavy lifting delegates to `isStrokeCorrect` from strokeData.ts;
 * this module is the single import point for stroke-validation logic so
 * WriteCharacter (and future components) don't need to reach into strokeData.
 */

import { isStrokeCorrect, Point } from './strokeData';

export interface StrokeValidationResult {
  correct: boolean;
}

/**
 * Validate a sequence of points drawn by the student against the expected
 * median path of a stroke.
 *
 * @param drawn   Points captured from pointer events.
 * @param expected  Median points of the expected stroke (from strokeData).
 * @returns       `{ correct: true }` when the stroke passes, otherwise `{ correct: false }`.
 */
export function validateStroke(drawn: Point[], expected: Point[]): StrokeValidationResult {
  return { correct: isStrokeCorrect(drawn, expected) };
}
