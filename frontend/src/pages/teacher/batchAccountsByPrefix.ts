/**
 * Junyi-parity「幫學生建立帳號」表單邏輯 (#3991).
 *
 * Mirrors junyiacademy/frontend/legacy/studentlists-package/
 * create-studentlist-modal/utils/accountUtils.js: teacher picks ONE
 * account-name prefix + ONE shared initial password + a count, instead of
 * naming each student. This module is the frontend-only preview/validation
 * half (what the teacher sees before submitting); the backend
 * (batch_create_students_by_prefix) independently re-validates and applies
 * the same zero-padding rule server-side -- this is cosmetic, not the
 * source of truth for what actually gets created.
 */

export interface FieldValidation {
  valid: boolean;
  msg: string;
}

const START_WITH_LETTER = /^[A-Za-z]/;
const LETTERS_AND_DIGITS_ONLY = /^[A-Za-z0-9]*$/;

export function getPrefixValidation(prefix: string): FieldValidation {
  if (!prefix || prefix.length < 3) {
    return { valid: false, msg: '帳號前綴太短，至少要 3 個字元' };
  }
  if (!START_WITH_LETTER.test(prefix)) {
    return { valid: false, msg: '帳號前綴的第一個字元必須是英文字母' };
  }
  if (!LETTERS_AND_DIGITS_ONLY.test(prefix)) {
    return { valid: false, msg: '帳號前綴只能是英文字母和數字' };
  }
  if (prefix.length > 20) {
    return { valid: false, msg: '帳號前綴長度上限為 20' };
  }
  return { valid: true, msg: '' };
}

export function getSharedPasswordValidation(password: string): FieldValidation {
  if (!password || password.length < 5) {
    return { valid: false, msg: '密碼至少需包含 1 個字母＋ 4 個字元' };
  }
  if (!START_WITH_LETTER.test(password)) {
    return { valid: false, msg: '密碼的第一個字元必須是英文字母' };
  }
  if (!LETTERS_AND_DIGITS_ONLY.test(password)) {
    return { valid: false, msg: '密碼只能是英文字母和數字' };
  }
  return { valid: true, msg: '要記好這組密碼，之後只會顯示這一次' };
}

// Matches Junyi's own cap (accountUtils.js getCountValidation 單次新增數量上限為 50).
export const MAX_ACCOUNT_COUNT = 50;

export function getAccountCountValidation(count: number): FieldValidation {
  if (!count || count <= 0) {
    return { valid: false, msg: '請輸入大於零的數字' };
  }
  if (count > MAX_ACCOUNT_COUNT) {
    return { valid: false, msg: `單次新增數量上限為 ${MAX_ACCOUNT_COUNT}` };
  }
  return { valid: true, msg: '' };
}

/**
 * Cryptographically-random index in [0, max) with NO modulo bias.
 *
 * `Math.random()` is not a CSPRNG -- it's seedable/predictable in some
 * engines, and this function backs the DEFAULT shared password every
 * batch-by-prefix dialog offers the teacher (security review finding,
 * #3991 follow-up). `crypto.getRandomValues` is the Web Crypto CSPRNG,
 * available globally in every browser this app targets and in the jsdom
 * test environment.
 *
 * `x % max` alone is biased whenever 256 isn't a multiple of `max` (every
 * alphabet here: 25 and 34) -- low byte values would come up slightly more
 * often. Rejection sampling removes the bias: draw a byte, and if it falls
 * in the "leftover" tail that doesn't divide evenly into `max`-sized
 * buckets, throw it away and draw again. `max` must be <= 256 for this to
 * terminate -- true for every caller in this module.
 */
function secureRandomIndex(max: number): number {
  const range = 256 - (256 % max);
  const buf = new Uint8Array(1);
  let x = range; // start >= range so the loop always draws at least once
  while (x >= range) {
    crypto.getRandomValues(buf);
    x = buf[0];
  }
  return x % max;
}

/** Random lowercase alnum code for the default prefix/password, same
 * character set Junyi uses (drops `l`/`1` -- visually ambiguous with
 * `1`/`o`). First char always a letter so the default always validates.
 * Kept short (Junyi's own default is 5) -- a batch-created account's
 * password is meant to be read off a printed card and typed by a child,
 * so "longer is more secure" isn't the right tradeoff here; the backend
 * (`BatchStudentByPrefixRequest`) still enforces its own minimum length
 * (>=5) independent of whatever length the frontend happens to default
 * to or the teacher edits it to. */
export function generateRandomCode(length: number): string {
  const CHARACTERS = 'abcdefghijkmnopqrstuvwxyz023456789';
  const ALPHABET = CHARACTERS.slice(0, 25); // pure-letters prefix of CHARACTERS
  let result = ALPHABET.charAt(secureRandomIndex(ALPHABET.length));
  while (result.length < length) {
    result += CHARACTERS.charAt(secureRandomIndex(CHARACTERS.length));
  }
  return result;
}

export interface PreviewAccount {
  identifier: string;
  password: string;
}

/** Cosmetic-only preview list for the UI table -- the real accounts are
 * created server-side, which independently applies the same rule. */
export function previewAccountsByPrefix(
  prefix: string,
  password: string,
  count: number,
): PreviewAccount[] {
  if (
    !getPrefixValidation(prefix).valid ||
    !getSharedPasswordValidation(password).valid ||
    !getAccountCountValidation(count).valid
  ) {
    return [];
  }
  const digitWidth = Math.max(2, String(count).length);
  const list: PreviewAccount[] = [];
  for (let i = 1; i <= count; i += 1) {
    const seat = String(i).padStart(digitWidth, '0');
    list.push({ identifier: `${prefix.toLowerCase()}${seat}`, password });
  }
  return list;
}
