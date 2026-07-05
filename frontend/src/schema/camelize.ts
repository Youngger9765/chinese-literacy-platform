/**
 * camelize.ts — runtime-safe snake_case → camelCase key transform.
 *
 * The backend serializes the typed lesson_content contract in snake_case
 * (pydantic model_dump); the frontend zod `LessonSchema` is camelCase. This tiny,
 * dependency-free helper bridges the two on the wire.
 *
 * WHY A SEPARATE MODULE: the identical helpers used to live only in `testHelpers.ts`,
 * which imports `node:fs` for fixture loading and therefore MUST NOT enter the browser
 * bundle. `api.ts` needs the transform at runtime, so it is lifted here (no node:*
 * imports) and `testHelpers.ts` re-exports it — one implementation, no bundle poison.
 */

/** snake_case → camelCase for a single key segment. */
export function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Recursively camelCase object keys (arrays/scalars pass through unchanged). */
export function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[toCamel(k)] = camelizeKeys(v);
    }
    return out;
  }
  return value;
}
