/**
 * Display label for a library grade filter (#2683).
 *
 * `grade` is a string, and only some of its values are year groups. The second
 * edition added 文言文 and 品格教育 — standalone collections, not years — so the
 * hardcoded `第 {grade} 級` rendered them as 「第 文言文 級」.
 *
 * Kept as a pure function rather than inline JSX so the naming rule has one home
 * and can be tested without mounting the page.
 */
export function gradeLabel(grade: string): string {
  return /^\d+$/.test(grade) ? `第 ${grade} 級` : grade;
}
