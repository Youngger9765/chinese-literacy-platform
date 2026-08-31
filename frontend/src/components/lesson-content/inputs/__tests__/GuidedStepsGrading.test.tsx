/**
 * 範例子流程要用自己的故事判分，不是整課課文 (#2553).
 *
 * G6-L22《小兵立大功》的聚光燈裡有一個「例一：烏鴉喝水」的範例子流程。
 * 「❶主角是誰？」（reference answer: 烏鴉）輸入 **孟嘗君** 被判 ✓「你抓到故事的主角了」。
 *
 * 因為送去 AI 判分的 `passage` 一律是 `ExerciseBlockView` 傳的**整課課文** —— 那課主角就
 * 是孟嘗君。AI 拿「孟嘗君」對孟嘗君的故事檢查，當然說對。範例的題目被拿去對主課文判分。
 *
 * 為什麼測純函式而不 render 元件
 * ------------------------------
 * 這個 failure 住在「挑哪一段文本」，不住在畫面上。用整個元件測要餵 token、mock
 * AuthContext、包一層有狀態的 wrapper、還要挑對送出鍵 —— 我試了五輪都卡在 fixture，而那些
 * 全都不是被測的東西。抽成函式之後，斷言直接打在決策上。
 */
import { describe, expect, it } from 'vitest';

import { gradingPassage } from '../GuidedStepsInput';

const LESSON_PASSAGE = '孟嘗君的門下食客三千，其中有雞鳴狗盜之徒……';
const EXAMPLE_CONTEXT = '烏鴉口渴了，看到一個裝著半瓶水的瓶子……';

describe('gradingPassage (#2553)', () => {
  it('uses the worked example own story when the step has one', () => {
    expect(gradingPassage(EXAMPLE_CONTEXT, LESSON_PASSAGE)).toBe(EXAMPLE_CONTEXT);
  });

  it('falls back to the lesson passage for a step with no context of its own', () => {
    expect(gradingPassage(undefined, LESSON_PASSAGE)).toBe(LESSON_PASSAGE);
    expect(gradingPassage(null, LESSON_PASSAGE)).toBe(LESSON_PASSAGE);
  });

  it('does not treat an empty context as absent', () => {
    // `??` only falls through on null/undefined. An empty string is a real (if useless)
    // context and must not silently become the whole lesson — that is the bug's shape.
    expect(gradingPassage('', LESSON_PASSAGE)).toBe('');
  });
});
