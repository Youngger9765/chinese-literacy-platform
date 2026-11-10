import { describe, expect, it } from 'vitest';
import {
  MAX_ACCOUNT_COUNT,
  getAccountCountValidation,
  getPrefixValidation,
  getSharedPasswordValidation,
  previewAccountsByPrefix,
} from '../batchAccountsByPrefix';

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
