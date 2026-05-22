/**
 * Tests for DetailHeaderCard (Issue #1847)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DetailHeaderCard from '../DetailHeaderCard';

describe('DetailHeaderCard', () => {
  it('renders the title', () => {
    render(<DetailHeaderCard title="測試機構" />);
    expect(screen.getByText('測試機構')).toBeTruthy();
  });

  it('renders subtitle when provided', () => {
    render(<DetailHeaderCard title="機構" subtitle="副名稱" />);
    expect(screen.getByText('副名稱')).toBeTruthy();
  });

  it('renders badge with correct text', () => {
    render(
      <DetailHeaderCard
        title="機構"
        badge={{ label: '啟用', variant: 'green' }}
      />,
    );
    expect(screen.getByText('啟用')).toBeTruthy();
  });

  it('renders actions slot', () => {
    render(
      <DetailHeaderCard
        title="機構"
        actions={<button>編輯</button>}
      />,
    );
    expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
  });

  it('renders without badge or actions without crashing', () => {
    render(<DetailHeaderCard title="Simple" />);
    expect(screen.getByText('Simple')).toBeTruthy();
  });
});
