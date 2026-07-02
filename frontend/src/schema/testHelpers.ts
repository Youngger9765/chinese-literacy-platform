/**
 * testHelpers.ts — shared fixture-loading helpers for the block-based lesson contract.
 *
 * These were originally inlined in `src/schema/__tests__/lessonContent.contract.test.ts`.
 * They are lifted here (single implementation) so the Phase-2 renderer tests
 * (`components/lesson-content/__tests__/*`) load the SAME shared fixtures through the
 * SAME snake→camel + zod path as the contract parity gate — keeping every test in
 * lock-step with the frozen contract in `lessonContent.ts`.
 *
 * Test-only util: imported from vitest specs. It reads files from disk (node:fs) and
 * therefore must not be imported into any browser/runtime bundle.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import { camelizeKeys, toCamel } from './camelize';
import { LessonSchema, type Lesson } from './lessonContent';

// Re-export the snake→camel helpers from their runtime-safe home so existing test
// imports (`from './testHelpers'`) keep working unchanged. The single implementation
// now lives in `camelize.ts` (no node:fs), which `api.ts` can import into the bundle.
export { camelizeKeys, toCamel };

const HERE = dirname(fileURLToPath(import.meta.url));
// frontend/src/schema → repo root → backend/tests/fixtures/lesson_content
export const FIXTURE_DIR = join(
  HERE,
  '..',
  '..',
  '..',
  'backend',
  'tests',
  'fixtures',
  'lesson_content',
);

/** List the shared `*.lesson.yml` fixture filenames. */
export function listFixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.lesson.yml'));
}

/** Read + snake→camel + zod-parse one fixture into a typed Lesson (fail-loud). */
export function loadFixture(file: string): Lesson {
  const raw = parseYaml(readFileSync(join(FIXTURE_DIR, file), 'utf-8'));
  return LessonSchema.parse(camelizeKeys(raw));
}

/** Load every shared fixture as `{ file, lesson }` (fail-loud on any parse error). */
export function loadAllFixtures(): { file: string; lesson: Lesson }[] {
  return listFixtureFiles().map((file) => ({ file, lesson: loadFixture(file) }));
}
