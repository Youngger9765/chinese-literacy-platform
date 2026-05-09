# Issue #1506 — 閱讀聚光燈申論題記錄跳關卡會清空

**Investigation Date**: 2026-05-09
**Refs**: Issue #1506, 2026-05-08 meeting record (line 189, 717, 753, 782)
**Assignee**: @stgst (啟翔)
**Deadline**: 7/1

---

## 1. Repro Steps

Source: 5/8 meeting record line 189 (啟翔 QA during #1458 batch):

> "然後這邊的第一記錄好像也會跳掉。就是他你如果跳到其他關卡，你再回來的話。呃，幾乎會清空。"

Agent did not run the app. Repro is confirmed as **observed live by 啟翔 at 5/8 meeting** and matches the issue body exactly.

**Steps to reproduce (from issue #1506 body)**:
1. Open 閱讀聚光燈 step (`/learning/{storyId}/reading-strategy`)
2. Enter text into any `free_text` step inside `GuidedStepsExercise`
3. Navigate to a different step (e.g. click stepper to go to 課文理解)
4. Return to 閱讀聚光燈
5. Observed: textarea values are empty / exercise reset to initial state

---

## 2. Code Path Map

### 2a. Frontend Component + State Hooks

**Main component chain**:
```
/learning/{storyId}/reading-strategy
  → AppRoutes.tsx (route definition)
  → LearningLayout.tsx (context provider: LearningContext)
    → StrategyExercisePage.tsx     [frontend/src/pages/learning/StrategyExercisePage.tsx]
      → StrategyExercise.tsx       [frontend/src/components/reading-steps/StrategyExercise.tsx]
        → GuidedStepsExercise()    [StrategyExercise.tsx:323]
```

**State hooks — all local `useState`, no persistence**:

| State | Location | Type | Persisted? |
|-------|----------|------|-----------|
| `answers` | `StrategyExercise.tsx:331` | `(string \| number \| null)[]` | **No** |
| `stepFeedback` | `StrategyExercise.tsx:334` | `(boolean \| null)[]` | **No** |
| `allDone` | `StrategyExercise.tsx:337` | `boolean` | **No** |
| `orderedItems` | `StrategyExercise.tsx:60` | `OrderingItem[]` | **No** |
| `submitted` | `StrategyExercise.tsx:63` | `boolean` | **No** |
| `selected` | `StrategyExercise.tsx:215` | `string \| null` | **No** |
| `strategyDone` | `StrategyExercisePage.tsx:24` | `boolean` | **No** |

All state lives in local `useState` inside `GuidedStepsExercise`, `OrderingExercise`, and `TraitInferenceExercise`. There is **zero persistence** — no `localStorage`, no `sessionStorage`, no backend API call on answer change.

### 2b. Frontend Save Trigger

`StrategyExercisePage.tsx` calls `saveStepProgressPatch` in **exactly one place**:

```ts
// StrategyExercisePage.tsx:42-45
const handleNext = useCallback(() => {
  handleProgressChange({ completed: true, strategyDone }, true);  // ← only called on "下一關" click
  handleFinishReadingStrategy();
}, [handleFinishReadingStrategy, handleProgressChange, strategyDone]);
```

`handleProgressChange` (`StrategyExercisePage.tsx:26-35`) calls `saveStepProgressPatch` with:
```ts
{ stepId: 'reading-strategy', stepData: { completed: true, strategyDone } }
```

This means **individual exercise answers are never included in `step_data`** — only a boolean `completed: true` flag. The answers themselves are never saved.

### 2c. Backend Endpoint

The generic step progress endpoint exists and works:
- `PUT /api/learning/sessions/{session_id}/progress` — `learning_step_progress.py:42`
- `GET /api/learning/sessions/{session_id}/progress` — `learning_step_progress.py:199`

The JSONB `step_data` column stores whatever the frontend POSTs under each step key. For `reading-strategy`, the current payload is:
```json
{ "completed": true, "strategyDone": true }
```

No `answers`, `stepFeedback`, or per-step content is ever sent.

### 2d. Backend Persistence / DB Schema

`step_progress` is a JSONB column on `LearningSession` (not a dedicated table).
Structure: `{ current_step, steps_completed[], step_data: { 'reading-strategy': { completed: true } } }`.

There is **no `essay_answer` table**, **no `spotlight_session` table**, and **no dedicated model** for strategy exercise answers. The generic `step_data` JSONB key is the intended storage location, but it is currently only populated with a completion flag.

### 2e. Rehydration (DB → UI)

On session load, `LearningLayout.tsx:340-394` (the `onProgressLoaded` callback in `useProgressSync`) rehydrates several steps from `step_data`:

```ts
// LearningLayout.tsx:353-392
const tutorData = loadedStepData.tutor
const fullReadingData = loadedStepData['full-reading']
const vocabData = loadedStepData.vocab
const comprehensionData = loadedStepData.comprehension
// ... (reading-annotation, vocab-definition, vocab-application, vocab-word-search, knowledge-station)
```

**`reading-strategy` is not in this list.** Even if answers were saved, there is no code path to restore them into the `StrategyExercise` component's `useState` on remount.

### 2f. Component Lifecycle on Step Switch

React Router renders `StrategyExercisePage` only when the route matches `/learning/{storyId}/reading-strategy`. Switching to another step navigates to a different route, which **unmounts** `StrategyExercisePage` and all its children. On return, a fresh mount re-initialises all `useState` hooks to their initial values (`null`, `[]`, `false`). This is why "幾乎全部清空" is observed.

---

## 3. Root Cause

**Hypothesis (a): Frontend `useState` only, no persistence — lost on unmount.**

This is the confirmed root cause. Evidence:

1. `StrategyExercise.tsx:331-337` — all answer state is plain `useState`, never written to `localStorage`, `sessionStorage`, or any API
2. `StrategyExercisePage.tsx:27-35` — `saveStepProgressPatch` is called **only** on "下一關" click, and only saves `{ completed: true, strategyDone }`, not the answers
3. `LearningLayout.tsx:340-394` — rehydration on load does not extract `reading-strategy` step data into any prop/context that `StrategyExercise` could read
4. React Router unmounts the component on step navigation → all local state is garbage-collected

There is no backend failure, no race condition, and no sessionStorage bug. The feature simply lacks a persistence layer entirely.

---

## 4. Recommended Fix

### Minimal diff sketch

**Two-part fix: (A) persist answers, (B) rehydrate on mount**

#### Part A — Persist `answers` + `stepFeedback` on every change

In `StrategyExercisePage.tsx`, pass a callback into `StrategyExercise` to capture answer changes:

```tsx
// StrategyExercisePage.tsx — add onChange prop
const handleAnswerChange = useCallback(
  (exerciseState: Record<string, unknown>) => {
    handleProgressChange(exerciseState, false);  // debounced (5 s)
  },
  [handleProgressChange],
);

<StrategyExercise
  exercise={selectedStory.strategyExercise!}
  onComplete={handleStrategyComplete}
  onChange={handleAnswerChange}    // NEW
/>
```

In `StrategyExercise.tsx`, call `props.onChange` whenever `answers` or `stepFeedback` changes:

```tsx
// GuidedStepsExercise — add useEffect
useEffect(() => {
  props.onChange?.({
    answers,
    stepFeedback,
    allDone,
    exerciseType: 'guided_steps',
  });
}, [answers, stepFeedback, allDone]);
```

`saveStepProgressPatch` will write this into:
```json
{ "reading-strategy": { "answers": [...], "stepFeedback": [...], "allDone": false } }
```

The 5-second debounce in `useProgressSync` means API calls are batched, not per-keystroke.

#### Part B — Rehydrate `answers` on mount

Pass saved state into `StrategyExercise` as `initialState`:

In `StrategyExercisePage.tsx`:
```tsx
const savedStrategyData = stepProgressData.step_data?.['reading-strategy'] as Record<string, unknown> | undefined;

<StrategyExercise
  exercise={selectedStory.strategyExercise!}
  onComplete={handleStrategyComplete}
  onChange={handleAnswerChange}
  initialState={savedStrategyData}    // NEW
/>
```

In `GuidedStepsExercise`, accept `initialState` and seed `useState`:

```tsx
// StrategyExercise.tsx:331-337 — seed from initialState
const [answers, setAnswers] = useState<(string | number | null)[]>(
  () => (initialState?.answers as (string|number|null)[]) ?? steps.map(() => null),
);
const [stepFeedback, setStepFeedback] = useState<(boolean | null)[]>(
  () => (initialState?.stepFeedback as (boolean|null)[]) ?? steps.map(() => null),
);
const [allDone, setAllDone] = useState(
  () => (initialState?.allDone as boolean) ?? false,
);
```

`stepProgressData` is already available in `LearningLayout.tsx:1210` via context, so no new API call is needed.

### Files to change

| File | Lines affected | Change |
|------|---------------|--------|
| `frontend/src/components/reading-steps/StrategyExercise.tsx` | ~16 (Props + useEffect + useState seeds) | Add `onChange` + `initialState` props; seed 3 useState from initialState; call onChange on changes |
| `frontend/src/pages/learning/StrategyExercisePage.tsx` | ~10 | Add `handleAnswerChange` callback; read `savedStrategyData`; pass both as props |

**Total estimated LOC: ~26 lines added, 0 deleted.**

### Test plan

1. Write/run unit test in `StrategyExercise.test.tsx`: mount with `initialState`, assert textarea value is populated
2. Manual QA:
   a. Enter text in `free_text` step → wait 6 s (past 5 s debounce) → switch to another step → return → verify text is restored
   b. Select an option in `select` step → switch away → return → verify selection is restored
   c. Complete all steps (allDone=true) → switch away → return → verify "全部步驟完成！" banner is shown
   d. Drag-and-drop ordering: switch away → return → verify order is preserved (ordering exercise needs same fix)
   e. Trait inference selection: switch away → return → verify selection is preserved

---

## 5. Edge Cases to Also Test

| Scenario | Expected behaviour | Notes |
|----------|-------------------|-------|
| **Forward navigation (→ next step)** | Answers saved, restored on back | Main case |
| **Back navigation (← prev step)** | Answers saved, restored on return | Same mechanism |
| **Page reload mid-essay** | Answers restored from DB/localStorage | Requires `beforeunload` beacon to fire; test with slow connection |
| **Multi-paragraph free_text** | All paragraphs restored | `answers[i]` is a string, handles multi-line via `\n` |
| **Switch device / new tab** | Answers restored if `dbSessionId` exists | DB is the durable store; localStorage is tab-local |
| **Ordering exercise (drag-and-drop)** | `orderedItems` array restored | `OrderingExercise` needs same `initialState` pattern — items have IDs that may shift on shuffle; save index array not IDs |
| **Trait inference exercise** | `selected` + `submitted` restored | `TraitInferenceExercise` also needs `initialState` |
| **No `strategyExercise` in lesson** | Placeholder shown, no crash | `StrategyExercisePage.tsx:84-97` path unaffected |
| **`allDone: true` on remount** | "下一關" button enabled | `strategyDone` in `StrategyExercisePage` needs to be seeded from `initialState.allDone` too |
| **Version conflict (409)** | Graceful: local state preserved, server refresh** | Handled by `useProgressSync.ts:104-111` already |
| **Free_text > 1000 chars** | No crash, saves correctly | JSONB has no practical size limit for this use case |

### Additional note: `strategyDone` in `StrategyExercisePage`

The "下一關" button (`StrategyExercisePage.tsx:66`) is gated on `strategyDone`. On remount, `strategyDone` resets to `false` (line 24) even when all steps are done. This means even if the exercise state is restored, the button remains disabled. The fix must also seed `strategyDone` from `initialState.allDone`:

```tsx
// StrategyExercisePage.tsx:24
const [strategyDone, setStrategyDone] = useState(
  () => !!(savedStrategyData?.allDone),
);
```

This is **not currently in the minimal diff above** — it should be added as a required part of the fix to avoid a second bug where the button stays locked after restore.
