/**
 * Required-assignment-steps runner (frontend half) — #3695
 *
 * The backend mirrors `filterRequiredAssignmentSteps` by hand
 * (`backend/app/services/assignment_queries.py::DEFAULT_REQUIRED_STEP_IDS` +
 * `_NON_REQUIRED_STEP_IDS`) because there is no shared data source between
 * the two stacks. That file says so explicitly: "⚠️ Keep in sync with the
 * frontend by hand". A hand-kept mirror drifts silently — this runner lets
 * a Python test compute the REAL frontend answer (not a second hand-written
 * copy) for every lesson's actual `step_sequence`, so the parity test fails
 * the moment either side changes alone.
 *
 * Does not reimplement any filtering/ordering logic — imports the real
 * `filterRequiredAssignmentSteps` / `resolveActiveSteps` from stepConfig.ts,
 * the same functions `useStepProgressPersistence.ts` and `MyAssignments.tsx`
 * call in production.
 *
 * Usage: node requiredAssignmentSteps.cjs <lessons.json> <out.json>
 *   lessons.json: [{"id": "20011", "step_sequence": ["lesson-intro", ...] | null}, ...]
 *   out.json:     {"20011": ["full-text-annotate#dcavv", ...], ...}
 */
import fs from 'node:fs';
import { filterRequiredAssignmentSteps, resolveActiveSteps } from '../src/config/stepConfig';

interface LessonInput {
  id: string;
  step_sequence: string[] | null;
}

function main() {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    console.error('用法: node requiredAssignmentSteps.cjs <lessons.json> <out.json>');
    process.exit(2);
  }
  const lessons: LessonInput[] = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const out: Record<string, string[]> = {};
  for (const lesson of lessons) {
    const activeSteps = resolveActiveSteps(lesson.step_sequence ?? undefined);
    out[lesson.id] = filterRequiredAssignmentSteps(activeSteps).map((s) => s.id);
  }
  fs.writeFileSync(outPath, JSON.stringify(out));
}

main();
