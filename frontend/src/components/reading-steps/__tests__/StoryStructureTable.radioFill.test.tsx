/**
 * StoryStructureTable.radioFill.test.tsx — #2832
 *
 * A selected select_mode='single' option rendered its "filled" marker as the
 * Unicode glyph U+25CF ('●') on top of an amber-500 background. In the fonts
 * actually served on staging that glyph paints as a near-full-box white disc,
 * covering almost the entire amber fill and leaving only the 2px border ring
 * visible — i.e. the opposite of "filled" (Young, 2026-08-19/21: "radio 點擊後
 * 有 fill 啊！！！怎麼還是空心？？？"). Font-glyph sizing isn't something a DOM
 * test can see directly, so this test locks the STRUCTURAL fix instead: the
 * marker must not render that glyph at all for a selected radio, and must
 * instead carry a small fixed-size CSS dot (`w-1.5 h-1.5 rounded-full`) whose
 * size can't drift with font/platform the way a text glyph's ink can.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    mustChangePassword: false,
    loginPassword: null,
    needsTermsAcceptance: false,
    hasClassroom: true,
    teacherGatingEnforced: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    clearMustChangePassword: vi.fn(),
    refreshUser: vi.fn(),
    acceptTerms: vi.fn(),
    loginWithGoogle: vi.fn(),
    loginWithJunyi: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import StoryStructureTable from '../StoryStructureTable';

function mockFetchSuccess(data: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SINGLE_SELECT_STRUCTURE = {
  layout: 'worksheet_table',
  title: '文章重點表',
  worksheet_rows: [
    {
      kind: 'section_block',
      section: '事例',
      items: [{ label: '經過', value: '(單選，請打勾)\n①積極的面對與復健 ②放棄跑步、不願治療' }],
    },
  ],
  rows: [
    {
      label: '事例',
      value: '',
      interactive_type: 'display',
      sub_rows: [
        {
          label: '經過',
          value: '比賽時受傷了，他選擇【 單選 】\n①積極的面對與復健 ②放棄跑步、不願治療',
          interactive_type: 'checkbox',
          options: ['積極的面對與復健', '放棄跑步、不願治療'],
          select_mode: 'single',
        },
      ],
    },
  ],
};

describe('StoryStructureTable — selected radio marker (#2832)', () => {
  it('does not render the oversized ● glyph, and shows a small fixed-size CSS dot instead', async () => {
    mockFetchSuccess(SINGLE_SELECT_STRUCTURE);
    render(<StoryStructureTable storyId="lesson-2832" showCoach={false} />);
    await waitFor(() => expect(screen.getByText('經過')).toBeTruthy());

    const optionLabel = screen.getByText('積極的面對與復健').closest('label') as HTMLElement;
    const input = optionLabel.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('radio');

    fireEvent.click(optionLabel);
    await waitFor(() => expect(input.checked).toBe(true));

    // The decorative marker is the label's first child span (sibling of the sr-only input).
    const marker = optionLabel.querySelector('span') as HTMLElement;
    expect(marker).toBeTruthy();

    // The bug: this glyph used to sit directly in the marker's text content.
    expect(marker.textContent).not.toContain('●');

    // The fix: a small, fixed-size inner dot — not text, so it can't be
    // font-rescaled into a shape big enough to cover the surrounding fill.
    const innerDot = marker.querySelector('span');
    expect(innerDot, 'inner filled dot').toBeTruthy();
    expect(innerDot!.className).toContain('rounded-full');
    expect(innerDot!.className).toContain('bg-white');
    expect(innerDot!.className).toMatch(/w-1\.5/);
    expect(innerDot!.className).toMatch(/h-1\.5/);
  });

  it('a checkbox (select_mode unset) selected option still shows the ✓ glyph (unaffected by the radio fix)', async () => {
    const multi = {
      ...SINGLE_SELECT_STRUCTURE,
      rows: [
        {
          ...SINGLE_SELECT_STRUCTURE.rows[0],
          sub_rows: [
            {
              ...SINGLE_SELECT_STRUCTURE.rows[0].sub_rows[0],
              select_mode: undefined,
            },
          ],
        },
      ],
    };
    mockFetchSuccess(multi);
    render(<StoryStructureTable storyId="lesson-2832-multi" showCoach={false} />);
    await waitFor(() => expect(screen.getByText('經過')).toBeTruthy());

    const optionLabel = screen.getByText('積極的面對與復健').closest('label') as HTMLElement;
    const input = optionLabel.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('checkbox');

    fireEvent.click(optionLabel);
    await waitFor(() => expect(input.checked).toBe(true));

    const marker = optionLabel.querySelector('span') as HTMLElement;
    expect(marker.textContent).toContain('✓');
  });
});
