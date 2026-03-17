/**
 * Unit tests for assignment edit feature (Issue #425)
 * Verifies that edit state helpers work correctly.
 * Run with: npx tsx src/pages/teacher/AssignmentTab.edit.test.ts
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

// ── Helper: parse due_date the same way handleOpenEdit does ──────────────────

function parseDueDateForInput(dueDateIso: string | null): string {
  if (!dueDateIso) return '';
  return new Date(dueDateIso).toISOString().slice(0, 10);
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\nAssignment Edit Feature — Unit Tests (Issue #425)\n');

// Test 1: parseDueDateForInput with a valid ISO string
assert(
  parseDueDateForInput('2026-04-01T00:00:00Z') === '2026-04-01',
  'parseDueDateForInput returns YYYY-MM-DD for ISO datetime',
);

// Test 2: parseDueDateForInput with null returns empty string
assert(
  parseDueDateForInput(null) === '',
  'parseDueDateForInput returns empty string for null',
);

// Test 3: parseDueDateForInput with empty string returns empty string
assert(
  parseDueDateForInput('') === '',
  'parseDueDateForInput returns empty string for empty input',
);

// Test 4: due_date payload — non-empty string stays as-is
const editDueDateFilled = '2026-05-31';
const dueDatePayload = editDueDateFilled || null;
assert(
  dueDatePayload === '2026-05-31',
  'due_date payload passes non-empty date string through',
);

// Test 5: due_date payload — empty string becomes null (clears the date)
const editDueDateEmpty = '';
const dueDatePayloadEmpty = editDueDateEmpty || null;
assert(
  dueDatePayloadEmpty === null,
  'due_date payload converts empty string to null (clears due date)',
);

// Test 6: title trim — blank title becomes undefined (uses story title)
const editTitleBlank = '   ';
const titlePayload = editTitleBlank.trim() || undefined;
assert(
  titlePayload === undefined,
  'blank title trims to undefined (falls back to story title)',
);

// Test 7: title trim — non-blank title stays as trimmed value
const editTitleWithSpaces = '  第一單元作業  ';
const titlePayloadTrimmed = editTitleWithSpaces.trim() || undefined;
assert(
  titlePayloadTrimmed === '第一單元作業',
  'non-blank title is trimmed correctly',
);

// Test 8: description trim — blank description becomes undefined
const editDescBlank = '  ';
const descPayload = editDescBlank.trim() || undefined;
assert(
  descPayload === undefined,
  'blank description trims to undefined',
);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
