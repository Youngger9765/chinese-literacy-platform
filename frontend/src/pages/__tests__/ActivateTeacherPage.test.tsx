/**
 * Tests for ActivateTeacherPage — #3804 self-serve teacher activation,
 * rewritten for #3812 §4.4: county select + directory search + suggestions
 * + "找不到我的學校" manual fallback, replacing the plain free-text input.
 *
 * Design reference: docs/prd/2026-11-01-school-as-teacher-attribute-prd.md §10.2–§10.5, §4.4.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ActivateTeacherPage from '../ActivateTeacherPage';
import * as authApi from '../../services/authApi';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

const refreshUserMock = vi.fn().mockResolvedValue(undefined);
const setActiveViewMock = vi.fn();

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', refreshUser: refreshUserMock }),
}));

vi.mock('../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ setActiveView: setActiveViewMock }),
}));

vi.mock('../../services/authApi', async () => {
  const actual = await vi.importActual<typeof import('../../services/authApi')>('../../services/authApi');
  return {
    ...actual,
    activateTeacher: vi.fn(),
    searchSchoolDirectory: vi.fn(),
  };
});

const DA_AN_TAIPEI: authApi.SchoolDirectoryItem = {
  id: 1,
  moe_school_code: '333602',
  name: '市立大安國小',
  county_name: '台北市',
  school_level: 'elementary',
  is_public: true,
};

async function searchAndSelect(user: string, select: string) {
  fireEvent.change(screen.getByLabelText('學校 1 縣市'), { target: { value: '台北市' } });
  fireEvent.change(screen.getByLabelText('學校 1 名稱搜尋'), { target: { value: user } });
  vi.advanceTimersByTime(400);
  await waitFor(() => expect(screen.getByText(select)).toBeTruthy());
  fireEvent.click(screen.getByText(select));
}

describe('ActivateTeacherPage (#3804, #3812)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshUserMock.mockResolvedValue(undefined);
    vi.mocked(authApi.searchSchoolDirectory).mockResolvedValue({
      items: [],
      total: 0,
      suggestions: null,
    });
  });

  it('renders a county select and a school-name search box for the first school, no free-text input by default', () => {
    render(<ActivateTeacherPage />);
    expect(screen.getByRole('heading', { name: '開通老師身分' })).toBeTruthy();
    expect(screen.getByLabelText('學校 1 縣市')).toBeTruthy();
    expect(screen.getByLabelText('學校 1 名稱搜尋')).toBeTruthy();
    expect(screen.getByText('找不到我的學校')).toBeTruthy();
    expect(screen.getByRole('button', { name: '開通老師身分' })).toBeTruthy();
  });

  describe('directory search + select', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it('selecting a county and typing calls the directory search API with both params (debounced)', async () => {
      vi.mocked(authApi.searchSchoolDirectory).mockResolvedValue({
        items: [DA_AN_TAIPEI],
        total: 1,
        suggestions: null,
      });
      render(<ActivateTeacherPage />);

      fireEvent.change(screen.getByLabelText('學校 1 縣市'), { target: { value: '台北市' } });
      fireEvent.change(screen.getByLabelText('學校 1 名稱搜尋'), { target: { value: '大按' } });

      // debounced -- must not fire immediately on every keystroke
      expect(authApi.searchSchoolDirectory).not.toHaveBeenCalled();
      vi.advanceTimersByTime(400);

      await waitFor(() => {
        expect(authApi.searchSchoolDirectory).toHaveBeenCalledWith('test-token', '台北市', '大按');
      });
    });

    it('shows search results in a dropdown and selecting one locks it in', async () => {
      vi.mocked(authApi.searchSchoolDirectory).mockResolvedValue({
        items: [DA_AN_TAIPEI],
        total: 1,
        suggestions: null,
      });
      render(<ActivateTeacherPage />);

      await searchAndSelect('大按', '市立大安國小');

      // the selected school is now shown, locked in (search input/dropdown gone for this row)
      expect(screen.getByText('市立大安國小')).toBeTruthy();
      expect(screen.queryByLabelText('學校 1 名稱搜尋')).toBeNull();
    });

    it('submitting a directory-selected school sends moe_school_code in the payload, not a name', async () => {
      vi.mocked(authApi.searchSchoolDirectory).mockResolvedValue({
        items: [DA_AN_TAIPEI],
        total: 1,
        suggestions: null,
      });
      vi.mocked(authApi.activateTeacher).mockResolvedValueOnce({
        schools: [{ id: 1, name: '市立大安國小', is_new: false, role_active: true }],
        roles: [],
      });
      render(<ActivateTeacherPage />);

      await searchAndSelect('大按', '市立大安國小');
      fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));

      await waitFor(() => {
        expect(authApi.activateTeacher).toHaveBeenCalledWith('test-token', [
          { moe_school_code: '333602' },
        ]);
      });
    });

    it('zero results shows the AI suggestions, and clicking one re-runs the search with that name', async () => {
      vi.mocked(authApi.searchSchoolDirectory).mockResolvedValueOnce({
        items: [],
        total: 0,
        suggestions: [{ school_name: '大安國小', reason: '讀音相近' }],
      });
      render(<ActivateTeacherPage />);

      fireEvent.change(screen.getByLabelText('學校 1 縣市'), { target: { value: '台北市' } });
      fireEvent.change(screen.getByLabelText('學校 1 名稱搜尋'), { target: { value: '大按國校' } });
      vi.advanceTimersByTime(400);

      await waitFor(() => {
        expect(screen.getByText(/您是不是要找/)).toBeTruthy();
        expect(screen.getByText('大安國小')).toBeTruthy();
      });

      vi.mocked(authApi.searchSchoolDirectory).mockResolvedValueOnce({
        items: [DA_AN_TAIPEI],
        total: 1,
        suggestions: null,
      });
      fireEvent.click(screen.getByText('大安國小'));
      vi.advanceTimersByTime(400);

      await waitFor(() => {
        expect(authApi.searchSchoolDirectory).toHaveBeenLastCalledWith('test-token', '台北市', '大安國小');
      });
      // clicking a suggestion re-searches -- it does NOT submit a bare name
      // directly, since the LLM's wording may not match the directory's.
      expect(screen.getByLabelText('學校 1 名稱搜尋')).toHaveValue('大安國小');
    });

    it('the suggestions box does not float over the submit button (#3817 — it must push content down, not overlay it)', async () => {
      vi.mocked(authApi.searchSchoolDirectory).mockResolvedValueOnce({
        items: [],
        total: 0,
        suggestions: [{ school_name: '大安國小', reason: '讀音相近' }],
      });
      render(<ActivateTeacherPage />);

      fireEvent.change(screen.getByLabelText('學校 1 縣市'), { target: { value: '台北市' } });
      fireEvent.change(screen.getByLabelText('學校 1 名稱搜尋'), { target: { value: '大按國校' } });
      vi.advanceTimersByTime(400);

      const label = await screen.findByText(/您是不是要找/);
      const suggestionBox = label.closest('div');
      // `position: absolute` is what let the box float on top of the
      // "開通老師身分" submit button below it regardless of its own
      // height. A normal-flow box can only ever push later siblings
      // down, never cover them.
      expect(suggestionBox?.className.split(/\s+/)).not.toContain('absolute');
    });

    it('submitting with no school selected shows an inline error and does not call the API', async () => {
      render(<ActivateTeacherPage />);
      fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));
      await waitFor(() => {
        expect(screen.getByText('請至少選擇一所學校')).toBeTruthy();
      });
      expect(authApi.activateTeacher).not.toHaveBeenCalled();
    });
  });

  describe('"找不到我的學校" manual fallback', () => {
    it('clicking it switches the row to a plain text input', () => {
      render(<ActivateTeacherPage />);
      fireEvent.click(screen.getByText('找不到我的學校'));
      expect(screen.getByLabelText('學校 1 名稱（手動輸入）')).toBeTruthy();
      expect(screen.queryByLabelText('學校 1 縣市')).toBeNull();
    });

    it('submitting a manually-typed name sends it as `name`, not a code', async () => {
      vi.mocked(authApi.activateTeacher).mockResolvedValueOnce({
        schools: [{ id: 2, name: '某個不在名錄裡的學校', is_new: true, role_active: true }],
        roles: [],
      });
      render(<ActivateTeacherPage />);

      fireEvent.click(screen.getByText('找不到我的學校'));
      fireEvent.change(screen.getByLabelText('學校 1 名稱（手動輸入）'), {
        target: { value: '某個不在名錄裡的學校' },
      });
      fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));

      await waitFor(() => {
        expect(authApi.activateTeacher).toHaveBeenCalledWith('test-token', [
          { name: '某個不在名錄裡的學校' },
        ]);
      });
    });

    it('submitting a blank manual name shows an inline error', async () => {
      render(<ActivateTeacherPage />);
      fireEvent.click(screen.getByText('找不到我的學校'));
      fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));
      await waitFor(() => {
        expect(screen.getByText('請至少選擇一所學校')).toBeTruthy();
      });
    });
  });

  it('success screen shows the activated school names and navigates to /teacher-home', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(authApi.searchSchoolDirectory).mockResolvedValue({
      items: [DA_AN_TAIPEI],
      total: 1,
      suggestions: null,
    });
    vi.mocked(authApi.activateTeacher).mockResolvedValueOnce({
      schools: [{ id: 1, name: '市立大安國小', is_new: false, role_active: true }],
      roles: [],
    });
    render(<ActivateTeacherPage />);

    await searchAndSelect('大按', '市立大安國小');
    fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));

    await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
    expect(setActiveViewMock).toHaveBeenCalledWith('teacher');
    expect(screen.getByText('開通成功！')).toBeTruthy();

    vi.advanceTimersByTime(1600);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/teacher-home');
    });
    vi.useRealTimers();
  });

  // Claude Security find_01RzZ2bXyjs6SrNmD7KkKy91 (high), 2026-11-05: a
  // genuinely pre-existing school grants an INACTIVE role -- the teacher
  // must see a clear "waiting for admin" message here, not the success
  // screen, and must NOT be auto-navigated to teacher-home (which would
  // immediately 403 trying to use that school).
  it('a pending (inactive) school shows the waiting-for-admin message and does not auto-navigate', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(authApi.searchSchoolDirectory).mockResolvedValue({
      items: [DA_AN_TAIPEI],
      total: 1,
      suggestions: null,
    });
    vi.mocked(authApi.activateTeacher).mockResolvedValueOnce({
      schools: [{ id: 1, name: '市立大安國小', is_new: false, role_active: false }],
      roles: [],
    });
    render(<ActivateTeacherPage />);

    await searchAndSelect('大按', '市立大安國小');
    fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));

    await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
    expect(screen.getByText('已送出開通申請')).toBeTruthy();
    expect(screen.getByText('等待學校管理員確認')).toBeTruthy();
    expect(screen.queryByText('開通成功！')).toBeNull();

    vi.advanceTimersByTime(3000);
    expect(navigateMock).not.toHaveBeenCalledWith('/teacher-home');
    vi.useRealTimers();
  });

  it('a mix of one active and one pending school shows both sections and still navigates', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(authApi.activateTeacher).mockResolvedValueOnce({
      schools: [
        { id: 1, name: '剛自建的學校', is_new: true, role_active: true },
        { id: 2, name: '教育局建檔學校', is_new: false, role_active: false },
      ],
      roles: [],
    });
    render(<ActivateTeacherPage />);

    fireEvent.click(screen.getByText('找不到我的學校'));
    fireEvent.change(screen.getByLabelText('學校 1 名稱（手動輸入）'), {
      target: { value: '剛自建的學校' },
    });
    fireEvent.click(screen.getByText('+ 再加一所學校'));
    fireEvent.click(screen.getByText('找不到我的學校', { selector: 'button' }) ??
      screen.getAllByText('找不到我的學校')[1]);
    fireEvent.change(screen.getByLabelText('學校 2 名稱（手動輸入）'), {
      target: { value: '教育局建檔學校' },
    });
    fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));

    await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
    expect(screen.getByText('開通成功！')).toBeTruthy();
    expect(screen.getByText('剛自建的學校')).toBeTruthy();
    expect(screen.getByText(/教育局建檔學校/)).toBeTruthy();

    vi.advanceTimersByTime(1600);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/teacher-home');
    });
    vi.useRealTimers();
  });

  it('a server/network error shows the retry-friendly message and keeps the form', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(authApi.searchSchoolDirectory).mockResolvedValue({
      items: [DA_AN_TAIPEI],
      total: 1,
      suggestions: null,
    });
    vi.mocked(authApi.activateTeacher).mockRejectedValueOnce(new Error('network down'));
    render(<ActivateTeacherPage />);

    await searchAndSelect('大按', '市立大安國小');
    fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));

    await waitFor(() => {
      expect(screen.getByText('開通失敗，請檢查網路連線後再試一次')).toBeTruthy();
    });
    expect(screen.getByText('市立大安國小')).toBeTruthy();
    vi.useRealTimers();
  });

  it('a backend AuthError message (e.g. validation) is shown verbatim', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(authApi.searchSchoolDirectory).mockResolvedValue({
      items: [DA_AN_TAIPEI],
      total: 1,
      suggestions: null,
    });
    vi.mocked(authApi.activateTeacher).mockRejectedValueOnce(
      new authApi.AuthError('一次最多開通 10 所學校', 422),
    );
    render(<ActivateTeacherPage />);

    await searchAndSelect('大按', '市立大安國小');
    fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));

    await waitFor(() => {
      expect(screen.getByText('一次最多開通 10 所學校')).toBeTruthy();
    });
    vi.useRealTimers();
  });

  it('adding a school field shows a second directory row; removing it hides it again', () => {
    render(<ActivateTeacherPage />);
    fireEvent.click(screen.getByText('+ 再加一所學校'));
    expect(screen.getByLabelText('學校 2 縣市')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('移除學校 2'));
    expect(screen.queryByLabelText('學校 2 縣市')).toBeNull();
  });

  it('caps the number of school rows at 5 (frontend soft cap, backend allows up to 10)', () => {
    render(<ActivateTeacherPage />);
    for (let i = 0; i < 6; i++) {
      const addButton = screen.queryByText('+ 再加一所學校');
      if (addButton) fireEvent.click(addButton);
    }
    expect(screen.getByLabelText('學校 5 縣市')).toBeTruthy();
    expect(screen.queryByLabelText('學校 6 縣市')).toBeNull();
    expect(screen.queryByText('+ 再加一所學校')).toBeNull();
  });
});
