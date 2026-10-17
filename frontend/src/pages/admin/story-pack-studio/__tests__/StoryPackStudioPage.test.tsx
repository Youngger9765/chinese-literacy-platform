/**
 * StoryPackStudioPage — behavioural tests (#3594 DB-backed migration
 * follow-up, generalized 2026-10-16). Mocks the admin API module (same
 * pattern as SemesterPanel.test.tsx) — this exercises the page's own logic
 * (list render, selecting a pack loads its JSON, invalid JSON surfaces a
 * parse error, new-pack flow), not the real backend (covered by the
 * backend pytest suite instead).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

const mockFetchPackList = vi.fn();
const mockFetchActivePack = vi.fn();
const mockFetchPack = vi.fn();
const mockValidatePackPayload = vi.fn();
const mockUpsertPack = vi.fn();
const mockDeletePack = vi.fn();
const mockSetActivePack = vi.fn();
const mockAssignSeasonPack = vi.fn();

vi.mock('../../../../services/adminStoryPackApi', () => ({
  fetchPackList: (...args: unknown[]) => mockFetchPackList(...args),
  fetchActivePack: (...args: unknown[]) => mockFetchActivePack(...args),
  fetchPack: (...args: unknown[]) => mockFetchPack(...args),
  validatePackPayload: (...args: unknown[]) => mockValidatePackPayload(...args),
  upsertPack: (...args: unknown[]) => mockUpsertPack(...args),
  deletePack: (...args: unknown[]) => mockDeletePack(...args),
  setActivePack: (...args: unknown[]) => mockSetActivePack(...args),
  assignSeasonPack: (...args: unknown[]) => mockAssignSeasonPack(...args),
  AdminStoryPackApiError: class AdminStoryPackApiError extends Error {
    status: number;
    errors?: Array<{ loc: string; msg: string }>;
    constructor(message: string, status: number, errors?: Array<{ loc: string; msg: string }>) {
      super(message);
      this.name = 'AdminStoryPackApiError';
      this.status = status;
      this.errors = errors;
    }
  },
}));

// BattleHero does a lot of its own rendering work (EnergyBar/ArtGlyph/
// milestone math) — stub it so these tests stay focused on the Studio
// page's own state machine, not BattleHero's rendering (that's covered by
// BattleHero's own tests).
vi.mock('../../../../components/league/BattleHero', () => ({
  default: ({ theme }: { theme: { title: string } }) => (
    <div data-testid="battle-hero-preview">{theme.title}</div>
  ),
}));

import StoryPackStudioPage from '../StoryPackStudioPage';

const MYTH_SUMMARY = { key: 'myth', era: '上古', title: '上古神話歷險記', is_builtin: true };
const TANG_SUMMARY = { key: 'tang-dynasty', era: '唐', title: '大唐風雲賽', is_builtin: true };
const SONG_SUMMARY = { key: 'song-dynasty', era: '宋', title: '汴京風華賽', is_builtin: true };
const WUXIA_SUMMARY = { key: 'wuxia', era: '武林', title: '武林修練記', is_builtin: true };
const DETECTIVE_SUMMARY = { key: 'detective', era: '校園', title: '少年偵探社事件簿', is_builtin: true };
const CUSTOM_SUMMARY = { key: 'ming-voyage', era: '明', title: '鄭和下西洋賽', is_builtin: false };

const VALID_PACK_BODY = {
  schema_version: 1 as const,
  key: 'ming-voyage',
  era: '明',
  title: '鄭和下西洋賽',
  intro: ['船隊出航'],
  faction_labels: ['東路', '西路'] as [string, string],
  energy_bar_label: '補給',
  milestones: [{ ratio: 1, message: '啟航' }],
  background_art: null,
  chest: { name: '寶船寶箱', description: '全班過半參與即可開啟', art: { kind: 'emoji' as const, value: '🚢' } },
  badges: [
    { key: 'individual_badge' as const, name: '領航勳章', description: '個人達標', art: { kind: 'emoji' as const, value: '⭐' } },
    { key: 'class_badge' as const, name: '船隊勳章', description: '班級達標', art: { kind: 'emoji' as const, value: '🏅' } },
  ],
  result_copy: { win: '勝利', lose: '再接再厲', draw: '平手' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchPackList.mockResolvedValue([MYTH_SUMMARY, TANG_SUMMARY, SONG_SUMMARY, WUXIA_SUMMARY, DETECTIVE_SUMMARY, CUSTOM_SUMMARY]);
  mockFetchActivePack.mockResolvedValue({ ...VALID_PACK_BODY, key: 'myth' });
  mockValidatePackPayload.mockResolvedValue({ valid: true, errors: [] });
});

describe('StoryPackStudioPage', () => {
  it('renders all five builtin packs plus the custom one, with default badge on myth', async () => {
    render(<StoryPackStudioPage />);
    await waitFor(() => expect(screen.getByText('上古神話歷險記')).toBeInTheDocument());
    expect(screen.getByText('大唐風雲賽')).toBeInTheDocument();
    expect(screen.getByText('汴京風華賽')).toBeInTheDocument();
    expect(screen.getByText('武林修練記')).toBeInTheDocument();
    expect(screen.getByText('少年偵探社事件簿')).toBeInTheDocument();
    expect(screen.getByText('鄭和下西洋賽')).toBeInTheDocument();
    expect(screen.getAllByText('內建')).toHaveLength(5);
    expect(screen.getByText('預設')).toBeInTheDocument();
  });

  it('selecting a pack loads its content into the editor', async () => {
    mockFetchPack.mockResolvedValue(VALID_PACK_BODY);
    render(<StoryPackStudioPage />);
    await waitFor(() => expect(screen.getByText('鄭和下西洋賽')).toBeInTheDocument());

    fireEvent.click(screen.getByText('鄭和下西洋賽'));

    await waitFor(() => expect(mockFetchPack).toHaveBeenCalledWith('test-token', 'ming-voyage'));
    await waitFor(() => {
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea.value).toContain('船隊出航');
    });
  });

  it('shows a JSON parse error for invalid content instead of crashing', async () => {
    mockFetchPack.mockResolvedValue(VALID_PACK_BODY);
    render(<StoryPackStudioPage />);
    await waitFor(() => expect(screen.getByText('鄭和下西洋賽')).toBeInTheDocument());
    fireEvent.click(screen.getByText('鄭和下西洋賽'));
    await waitFor(() => screen.getByRole('textbox'));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{ not valid json' } });

    await waitFor(() => expect(screen.getByText('JSON 格式錯誤')).toBeInTheDocument());
    expect(mockValidatePackPayload).not.toHaveBeenCalled();
  });

  it('new-pack flow starts from a blank template and requires a key before saving', async () => {
    render(<StoryPackStudioPage />);
    await waitFor(() => expect(screen.getByText('+ 新增劇情包')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ 新增劇情包'));

    expect(screen.getByPlaceholderText('劇情包 key（例：ming-voyage）')).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: '儲存' });
    expect(saveButton).toBeDisabled();
  });

  it('builtin pack selected disables save/delete (server is the real gate, UI just avoids a doomed round trip)', async () => {
    mockFetchPack.mockResolvedValue({ ...VALID_PACK_BODY, key: 'myth' });
    render(<StoryPackStudioPage />);
    await waitFor(() => expect(screen.getByText('上古神話歷險記')).toBeInTheDocument());
    fireEvent.click(screen.getByText('上古神話歷險記'));

    await waitFor(() => expect(screen.getByText('內建劇情包不可覆蓋或刪除，請另存新 key')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();
  });

  // Issue 3615: errors must be Chinese and field-level, one row per field.
  it('lists each validation error under its Chinese field label', async () => {
    mockFetchPack.mockResolvedValue(VALID_PACK_BODY);
    mockValidatePackPayload.mockResolvedValue({
      valid: false,
      errors: [
        { loc: 'chest.name', field: '寶箱名稱', msg: '不可包含「中國」，請改用中立的書中世界／冒險描述' },
        { loc: 'intro.1', field: '開場白第 2 段', msg: '最多 160 個字' },
      ],
    });
    render(<StoryPackStudioPage />);
    await waitFor(() => expect(screen.getByText('鄭和下西洋賽')).toBeInTheDocument());
    fireEvent.click(screen.getByText('鄭和下西洋賽'));

    const rows = await screen.findAllByTestId('story-pack-field-error');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('寶箱名稱');
    expect(rows[0]).toHaveTextContent('不可包含「中國」');
    expect(rows[1]).toHaveTextContent('開場白第 2 段');
    expect(rows[1]).toHaveTextContent('最多 160 個字');
    expect(screen.getByText('2 項錯誤')).toBeInTheDocument();
  });

  it('a rejected save shows the server field errors, in Chinese', async () => {
    mockFetchPack.mockResolvedValue(VALID_PACK_BODY);
    const api = await import('../../../../services/adminStoryPackApi');
    mockUpsertPack.mockRejectedValue(
      new api.AdminStoryPackApiError('劇情包內容驗證失敗', 422, [
        { loc: 'badges.1.description', field: '第 2 個徽章說明', msg: '不可包含「大一統」，請改用中立的書中世界／冒險描述' },
      ] as never),
    );
    render(<StoryPackStudioPage />);
    await waitFor(() => expect(screen.getByText('鄭和下西洋賽')).toBeInTheDocument());
    fireEvent.click(screen.getByText('鄭和下西洋賽'));
    await waitFor(() => expect(screen.getByRole('button', { name: '儲存' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    const rows = await screen.findAllByTestId('story-pack-field-error');
    expect(rows[0]).toHaveTextContent('第 2 個徽章說明');
    expect(rows[0]).toHaveTextContent('不可包含「大一統」');
    expect(screen.getByText('劇情包內容驗證失敗')).toBeInTheDocument();
  });

  it('a JSON syntax error is explained in Chinese, not the browser English message', async () => {
    mockFetchPack.mockResolvedValue(VALID_PACK_BODY);
    render(<StoryPackStudioPage />);
    await waitFor(() => expect(screen.getByText('鄭和下西洋賽')).toBeInTheDocument());
    fireEvent.click(screen.getByText('鄭和下西洋賽'));
    await waitFor(() => screen.getByRole('textbox'));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'oops not json' } });

    const detail = await screen.findByTestId('story-pack-json-error');
    const text = detail.textContent ?? '';
    expect(text).toContain('逗號');
    for (const english of ['Unexpected', 'token', 'position', 'is not valid']) {
      expect(text).not.toContain(english);
    }
  });
});
