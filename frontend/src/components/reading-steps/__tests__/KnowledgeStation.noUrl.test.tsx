/**
 * 有影片但沒有連結 ≠ 沒有影片。
 *
 * 二修的 5 課（一修沒有對應課、URL 還躺在紙本的 QR code 裡）帶著片名、來源、
 * 長度，就是沒有 `url`。前端 `.filter(v => !!v.url)` 把它們全濾掉，清單變空，
 * 於是畫面說「這篇課文目前沒有知識補給站影片」。
 *
 * 那句話是不實的：影片存在，我們只是還沒有連結。
 * 這跟今天反覆出現的那一族一樣 —— **缺資料的狀態被畫成「沒有這個東西」**。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import KnowledgeStation from '../KnowledgeStation';

const WITHOUT_URL = {
  id: 'L0116', title: '塞翁失馬，焉知非福',
  videoLinks: [
    { title: '【蘋中人】跨越0.001秒的遺憾 最速男楊俊瀚', url: null, source: '蘋果新聞網', duration: '(5:23)' },
    { title: '田徑為運動之母! 直擊飛毛腿養成班', url: null, source: 'TVBS NEWS', duration: '(3:53)' },
  ],
};

const WITH_URL = {
  id: 'L0001', title: '十秒的背後',
  videoLinks: [{ title: '最速男楊俊瀚', url: 'http://youtu.be/NYA5OHRks34' }],
};

describe('知識補給站：沒有連結的影片仍然要出現', () => {
  it('不可以說「沒有影片」', () => {
    render(<KnowledgeStation story={WITHOUT_URL as never} />);
    expect(screen.queryByText(/目前沒有知識補給站影片/)).toBeNull();
  });

  it('片名要看得到', () => {
    render(<KnowledgeStation story={WITHOUT_URL as never} />);
    expect(screen.getByText(/最速男楊俊瀚/)).toBeTruthy();
    expect(screen.getByText(/田徑為運動之母/)).toBeTruthy();
  });

  it('要說清楚連結在哪（不然學生不知道怎麼看）', () => {
    render(<KnowledgeStation story={WITHOUT_URL as never} />);
    // 兩支影片各一段說明，所以是 getAllByText —— getByText 會因為「找到多個」而失敗
    expect(screen.getAllByText(/QR code/).length).toBe(2);
  });

  it('真的沒有影片時仍然要說沒有（負向對照）', () => {
    render(<KnowledgeStation story={{ id: 'x', title: 'x', videoLinks: [] } as never} />);
    expect(screen.getByText(/目前沒有知識補給站影片/)).toBeTruthy();
  });

  it('有連結的照舊可以播（正向對照）', () => {
    const { container } = render(<KnowledgeStation story={WITH_URL as never} />);
    expect(container.querySelector('iframe')).toBeTruthy();
  });
});
