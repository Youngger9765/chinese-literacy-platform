/**
 * 「已填 5 / 7 題」——學生全部填完了，提交鈕還是灰的。
 *
 * 用 **L0001 的真實 payload** 當資料（`fixtures/L0001-keypoints-structure.json`，
 * 由後端消毒器實跑產出），不是手寫的假結構。第一版我自己編了一個 `rows` 結構，
 * 結果測到的是另一條渲染分支 —— 真實資料是 `layout: worksheet_table` 走 `worksheet_rows`，
 * 而且指示語在那條路上已經是全形括號 `（單選）` 不是 `【單選】`。
 * 拿假資料測，修的就會是沒壞的東西。
 *
 * 學生實際能作答的元素（逐格數過）：
 *     主角          【　　　】              1
 *     雅加達亞運     checkbox 2 選項         1
 *     拿坡里世大運   checkbox 2 選項         1
 *     結果          （單選）【　　　】       1
 *     他學到了什麼？ 【　　　】×2            2
 *                                        ── 合計 6
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null, token: null, isAuthenticated: false, isLoading: false,
    mustChangePassword: false, loginPassword: null, needsTermsAcceptance: false,
    hasClassroom: true, teacherGatingEnforced: false,
    login: vi.fn(), register: vi.fn(), logout: vi.fn(),
    clearMustChangePassword: vi.fn(), refreshUser: vi.fn(), acceptTerms: vi.fn(),
    loginWithGoogle: vi.fn(), loginWithJunyi: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import StoryStructureTable from '../StoryStructureTable';
import realStructure from './fixtures/L0001-keypoints-structure.json';

/** 學生實際數得出來的可作答元素數。改 fixture 就要改這裡，而且要重數一次。 */
const ANSWERABLE = 6;

function denominator(): number {
  const el = screen.getByText(/已填\s*\d+\s*\/\s*\d+\s*題/);
  return Number(el.textContent!.match(/\/\s*(\d+)/)![1]);
}

describe('L0001 文章重點表：分母要等於學生填得完的數量', () => {
  it(`分母 == ${ANSWERABLE}（學生填滿就該能提交）`, () => {
    render(<StoryStructureTable structure={realStructure as never} />);
    expect(denominator()).toBe(ANSWERABLE);
  });

  it('作答指示「單選」仍然看得到（正向對照）', () => {
    render(<StoryStructureTable structure={realStructure as never} />);
    expect(screen.getAllByText(/單選/).length).toBeGreaterThan(0);
  });
});
