/**
 * Regression lock for #3987 UI-4: `pb-48` left too little clearance for a
 * video embedded near the end (影片2) — it could sit right at the edge of
 * the fixed 下一關 button's fade zone. Bumped to `pb-56`.
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import KnowledgeStation from '../KnowledgeStation';

const WITH_URL = {
  id: 'L0001', title: '十秒的背後',
  videoLinks: [{ title: '最速男楊俊瀚', url: 'http://youtu.be/NYA5OHRks34' }],
};

describe('KnowledgeStation scroll-container bottom clearance (#3987 UI-4)', () => {
  it('scroll container carries pb-56, not the old pb-48', () => {
    const { container } = render(<KnowledgeStation story={WITH_URL as never} onFinish={() => {}} />);
    const scrollArea = container.querySelector('.overflow-y-auto');
    expect(scrollArea).toBeTruthy();
    const classes = scrollArea!.className.split(/\s+/);
    expect(classes).toContain('pb-56');
    expect(classes).not.toContain('pb-48');
  });
});
