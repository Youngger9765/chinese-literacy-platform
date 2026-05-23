# Refactor Plan — 17 hotspot files (Codex consult 2026-05-23 02:39 task-mph9kckk-gp1u9b)

## Shared Pattern Decision

Admin panels (7-11) + teacher pages (12-13) should NOT be split independently first.
Shared patterns: async load/error/empty, detail cards, edit forms, active toggles, debounced search, table/card responsive lists, modal confirm flows.

**First create shared primitives PR**: `AdminPageShell`, `AdminTable`, `DetailHeaderCard`, `EditSection`, `ConfirmDialog`, `useDebouncedSearch`, `useAsyncAction`

## Per-file plan

### 1. VocabDefinitionMatch.tsx (P0)
**Reason**: High-risk learning step, persisted progress, two interaction modes, retry semantics, scoring.
**Tests FIRST**: restore persisted progress / multiple-choice distractors / drag-drop wrong attempts / retry wrong only.
**Refactor**: Extract `vocabDefinitionMatchLogic.ts` + `SummaryScreen`, `StageStatus`, `MultipleChoiceMode`, `DragDropMode`.
**Risk**: High. **Effort**: L.

### 2. AssessmentReport.tsx (P0)
**Reason**: Central report mixes scoring, privacy display rules, charts, alerts, analytics, side effects.
**Tests FIRST**: student hides numeric scores / teacher readOnly shows numeric / report-viewed writes localStorage once / no-data session renders preview.
**Refactor**: Extract `assessmentReportMetrics.ts` + `AssessmentReadingSummary`, `AssessmentDiffSection`, `AssessmentComprehensionSection` + `useRepeatedErrorAlerts`.
**Risk**: High. **Effort**: L.

### 3. WriteCharacter.tsx (P1)
**Tests FIRST**: outlined-once flow / no-outline-once / standard mode (3 outlined + 1 no-outline) / missing stroke data.
**Refactor**: Extract `useWriteCharacterMachine` + `useStrokeCanvasRenderer`.
**Risk**: High. **Effort**: L.

### 4. ReadingAnnotation.tsx (P1)
**Tests FIRST**: PUA-selector range / overlapping replaces / undo restores / inline image-table markers.
**Refactor**: `annotationOffsets.ts` + `annotationReducer.ts` + `AnnotationSidePanel`/`AnnotationToolbar`/`AnnotatedParagraph`.
**Risk**: High. **Effort**: L.

### 5. ZhuyinPhoneticGame.tsx (P2)
**Tests FIRST**: parse initial/medial/final/tone / initial mode uses medial / final mode + tone / compose exact order.
**Refactor**: `zhuyinGameLogic.ts` + `ModeSelect`/`PickGame`/`ComposeGame`/`ScoreBanner`.
**Risk**: Med. **Effort**: M.

### 6. VocabWordSearch.tsx (P1)
**Tests FIRST**: grid placement bounds / whitespace stripped / completed-localStorage restores / redo regenerates.
**Refactor**: `wordSearchGrid.ts` + `useWordSearchProgress`.
**Risk**: Med. **Effort**: M.

### 7. SchoolDetailPanel.tsx (P1)
**Tests FIRST**: load school populates / edit save trims / regenerate code updates / teacher search excludes assigned.
**Refactor (after primitives)**: `SchoolInfoCard`/`SchoolClassroomsSection`/`SchoolTeachersSection`/`SchoolJoinCodeSection`.
**Risk**: Med. **Effort**: L.

### 8. ClassroomDetailPanel.tsx (P1)
**Tests FIRST**: batch parser `name seat_number` / add student / remove confirm / CSV BOM.
**Refactor (after primitives)**: `ClassroomInfoCard`/`StudentSearchSection`/`BatchCreateStudentsPanel`/`ClassroomJoinCodeSection`.
**Risk**: Med. **Effort**: L.

### 9. StoryManagementPanel.tsx (P1)
**Tests FIRST**: formToCreateRequest trims / edit preserves lesson / 409 duplicate / filter calls list API.
**Refactor**: `storyFormMapper.ts` + `StoryTable`/`StoryFormModal`/`DeleteConfirmDialog`.
**Risk**: Med. **Effort**: M.

### 10. OrgDetailPanel.tsx (P1)
**Tests FIRST**: remaining points calc / edit trims / toggle active confirms / points logs append.
**Refactor**: `OrgInfoCard`/`OrgSchoolsSection`/`OrgPointsUsage`/`PointsLogsSection`.
**Risk**: Med. **Effort**: M.

### 11. UsersPanel.tsx (P1)
**Tests FIRST**: debounced search resets page / expand loads roles once / revoke confirms then reloads / assign maps scope.
**Refactor**: `RoleBadge`/`UserRow`/`UserExpandedPanel`/`AssignRoleForm`.
**Risk**: Med. **Effort**: L.

### 12. AssignmentDetailPanel.tsx (P1)
**Tests FIRST**: grouped count pending/submitted / score validation 0-100 / grade pre-fill / bulk continues after fail.
**Refactor**: `assignmentDetailLogic.ts` + `SubmissionRows`/`AttemptHistoryPanel`/`BulkCommentPanel`/`ReadingMetricsPanel`.
**Risk**: Med. **Effort**: L.

### 13. MyTextsTab.tsx (P1)
**Tests FIRST**: create form resets row ids / edit loads detail / save trims paragraphs / delete reloads.
**Refactor**: `teacherTextFormMapper.ts` + `MyTextsList`/`MyTextFormModal`/`MyTextPreviewModal`/`DeleteTextDialog`.
**Risk**: Med. **Effort**: L.

### 14. teacherApi.ts (P0)
**Tests FIRST**: each endpoint path/query/body matches / 401 unauthorized behavior / 204 returns undefined / blob exports as Blob (no JSON parse).
**Refactor**: Migrate to `httpClient` (from #1834). Split type declarations by domain.
**Risk**: High. **Effort**: L.

### 15. backend/app/routes/auth.py (P0)
**Tests FIRST**: register blocks student / forgot-password no-enumeration / email verification idempotent / Google/Junyi login links existing email.
**Refactor**: `auth_registration_service.py`/`password_reset_service.py`/`email_verification_service.py`/`sso_login_service.py`.
**Risk**: High. **Effort**: L.

### 16. backend/app/routes/omo.py (P1)
**Tests FIRST**: upload validates empty/oversized/bad-MIME / dedup scoped per student / confirm maps synthetic→Story.id / regrade state transitions.
**Refactor**: `omo_upload_validator.py`/`omo_upload_service.py`/`omo_state_service.py`.
**Risk**: Med. **Effort**: L.

### 17. polyphonicProcessor.ts (P0)
**Tests FIRST**: 一/不 sandhi (numeric / before 1/2/3/4 tone / special phrases) / 地 de5 vs di4 / double-character special pairs / PUA selector only for non-default style sets.
**Refactor**: `toneSandhi.ts`/`polyphonicPatternMatcher.ts`/`styleSetMapper.ts`/`zhuyinStringBuilder.ts`.
**Risk**: High. **Effort**: L.

## Execution Order

1. **P0 teacherApi.ts** — unlocks API consistency
2. **P0 polyphonicProcessor.ts** — protects zhuyin-dependent components
3. **P0 auth.py** — security critical
4. **P0 AssessmentReport.tsx** — lock teacher/student before extraction
5. **P0 VocabDefinitionMatch.tsx** — lock persisted progress + scoring
6. **P1 Shared admin/teacher primitives** — must be solo before 7+8
7. **P1 Admin pages parallel** (after primitives): OrgDetailPanel / SchoolDetailPanel / ClassroomDetailPanel / StoryManagementPanel / UsersPanel
8. **P1 Teacher pages parallel** (after primitives): AssignmentDetailPanel / MyTextsTab
9. **P1 ReadingAnnotation.tsx**
10. **P1 VocabWordSearch.tsx**
11. **P1 omo.py**
12. **P1 WriteCharacter.tsx**
13. **P2 ZhuyinPhoneticGame.tsx** (after polyphonic work stable)

## Source

Codex consult task-mph9kckk-gp1u9b (2026-05-23 02:39, duration 3m 2s)
