import { beforeEach, describe, expect, it } from 'vitest';
import { clearEntrySource, ENTRY_SOURCE_TTL_MS, markEntrySource, takeEntrySource } from '../entrySource';

describe('#4161 entrySource 暫存標記', () => {
  beforeEach(() => sessionStorage.clear());

  it('標記後讀得到，而且只讀得到一次', () => {
    markEntrySource('20011');
    expect(takeEntrySource('20011')).toBe('ai_dispatch');
    expect(takeEntrySource('20011')).toBeUndefined();
  });

  it('別的課讀不到，而且讀的當下標記就清掉（不會留到之後誤標別課）', () => {
    markEntrySource('20011');
    expect(takeEntrySource('20012')).toBeUndefined();
    expect(takeEntrySource('20011')).toBeUndefined();
  });

  it('過了有效期限就不算', () => {
    markEntrySource('20011', 'ai_dispatch', 1000);
    expect(takeEntrySource('20011', 1000 + ENTRY_SOURCE_TTL_MS + 1)).toBeUndefined();
  });

  it('期限內算（對照：不是一律回 undefined）', () => {
    markEntrySource('20011', 'ai_dispatch', 1000);
    expect(takeEntrySource('20011', 1000 + ENTRY_SOURCE_TTL_MS - 1)).toBe('ai_dispatch');
  });

  it('課號數字或文字都能對上', () => {
    markEntrySource('20011');
    expect(takeEntrySource(String(20011))).toBe('ai_dispatch');
  });

  it('壞掉的內容不丟錯、回 undefined；clear 之後讀不到', () => {
    sessionStorage.setItem('lingoleap_entry_source', '{壞掉');
    expect(takeEntrySource('1')).toBeUndefined();
    markEntrySource('1');
    clearEntrySource();
    expect(takeEntrySource('1')).toBeUndefined();
  });
});
