import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useCurrentStepId } from './useCurrentStepId';

const at = (url: string) =>
  renderHook(() => useCurrentStepId('key-passage-reading'), {
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(MemoryRouter, { initialEntries: [url] }, children),
  }).result.current;

describe('useCurrentStepId', () => {
  it('單篇課：就是路徑最後那一段', () => {
    expect(at('/learn/20011/key-passage-reading')).toBe('key-passage-reading');
  });

  it('多篇課：帶上 ?p= 的輪次，三篇的進度才不會互相覆蓋（#2916）', () => {
    expect(at('/learn/20063/key-passage-reading?p=9a7x4')).toBe('key-passage-reading#9a7x4');
    expect(at('/learn/20063/key-passage-reading?p=yprak')).toBe('key-passage-reading#yprak');
  });

  it('?p= 空字串不製造尾巴為空的 key', () => {
    expect(at('/learn/20063/key-passage-reading?p=')).toBe('key-passage-reading');
  });

  it('未註冊的路徑段退回 fallback，且不因為有 ?p= 就接受它', () => {
    expect(at('/learn/20063/not-a-step?p=9a7x4')).toBe('key-passage-reading');
  });

  it('?p= 只收乾淨的 slug，異常值一律忽略（不讓網址決定進度 key 的形狀）', () => {
    expect(at('/learn/20063/key-passage-reading?p=a%23b')).toBe('key-passage-reading');
    expect(at('/learn/20063/key-passage-reading?p=' + 'x'.repeat(40))).toBe('key-passage-reading');
  });
});
