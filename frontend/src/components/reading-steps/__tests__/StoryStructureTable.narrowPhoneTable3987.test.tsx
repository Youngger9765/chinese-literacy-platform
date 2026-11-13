/**
 * Regression lock for #3987 UI-3: the keypoints worksheet table was
 * cutting row text off mid-word at 390px (no visible scroll cue, and the
 * `min-w-[28rem]` floor forced a sideways scroll a phone user never
 * discovered). Two independent changes landed in #3988:
 *
 *   1. `break-words` added to every cell-content span so a long unbroken
 *      run of characters wraps instead of overflowing.
 *   2. The table itself switches to `table-fixed` + a 3-column `<colgroup>`
 *      on narrow phones (`useIsMobile(640)`) only — #3698's iPad
 *      split-panel `min-w-[28rem]` + horizontal-scroll floor must stay
 *      untouched at >=640px (it deliberately wants scroll, not wrap).
 */
import { render, screen, waitFor } from '@testing-library/react';
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

// A plain 'pair' worksheet row — no blanks, so it does not depend on the
// fill_blank bracket heuristic. Used to assert the table's own className
// (table-fixed/colgroup vs min-w-[28rem]) independent of cell content.
const PAIR_STRUCTURE = {
  layout: 'worksheet_table',
  title: '文章重點表',
  worksheet_rows: [{ kind: 'pair', label: '主角', value: '小明' }],
  rows: [{ label: '主角', value: '小明', interactive_type: 'display' }],
};

// A fill_blank cell — routes through InlineWorksheetContent, one of the
// three call sites that gained `break-words`.
const FILL_BLANK_STRUCTURE = {
  layout: 'worksheet_table',
  title: '文章重點表',
  worksheet_rows: [
    {
      kind: 'section_block',
      section: '問題',
      items: [{ label: '問題1', value: '食客中有一位會模仿【　　　】的樣子' }],
    },
  ],
  rows: [
    {
      label: '問題',
      value: '',
      interactive_type: 'display',
      sub_rows: [
        { label: '問題1', value: '食客中有一位會模仿【　　　】的樣子', interactive_type: 'fill_blank' },
      ],
    },
  ],
};

function mockMatchMediaForWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const match = query.match(/max-width:\s*(\d+)px/);
    const maxWidth = match ? parseInt(match[1], 10) : Infinity;
    return {
      matches: width <= maxWidth,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

describe('WorksheetTable narrow-phone layout (#3987 UI-3)', () => {
  const ORIGINAL_MATCH_MEDIA = window.matchMedia;

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.matchMedia = ORIGINAL_MATCH_MEDIA;
  });

  it('cell content wraps (break-words) instead of overflowing', async () => {
    mockFetchSuccess(FILL_BLANK_STRUCTURE);
    const { container } = render(<StoryStructureTable storyId="lesson-01" showCoach={false} />);
    await waitFor(() => expect(screen.getByText(/食客中有一位會模仿/)).toBeTruthy());

    const spans = Array.from(container.querySelectorAll('span.whitespace-pre-line'));
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.className.split(/\s+/)).toContain('break-words');
    }
  });

  it('uses table-fixed + a 3-column colgroup under 640px (no horizontal-scroll floor)', async () => {
    mockMatchMediaForWidth(390);
    mockFetchSuccess(PAIR_STRUCTURE);
    const { container } = render(<StoryStructureTable storyId="lesson-01" showCoach={false} />);
    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());

    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    const classes = table!.className.split(/\s+/);
    expect(classes).toContain('table-fixed');
    expect(classes).not.toContain('min-w-[28rem]');

    const cols = table!.querySelectorAll('colgroup > col');
    expect(cols.length).toBe(3);
  });

  it('keeps the #3698 min-w-[28rem] scroll floor (no colgroup) at >=640px', async () => {
    mockMatchMediaForWidth(1024);
    mockFetchSuccess(PAIR_STRUCTURE);
    const { container } = render(<StoryStructureTable storyId="lesson-01" showCoach={false} />);
    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());

    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    const classes = table!.className.split(/\s+/);
    expect(classes).toContain('min-w-[28rem]');
    expect(classes).not.toContain('table-fixed');
    expect(table!.querySelector('colgroup')).toBeNull();
  });
});
