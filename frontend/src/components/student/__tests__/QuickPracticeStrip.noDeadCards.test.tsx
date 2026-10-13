/**
 * #3491 — every card on the student home's 想練點什麼？ strip must lead to a
 * practice the student can actually reach. 聽寫挑戰 and 造句練習 pointed at
 * steps that are switched off (enabled: false), so they only ever reached
 * the library and then an ordinary 課程簡介.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import QuickPracticeStrip from '../QuickPracticeStrip';
import { STEP_REGISTRY } from '../../../config/stepConfig';

describe('QuickPracticeStrip', () => {
  it('shows no card for a practice whose step is switched off', () => {
    render(
      <MemoryRouter>
        <QuickPracticeStrip />
      </MemoryRouter>,
    );
    const titles = screen.getAllByRole('listitem').map((el) => el.textContent ?? '');
    expect(titles.length).toBeGreaterThan(0);
    const off = Object.values(STEP_REGISTRY)
      .filter((s) => s.enabled === false)
      .map((s) => s.label);
    // Precondition: both practices are still switched off, else this test is moot.
    expect(off).toEqual(expect.arrayContaining(['造句練習', '聽寫練習']));
    // The card said 聽寫挑戰 for the step labelled 聽寫練習.
    for (const label of [...off, '聽寫挑戰']) {
      expect(titles.some((t) => t.includes(label))).toBe(false);
    }
  });
});
