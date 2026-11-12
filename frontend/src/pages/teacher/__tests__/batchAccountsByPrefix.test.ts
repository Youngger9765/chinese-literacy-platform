import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ACCOUNT_COUNT,
  generateRandomCode,
  getAccountCountValidation,
  getPrefixValidation,
  getSharedPasswordValidation,
  previewAccountsByPrefix,
} from '../batchAccountsByPrefix';

// Mirrors the module's own private alphabet constants -- kept in sync
// deliberately rather than exported, so these tests assert on the real
// observable contract (what characters a caller can see), not an
// implementation detail re-imported from the module under test.
const CHARACTERS = 'abcdefghijkmnopqrstuvwxyz023456789';
const ALPHABET = CHARACTERS.slice(0, 25);

describe('getPrefixValidation', () => {
  it('accepts a normal letters-only prefix', () => {
    expect(getPrefixValidation('abc').valid).toBe(true);
  });

  it('accepts letters followed by digits', () => {
    expect(getPrefixValidation('abc123').valid).toBe(true);
  });

  it('rejects too short (<3 chars)', () => {
    expect(getPrefixValidation('ab').valid).toBe(false);
  });

  it('rejects empty', () => {
    expect(getPrefixValidation('').valid).toBe(false);
  });

  it('rejects starting with a digit', () => {
    expect(getPrefixValidation('1abc').valid).toBe(false);
  });

  it('rejects special characters', () => {
    expect(getPrefixValidation('ab-c').valid).toBe(false);
    expect(getPrefixValidation('ab c').valid).toBe(false);
    expect(getPrefixValidation('五年三班').valid).toBe(false);
  });

  it('rejects longer than 20 chars', () => {
    expect(getPrefixValidation('a'.repeat(21)).valid).toBe(false);
  });
});

describe('getSharedPasswordValidation', () => {
  it('accepts a normal password', () => {
    expect(getSharedPasswordValidation('abcde').valid).toBe(true);
  });

  it('rejects too short (<5 chars)', () => {
    expect(getSharedPasswordValidation('ab1').valid).toBe(false);
  });

  it('rejects starting with a digit', () => {
    expect(getSharedPasswordValidation('1abcd').valid).toBe(false);
  });

  it('rejects special characters', () => {
    expect(getSharedPasswordValidation('ab cde').valid).toBe(false);
  });
});

describe('getAccountCountValidation', () => {
  it('accepts a count within range', () => {
    expect(getAccountCountValidation(5).valid).toBe(true);
  });

  it('rejects zero', () => {
    expect(getAccountCountValidation(0).valid).toBe(false);
  });

  it('rejects negative numbers', () => {
    expect(getAccountCountValidation(-1).valid).toBe(false);
  });

  it(`accepts exactly the cap (${MAX_ACCOUNT_COUNT})`, () => {
    expect(getAccountCountValidation(MAX_ACCOUNT_COUNT).valid).toBe(true);
  });

  it(`rejects one above the cap (${MAX_ACCOUNT_COUNT + 1})`, () => {
    expect(getAccountCountValidation(MAX_ACCOUNT_COUNT + 1).valid).toBe(false);
  });
});

describe('previewAccountsByPrefix', () => {
  it('generates prefix01..prefixNN with 2-digit zero padding', () => {
    const rows = previewAccountsByPrefix('abc', 'pw1234', 3);
    expect(rows.map((r) => r.identifier)).toEqual(['abc01', 'abc02', 'abc03']);
  });

  it('shares the same password across every generated row', () => {
    const rows = previewAccountsByPrefix('abc', 'pw1234', 3);
    expect(rows.every((r) => r.password === 'pw1234')).toBe(true);
  });

  it('always 2-digit-pads at the boundary count (cap=50 never needs 3 digits)', () => {
    const rows = previewAccountsByPrefix('abc', 'pw1234', MAX_ACCOUNT_COUNT);
    expect(rows[0].identifier).toBe('abc01');
    expect(rows[MAX_ACCOUNT_COUNT - 1].identifier).toBe(`abc${MAX_ACCOUNT_COUNT}`);
  });

  it('lowercases the prefix in generated identifiers', () => {
    const rows = previewAccountsByPrefix('ABC', 'pw1234', 1);
    expect(rows[0].identifier).toBe('abc01');
  });

  it('returns empty when prefix is invalid', () => {
    expect(previewAccountsByPrefix('1abc', 'pw1234', 3)).toEqual([]);
  });

  it('returns empty when password is invalid', () => {
    expect(previewAccountsByPrefix('abc', 'ab', 3)).toEqual([]);
  });

  it('returns empty when count is zero (default empty-field state)', () => {
    expect(previewAccountsByPrefix('abc', 'pw1234', 0)).toEqual([]);
  });

  it('returns empty when count exceeds the cap', () => {
    expect(previewAccountsByPrefix('abc', 'pw1234', MAX_ACCOUNT_COUNT + 1)).toEqual([]);
  });
});

// Security review follow-up (#3991): generateRandomCode backs the DEFAULT
// shared password the batch-by-prefix dialog offers the teacher. It must
// use a CSPRNG (crypto.getRandomValues), not Math.random(), and must not
// be biased by a naive `% max` on top of it.
describe('generateRandomCode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls crypto.getRandomValues -- not Math.random', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    generateRandomCode(5);
    expect(spy).toHaveBeenCalled();
  });

  it('produces only allowed characters (a-z minus l, digits minus 1) at the expected length', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateRandomCode(5);
      expect(code).toHaveLength(5);
      for (const ch of code) {
        expect(CHARACTERS.includes(ch)).toBe(true);
      }
    }
  });

  it('always starts with a letter, never a digit', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateRandomCode(5);
      expect(ALPHABET.includes(code[0])).toBe(true);
    }
  });

  it('kept kid-typeable: default length stays short (5), not 10+', () => {
    // Pins the length this module's one real caller (TeacherDashboard's
    // generateRandomCode(5) default-suggestion effect) asks for, so a
    // future "longer = more secure" edit doesn't silently land here.
    expect(generateRandomCode(5)).toHaveLength(5);
  });

  it('rejection sampling: a biased-tail draw is discarded and re-drawn, not reused', () => {
    // secureRandomIndex(25)'s range is 250 (256 - 256 % 25). A drawn byte
    // of 250 falls in the rejected tail and MUST be thrown away; the next
    // draw (5) is accepted -> index 5 % 25 = 5 -> ALPHABET[5] = 'f'. If the
    // implementation regressed to a naive `byte % 25` (biased, no
    // rejection), the first draw (250 % 25 = 0 -> 'a') would be used
    // directly and only ONE draw would happen.
    const sequence = [250, 5];
    let call = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => {
      (buf as Uint8Array)[0] = sequence[call];
      call += 1;
      return buf;
    });
    const code = generateRandomCode(1);
    expect(code).toBe('f');
    expect(call).toBe(2);
  });
});
