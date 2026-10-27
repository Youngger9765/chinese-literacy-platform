/**
 * WordBabiesLab — TDD tests (#3780).
 *
 * G3 動線: a return/back link must exist and must not require learning any
 * new navigation pattern.
 * G5/feed button: must be disabled with a "還差 N 片" message when the
 * wallet has none of the baby's diet flavors, and clicking it when enabled
 * must call feedWordBaby then refresh the collection.
 * G6 文案: no death language anywhere on the page.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WordBabiesLab from './WordBabiesLab';
import * as wordBabyApi from '../../services/wordBabyApi';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'tok', user: { id: 1 } }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <WordBabiesLab />
    </MemoryRouter>,
  );
}

describe('WordBabiesLab — empty state', () => {
  it('shows the 0/100 dex count and an explanation, with a return link', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [],
      babies_owned_count: 0,
      babies_total_species: 100,
      wallet: {},
      fragments_in_wallet: 0,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText(/0.*100/)).toBeInTheDocument());
    // G3: a way back must exist — the page must not be a dead end.
    expect(screen.getByRole('link', { name: /返回|回|首頁/ })).toBeInTheDocument();
  });

  it('never shows death-related wording anywhere on the empty page', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [], babies_owned_count: 0, babies_total_species: 100, wallet: {}, fragments_in_wallet: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/0.*100/)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/死亡|掛掉|死了/);
  });

  it('opens with a positive sentence, not "打開這一頁不會得到任何東西" (team-lead 2026-10-27 #5)', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [], babies_owned_count: 0, babies_total_species: 100, wallet: {}, fragments_in_wallet: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/0.*100/)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/不會得到任何東西/);
  });
});

describe('WordBabiesLab — one owned, healthy, feedable baby', () => {
  beforeEach(() => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [{
        baby_id: 'wb-071',
        name: '伴手禮',
        rarity: 'uncommon',
        stage_index: 1,
        stage_count: 3,
        fully_grown: false,
        dormant_type: null,
        weaken_state: 'healthy',
        fed_current_stage: 1,
        hatch_days_remaining: null,
      }],
      babies_owned_count: 1,
      babies_total_species: 100,
      wallet: { 朗讀表達: 2 },
      fragments_in_wallet: 2,
    });
  });

  it('shows the baby name and an enabled feed button', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('伴手禮')).toBeInTheDocument());
    const feedButton = screen.getByRole('button', { name: /餵/ });
    expect(feedButton).not.toBeDisabled();
  });

  it('shows what the baby eats as individual tags, team-lead 2026-10-27 (both rounds)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('伴手禮')).toBeInTheDocument());
    expect(screen.getByText(/愛吃/)).toBeInTheDocument();
    // round 2: each flavor is its own tag, not "X碎片、Y碎片" joined into one
    // string — these flavor names also appear in the wallet cells below, so
    // assert at-least-one-match rather than uniqueness.
    expect(screen.getAllByText('朗讀表達').length).toBeGreaterThan(0);
    expect(screen.getAllByText('書寫紀錄').length).toBeGreaterThan(0);
  });

  it('highlights the matching wallet flavor cell, team-lead 2026-10-27 #2', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('伴手禮')).toBeInTheDocument());
    const walletCell = screen.getByTestId('wallet-flavor-朗讀表達');
    expect(walletCell.dataset.needed).toBe('true');
  });

  it('clicking feed calls feedWordBaby and refreshes the collection', async () => {
    const feedSpy = vi.spyOn(wordBabyApi, 'feedWordBaby').mockResolvedValue({
      baby_id: 'wb-071', stage_index: 1, stage_count: 3, fully_grown: false,
      dormant_type: null, weaken_state: 'healthy', fed_current_stage: 2,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('伴手禮')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /餵/ }));

    await waitFor(() => expect(feedSpy).toHaveBeenCalledWith(1, 'wb-071', 'tok'));
    await waitFor(() => expect(wordBabyApi.fetchMyWordBabies).toHaveBeenCalledTimes(2));
  });
});

describe('WordBabiesLab — owned baby with no matching fragments', () => {
  it('disables the feed button and shows how many fragments are still needed', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [{
        baby_id: 'wb-071',
        name: '伴手禮',
        rarity: 'uncommon',
        stage_index: 1,
        stage_count: 3,
        fully_grown: false,
        dormant_type: null,
        weaken_state: 'healthy',
        fed_current_stage: 1,
        hatch_days_remaining: null,
      }],
      babies_owned_count: 1,
      babies_total_species: 100,
      wallet: {}, // none of wb-071's diet flavors
      fragments_in_wallet: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('伴手禮')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /餵/ })).toBeDisabled();
    // team-lead 2026-10-27 round 2: two short lines, flavor name NOT repeated
    // here (it's already in the 愛吃 tags) — stage1 cost 3, fed 1 -> 2 more
    expect(screen.getByText(/還差.*2.*片/)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/多朗讀課文/);
  });
});

describe('WordBabiesLab — dormant (egg) baby', () => {
  it('shows the friendly dormancy phrase and hides the feed button', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [{
        baby_id: 'wb-001',
        name: '宏亮',
        rarity: 'common',
        stage_index: 1,
        stage_count: 3,
        fully_grown: false,
        dormant_type: '繭',
        weaken_state: 'healthy',
        fed_current_stage: 0,
        hatch_days_remaining: 2,
      }],
      babies_owned_count: 1,
      babies_total_species: 100,
      wallet: {},
      fragments_in_wallet: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('宏亮')).toBeInTheDocument());
    expect(screen.getByText(/結成了繭/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /餵/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/死亡|掛掉|死了/);
  });
});

describe('WordBabiesLab — weakened baby', () => {
  it('shows the "躲起來了" wording, not death language', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [{
        baby_id: 'wb-001',
        name: '宏亮',
        rarity: 'common',
        stage_index: 1,
        stage_count: 3,
        fully_grown: false,
        dormant_type: null,
        weaken_state: 'weak',
        fed_current_stage: 0,
        hatch_days_remaining: null,
      }],
      babies_owned_count: 1,
      babies_total_species: 100,
      wallet: {},
      fragments_in_wallet: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('宏亮')).toBeInTheDocument());
    expect(screen.getByText(/躲起來了/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/死亡|掛掉|死了/);
  });

  it('explains how to bring it back, team-lead 2026-10-27 #3', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [{
        baby_id: 'wb-001', name: '宏亮', rarity: 'common', stage_index: 1, stage_count: 3,
        fully_grown: false, dormant_type: null, weaken_state: 'weak', fed_current_stage: 0,
        hatch_days_remaining: null,
      }],
      babies_owned_count: 1, babies_total_species: 100, wallet: {}, fragments_in_wallet: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('宏亮')).toBeInTheDocument());
    expect(document.body.textContent).toMatch(/讀一課課文/);
  });
});

describe('WordBabiesLab — section order (team-lead 2026-10-27 #1)', () => {
  it('puts 我養的寶貝 before 碎片背包 before 圖鑑 in document order', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [{
        baby_id: 'wb-071', name: '伴手禮', rarity: 'uncommon', stage_index: 1, stage_count: 3,
        fully_grown: false, dormant_type: null, weaken_state: 'healthy', fed_current_stage: 1,
        hatch_days_remaining: null,
      }],
      babies_owned_count: 1, babies_total_species: 100, wallet: { 朗讀表達: 2 }, fragments_in_wallet: 2,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('伴手禮')).toBeInTheDocument());

    const petsHeading = screen.getByRole('heading', { name: /我養的寶貝/ });
    const walletHeading = screen.getByRole('heading', { name: /碎片背包/ });
    const dexHeading = screen.getByRole('heading', { name: /圖鑑/ });

    // DOCUMENT_POSITION_FOLLOWING = 4: compareDocumentPosition(B) called on A
    // returns 4 when B comes AFTER A in the document.
    expect(petsHeading.compareDocumentPosition(walletHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(walletHeading.compareDocumentPosition(dexHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('WordBabiesLab — dex is collapsed by default (team-lead 2026-10-27 #1)', () => {
  it('shows fewer than all 100 dex cells until "看全部 100 隻" is clicked', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [], babies_owned_count: 0, babies_total_species: 100, wallet: {}, fragments_in_wallet: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/0.*100/)).toBeInTheDocument());

    const expandButton = screen.getByRole('button', { name: /看全部.*100/ });
    const cellsBefore = screen.getAllByText('❔').length;
    expect(cellsBefore).toBeLessThan(100);

    fireEvent.click(expandButton);
    const cellsAfter = screen.getAllByText('❔').length;
    expect(cellsAfter).toBe(100);
  });
});

describe('WordBabiesLab — large icon on the card itself (team-lead 2026-10-27 #4)', () => {
  it('shows a large icon for the owned baby beyond just the dex cell', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [{
        baby_id: 'wb-071', name: '伴手禮', rarity: 'uncommon', stage_index: 1, stage_count: 3,
        fully_grown: false, dormant_type: null, weaken_state: 'healthy', fed_current_stage: 1,
        hatch_days_remaining: null,
      }],
      babies_owned_count: 1, babies_total_species: 100, wallet: { 朗讀表達: 2 }, fragments_in_wallet: 2,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('伴手禮')).toBeInTheDocument());
    expect(screen.getByTestId('baby-card-icon-wb-071')).toBeInTheDocument();
  });
});

describe('WordBabiesLab — structured feeding button bug (review finding 2026-10-27 round 3)', () => {
  it('does not enable the feed button when the wallet only has an already-capped flavor (wb-041)', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [{
        baby_id: 'wb-041', // legendary, stage1 requires {文言文: 1, 語文基礎: 1}
        name: '濛濛亮',
        rarity: 'legendary',
        stage_index: 1,
        stage_count: 5,
        fully_grown: false,
        dormant_type: null,
        weaken_state: 'healthy',
        fed_current_stage: 1,
        hatch_days_remaining: null,
        fed_by_flavor: { 語文基礎: 1 }, // 語文基礎 already capped, 文言文 still 0
      }],
      babies_owned_count: 1,
      babies_total_species: 100,
      // only the ALREADY-SATISFIED flavor has stock — the old bug summed
      // this as "10 > 0, button on", but feeding would be a silent no-op.
      wallet: { 語文基礎: 10, 文言文: 0 },
      fragments_in_wallet: 10,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('濛濛亮')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /餵/ })).toBeDisabled();
    // the shortfall hint must point at 文言文 (the actually-outstanding flavor)
    expect(document.body.textContent).toMatch(/文言文/);
  });

  it('enables the feed button once the wallet has stock for the outstanding flavor', async () => {
    vi.spyOn(wordBabyApi, 'fetchMyWordBabies').mockResolvedValue({
      babies: [{
        baby_id: 'wb-041',
        name: '濛濛亮',
        rarity: 'legendary',
        stage_index: 1,
        stage_count: 5,
        fully_grown: false,
        dormant_type: null,
        weaken_state: 'healthy',
        fed_current_stage: 1,
        hatch_days_remaining: null,
        fed_by_flavor: { 語文基礎: 1 },
      }],
      babies_owned_count: 1,
      babies_total_species: 100,
      wallet: { 語文基礎: 10, 文言文: 1 },
      fragments_in_wallet: 11,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('濛濛亮')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /餵/ })).not.toBeDisabled();
  });
});
