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

/** Random lowercase alnum code for the default prefix/password, same
 * character set Junyi uses (drops `l`/`1` -- visually ambiguous with
 * `1`/`o`). First char always a letter so the default always validates. */
export function generateRandomCode(length: number): string {
  const CHARACTERS = 'abcdefghijkmnopqrstuvwxyz023456789';
  const ALPHABET = CHARACTERS.slice(0, 25); // pure-letters prefix of CHARACTERS
  let result = ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  while (result.length < length) {
    result += CHARACTERS.charAt(Math.floor(Math.random() * CHARACTERS.length));
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
