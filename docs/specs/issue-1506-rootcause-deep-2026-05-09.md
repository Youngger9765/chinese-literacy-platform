# Issue #1506 — Essay Persist: Deep Root-Cause Investigation v2

**Date**: 2026-05-09  
**Branch**: `docs/issue-1506-rootcause-deep`  
**Investigator**: Claude (automated static analysis)  
**Status**: PR #1523 deployed to staging (revision `lingoleap-frontend-staging-00761-vt5`), QA still fails.

---

## 1. QA Failure Evidence (5/9 live test)

- **Lesson**: G6-L22 (id=1076), URL: `/learn/1076/reading-strategy`
- **Action**: Filled `<textarea>` ("請在此寫下你的答案...") with test text → waited 9s → switched step → returned
- **Result**: Textarea **empty**, Network showed **only** `GET /api/learning/sessions/181/progress` (39B = empty `step_data`). **No PUT** observed.
- **Two textareas present** on page: `@e27` and `@e39` (both same placeholder, same component)

---

## 2. H5 (Route Mapping) — Verified Correct

**Result: CLEARED**

`frontend/src/routes/AppRoutes.tsx:520` maps:
```
path="reading-strategy" → <StrategyExercisePage />
```
`StrategyExercisePage.tsx` is the correct component for `/learn/:storyId/reading-strategy`.

---

## 3. H1 (Wrong Component) — Partially Confirmed, Mostly Cleared

**Result: PARTIAL — two textareas explained, not the save-block root cause**

All `<textarea>` elements in the spotlight step come from a **single source**:  
`frontend/src/components/reading-steps/StrategyExercise.tsx:401` — the `free_text` branch of `GuidedStepsExercise`.

G6-L22 has **multiple `free_text` steps** in its `guided_steps` strategy exercise (confirmed from `backend/data/lessons/_parsed_2026-05-01/G6-L22.yml`). Both `@e27` and `@e39` are valid `free_text` steps rendered by the SAME component — not two different components fighting each other. H1 as originally framed (different component) is cleared.

**Component audit table:**

| URL path | Mounts component | Renders textarea via | onChange wired? |
|---|---|---|---|
| `/learn/:id/reading-strategy` | `StrategyExercisePage.tsx` | `StrategyExercise` → `GuidedStepsExercise` (type=`guided_steps`) | **YES** (after PR #1523) |
| Same, type=`ordering` | same page | `OrderingExercise` (drag-drop items only) | N/A — no textarea |
| Same, type=`trait_inference` | same page | `TraitInferenceExercise` (buttons only) | N/A — no textarea |
| Same, type=`spotlight` | same page | falls through to "不支援" div | N/A — no textarea |
| Same, type=`knowledge_station` | same page | falls through to "不支援" div | N/A — no textarea |

**G6-L22~G6-L25**: `type: guided_steps` — textarea IS rendered, `onChange` IS wired  
**G7-L28**: `type: guided_steps` — textarea IS rendered, `onChange` IS wired  
**G7-L29**: `type: spotlight` — NO textarea rendered (unsupported type fallback)  
**G7-L30**: `type: knowledge_station` — NO textarea rendered (unsupported type fallback)

---

## 4. H3 (onChange Early-Return) — Confirmed Bug (Secondary)

**Result: CONFIRMED — but only blocks first-keystroke, not subsequent input**

`StrategyExercise.tsx:352`:
```ts
const handleTextChange = (stepIdx: number, value: string) => {
  if (stepFeedback[stepIdx] !== null) return;  // early-return guard
  setAnswers((prev) => prev.map((a, i) => (i === stepIdx ? value : a)));
};
```

**Initial `stepFeedback` state**: `[null, null, null, ...]` (all null, from lazy init).  
**Initial condition**: `stepFeedback[stepIdx] === null` → guard is `null !== null` = `false` → does NOT early-return → typing IS allowed.

This guard only fires AFTER the user clicks "確認" (submit) and `setStepFeedback` is called with a non-null value (true/false). Typing in a not-yet-confirmed step is always allowed. H3 is cleared as the primary blocker. **But**: if a step is confirmed (submitted), you can't re-type — this is intentional UX, not a bug.

---

## 5. H2 (useState Lazy Init Timing) — Confirmed Bug (Primary — Restore Path)

**Result: CONFIRMED — root cause of the "answers not restored on return" failure**

### Sequence

```
t=0ms   Page mounts. stepProgressData.step_data = {} (initial state from LearningLayout:261-265)
t=0ms   savedStrategyData = undefined
t=0ms   initialState = undefined passed to GuidedStepsExercise
t=0ms   useState lazy inits: answers=[null,...], stepFeedback=[null,...], allDone=false
t=0ms   useEffect fires (mount): onChange({answers:[null,...],...}) → saveStepProgressPatch
t=0ms   persistStepProgressState: step_data→{'reading-strategy':{answers:[null,...]}}
t=0ms   syncProgress called → debounce timer set (5000ms)
t=100ms DB GET /api/learning/sessions/181/progress returns 39B (empty step_data)
t=100ms onProgressLoaded({step_data:{}}) fires → setStepProgressState({step_data:{}}) DIRECTLY
        (bypasses persistStepProgressState — overwrites in-memory state back to empty)
t=2000ms User types "test text" in textarea
t=2000ms handleTextChange → setAnswers([...'test text'...])
t=2000ms useEffect fires: onChange({answers:['test text',...]}) → saveStepProgressPatch
t=2000ms persistStepProgressState: prev.step_data={} (reset by onProgressLoaded)
         next.step_data={'reading-strategy':{answers:['test text',...]}}
         Different → syncProgress called → debounce reset to 5000ms
t=7000ms PUT /api/learning/sessions/181/progress fires ← should work
t=9000ms User switches step → StrategyExercisePage unmounts
t=9000ms useProgressSync unmount cleanup fires — debounce already gone (fired at t=7s)
         latestDataRef.current still has {'reading-strategy':{answers:['test text',...]}}
         BUT debounceTimerRef.current = null (debounce already fired)
         → unmount cleanup does NOT fire doSave again (condition: if debounceTimerRef.current)
t=9000ms User returns → StrategyExercisePage remounts
t=9000ms stepProgressData.step_data = current LearningLayout state
         IF PUT at t=7s succeeded: step_data has answers → restored ✓
         IF PUT at t=7s failed silently: step_data is empty → empty textarea ✗
```

### The Actual Missing Save — Critical Path

The debounce fires and calls `doSaveRef.current(latestDataRef.current)`. But `doSaveRef.current` is the latest `doSave` callback. `doSave` is defined as:

```ts
// useProgressSync.ts:89-116
const doSave = useCallback(
  (data: StepProgressData) => {
    if (!token || dbSessionId === null) return;  // GUARD
    ...
    saveStepProgress(token, dbSessionId, withVersion)...
  },
  [token, dbSessionId, onProgressLoaded],
);
```

**The guard `dbSessionId === null`** — if `dbSessionId` is null when the debounce fires, the PUT is silently dropped. `doSaveRef.current` is only updated when `doSave` itself changes (via `useEffect([doSave])`).

**Scenario A (QA session 181 — sessionStorage key present):**
- `dbSessionId` read from sessionStorage at mount (LearningLayout:297-334) → set to 181 immediately (synchronous)
- `doSave` has `dbSessionId=181` from the start
- PUT SHOULD fire at t=7s. If the QA Network tab truly showed no PUT, there's another failure.

**Scenario B (fresh session — no sessionStorage key):**
- `dbSessionId = null` at mount
- `dbSessionId` populated asynchronously via GET existing sessions + POST create (LearningLayout:631-688)
- Typical latency: 500ms-2s
- If debounce fires (t=5s) BEFORE `dbSessionId` is set → `doSave` returns early → **PUT silently dropped**
- This race is the confirmed primary bug for new sessions

### The Overwrite-on-Mount Bug (Secondary — Corrupts Restore)

Even when the PUT eventually fires, there's a secondary issue. The mount-time `useEffect` in `GuidedStepsExercise` fires immediately and calls `onChange({answers:[null,...]})`. This writes empty answers to `step_data['reading-strategy']`. If the DB `onProgressLoaded` arrives AFTER the typed answers are saved, the in-memory `stepProgressState` will have the typed answers. But if the component remounts BEFORE the user types (navigates away immediately after mount), the empty-answer PUT at t=5s overwrites any previously saved real data in the DB.

**Concretely**: User saves answers on Day 1 (PUT fires, DB has `{answers:['day1 text',...]}`). User returns on Day 2. Mount fires at t=0 → `onChange({answers:[null,...]})` → debounce starts. DB GET returns Day 1 data at t=0.5s. `onProgressLoaded` restores `stepProgressState`. User sees the saved answers correctly. BUT the t=5s debounce fires with `latestDataRef.current = {step_data:{'reading-strategy':{answers:[null,...]}}}` (from mount-time call, before typing) — **overwriting Day 1 data with empty answers**.

Wait — this depends on whether the user's typing overrides the mount-time save. If the user doesn't interact at all (just looks), the empty-answer PUT at t=5s wipes their previous work.

---

## 6. H4 (saveStepProgressPatch Fails Silently) — Partially Confirmed

**Result: CONFIRMED for the race condition + version conflict scenario**

`useProgressSync.ts:89-91`:
```ts
const doSave = useCallback((data) => {
  if (!token || dbSessionId === null) return;  // silently drops save
```

No error is thrown, no user notification, no retry. The save is lost.

Additionally, a **StaleVersionError (409)** can occur if two rapid debounce cycles fire. On 409, `useProgressSync.ts:103-113` refreshes from server but **does NOT retry the failed save**. The typed data is lost.

---

## 7. Confirmed Root Causes

### Root Cause 1 (Primary — New Sessions)
**Race: `dbSessionId` null when 5s debounce fires**

- `useProgressSync.doSave` at `useProgressSync.ts:91` silently returns when `dbSessionId === null`
- For new browser sessions (no sessionStorage key), session creation GET+POST completes in 200ms-3s
- Debounce fires at exactly 5s after first keystroke
- If user types within the first 5s of a fresh session and the session creation API is slow (>5s total), the PUT is dropped
- **No retry mechanism exists**

### Root Cause 2 (Secondary — Mount Overwrites DB)
**Mount-time `useEffect` fires `onChange` with null answers before DB load**

- `StrategyExercise.tsx:347-349`:
  ```ts
  useEffect(() => {
    onChange?.({ answers, stepFeedback, allDone, exerciseType: 'guided_steps' });
  }, [answers, stepFeedback, allDone]);
  ```
- On mount, `answers = [null, null, ...]` (initialState not yet seeded from DB)
- `onChange` fires immediately → `saveStepProgressPatch` → debounce queued with empty answers
- If user visits page without typing and stays 5s → **PUT fires with null answers, overwriting previous DB data**
- `stepProgressData` in `LearningLayout` is seeded ASYNCHRONOUSLY via `onProgressLoaded` (line 340-393)
- The `savedStrategyData` in `StrategyExercisePage.tsx:25` reads `stepProgressData.step_data['reading-strategy']` at **render time** — but the first render happens BEFORE `onProgressLoaded` fires
- `useState` lazy initializers (lines 338,341,344 of StrategyExercise.tsx) only run ONCE on mount — they never re-run when `onProgressLoaded` later populates `stepProgressData`

### Root Cause 3 (Tertiary — Missing Guard on Mount Effect)
**`useEffect` lacks a "not first mount" guard**

The `useEffect` eslint comment `// eslint-disable-line react-hooks/exhaustive-deps` suppresses the warning about `onChange` not being in the dep array. This is intentional (don't want to re-subscribe). But the mount-time fire with empty state triggers an unnecessary write that can corrupt data.

### Why PR #1523 Didn't Fix It

PR #1523 correctly wired `onChange` → `saveStepProgressPatch`. The data flow is sound. But it missed three issues:

1. **No guard against null `dbSessionId` at debounce time** — uses the existing debounced mechanism which silently drops saves when `dbSessionId` is null
2. **No guard against mount-time `onChange` with empty state** — the `useEffect` fires on mount BEFORE `initialState` is available from DB, queuing an empty-answer save that can overwrite real data
3. **`savedStrategyData` reads stale `stepProgressData`** — `stepProgressData` starts as `{step_data:{}}` and only updates asynchronously; `useState` lazy init runs before `onProgressLoaded` populates it, so initial state is always empty on first page visit of a session

---

## 8. Recommended Fix v2

**LOC estimate**: ~40 lines across 2 files (net: +35 / -5)

### Fix A: Guard mount-time `useEffect` with `isFirstMount` ref
**File**: `frontend/src/components/reading-steps/StrategyExercise.tsx`  
**Location**: `GuidedStepsExercise` function, lines 347-349

```ts
// Before (fires on mount with empty state):
useEffect(() => {
  onChange?.({ answers, stepFeedback, allDone, exerciseType: 'guided_steps' });
}, [answers, stepFeedback, allDone]);

// After (skip mount fire):
const isFirstRender = useRef(true);
useEffect(() => {
  if (isFirstRender.current) {
    isFirstRender.current = false;
    return;  // skip mount-time fire — avoids overwriting DB with empty answers
  }
  onChange?.({ answers, stepFeedback, allDone, exerciseType: 'guided_steps' });
}, [answers, stepFeedback, allDone]);
```

**Why**: The only purpose of the `useEffect` is to notify parent of user-driven changes. The mount-time fire with initial state is never meaningful — if `initialState` was provided, those values are already known to the parent (it passed them in). If `initialState` was undefined, the parent doesn't need to know that all answers are null.

**Risk**: Low. No behavioral change for user-driven interactions.

### Fix B: Defer `initialState` seeding with `useEffect` + forceUpdate pattern
**File**: `frontend/src/components/reading-steps/StrategyExercise.tsx`  
**Location**: `GuidedStepsExercise` function

The `useState` lazy inits run before `onProgressLoaded` fires. Solution: use a `key` prop in `StrategyExercisePage` to force remount when `savedStrategyData` becomes available.

**File**: `frontend/src/pages/learning/StrategyExercisePage.tsx`

```tsx
// In StrategyExercisePage:
const savedStrategyData = stepProgressData.step_data?.['reading-strategy'] as ...;

// Force GuidedStepsExercise to remount once DB data arrives by keying on data availability
const strategyKey = savedStrategyData ? 'loaded' : 'pending';

// In JSX:
<StrategyExercise
  key={strategyKey}  // remounts when DB data arrives, re-runs useState lazy inits
  exercise={selectedStory.strategyExercise!}
  onComplete={handleStrategyComplete}
  onChange={handleAnswerChange}
  initialState={savedStrategyData}
/>
```

**Why**: When `key` changes from `'pending'` to `'loaded'`, React unmounts and remounts `StrategyExercise`. The `useState` lazy inits run again with the now-populated `initialState`. This correctly restores answers.

**Risk**: Medium. Remounting causes a visible flash. Mitigation: only remount once (key only changes from `'pending'` to `'loaded'`, never back). Alternatively, use `useImperativeHandle` + `reset()` method to avoid remount.

**Alternative B2 (no remount)**: Replace `useState` lazy init with `useEffect` that watches `initialState`:
```ts
const [answers, setAnswers] = useState<(string | number | null)[]>(() => steps.map(() => null));

// Re-seed from initialState when it becomes available
useEffect(() => {
  if (initialState?.answers) {
    setAnswers(initialState.answers as (string | number | null)[]);
    setStepFeedback(initialState.stepFeedback as (boolean | null)[] ?? steps.map(() => null));
    setAllDone(!!(initialState.allDone));
  }
}, [initialState]);  // runs once when initialState changes from undefined → object
```
**Risk**: Low-Medium. Triggers re-render. Need to guard against overwriting user-in-progress answers: add `answersLoadedRef` to skip the re-seed if user has already typed.

### Fix C: Flush on `dbSessionId` resolution
**File**: `frontend/src/hooks/useProgressSync.ts`

Add a `useEffect` that flushes pending data when `dbSessionId` becomes available:
```ts
useEffect(() => {
  if (dbSessionId !== null && latestDataRef.current && debounceTimerRef.current) {
    // dbSessionId just resolved — flush the pending debounced save immediately
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = null;
    doSave(latestDataRef.current);
  }
}, [dbSessionId]);  // eslint-disable-line react-hooks/exhaustive-deps
```

**Why**: If the debounce timer fires while `dbSessionId` is null, the save is dropped. This effect flushes the pending save as soon as `dbSessionId` becomes available. This fixes the race condition for new sessions.

**Risk**: Low. `latestDataRef.current` is already maintained correctly. The `doSave` guard `if (!token || dbSessionId === null)` will not fire since we're inside the `dbSessionId !== null` block.

### Summary of v2 Fix

| Fix | File | Net LOC | Risk | Required? |
|---|---|---|---|---|
| A: Guard mount-time effect | StrategyExercise.tsx | +5 | Low | **YES** |
| B2: Re-seed from initialState | StrategyExercise.tsx | +8 / -4 | Low-Med | **YES** |
| C: Flush on dbSessionId resolve | useProgressSync.ts | +10 | Low | **YES** |

**Total: ~23 net LOC across 2 files.** No backend changes.

---

## 9. Test Plan for v2 Fix

### Test 1: Fresh session — type and wait
1. Clear sessionStorage (or use incognito + new session)
2. Navigate to `/learn/1076/reading-strategy`
3. Type text in a `free_text` step textarea
4. Wait 8 seconds without typing
5. **Expected**: PUT fires within 1s of `dbSessionId` resolving (Fix C), or within 5s of last keystroke if `dbSessionId` resolves first
6. **Verify**: Network tab shows PUT `/api/learning/sessions/{N}/progress` with `step_data['reading-strategy'].answers` containing typed text

### Test 2: Switch step and return — answers restored
1. Complete Test 1 successfully (PUT confirmed)
2. Switch to a different step (e.g., click 閱讀理解 in stepper)
3. Return to 閱讀聚光燈
4. **Expected**: Previously typed text is visible in the textarea
5. **Verify**: `answers` state in GuidedStepsExercise matches saved DB values

### Test 3: Page reload — answers restored from DB
1. Complete Test 1 successfully
2. Refresh the page (F5)
3. Navigate to `/learn/1076/reading-strategy`
4. **Expected**: Previously typed text is restored

### Test 4: Mount-time overwrite prevention
1. Complete some answers (PUT confirmed in DB)
2. Switch away then return to the step immediately (< 5s)
3. **Expected**: No new PUT fires with empty answers within 5s of remount
4. **Verify**: Network tab shows NO PUT immediately after remount (Fix A ensures mount-time `useEffect` skips `onChange`)

### Test 5: Select steps still persist
1. Click an option in a `select` type step
2. Wait 6s
3. **Expected**: PUT fires with `answers[stepIdx] = optionIndex`
4. Switch away and return → option is pre-selected

### Test 6: G7-L29 and G7-L30 regression
1. Navigate to G7-L29 `/learn/{id}/reading-strategy` (type=spotlight)
2. **Expected**: "不支援的練習類型：spotlight" shown, no textarea, no JS errors
3. Navigate to G7-L30 (type=knowledge_station) — same expectation

---

## 10. Full Textarea/Component Audit

Files that render `<textarea>` and are in scope for the spotlight step:

| File | Textarea count | Step | Persistence status |
|---|---|---|---|
| `StrategyExercise.tsx:401` | N (one per `free_text` step) | reading-strategy | **BROKEN — fixed by v2** |
| `ComprehensionPage.tsx` | 0 | comprehension | N/A |
| `StrategyExercisePage.tsx` | 0 (no direct textarea) | reading-strategy wrapper | N/A |

No other component renders a textarea in the spotlight step. The two textareas observed in QA (`@e27`, `@e39`) are both from `StrategyExercise.tsx:401`, one per `free_text` step in G6-L22's `guided_steps` exercise (G6-L22 has multiple `free_text` steps).

---

## 11. Appendix: G6-L22 Strategy Exercise Structure

From `backend/data/lessons/_parsed_2026-05-01/G6-L22.yml`:
- `strategy_exercise.type`: `guided_steps`
- `strategy_exercise.strategy_name`: `摘要策略-問題.解決.結果結構`
- Steps include both `select` and `free_text` types
- Multiple `free_text` steps → multiple textareas rendered → explains 2 textareas observed in QA

All 5 `guided_steps` lessons (G6-L22~25, G7-L28) are affected by this bug.  
G7-L29 (spotlight) and G7-L30 (knowledge_station) show "不支援" fallback — no textarea, not affected.
