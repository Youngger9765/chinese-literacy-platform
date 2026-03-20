import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DiffDisplay from '../DiffDisplay';
import { DiffToken } from '../../../types';

describe('DiffDisplay', () => {
  it('returns null for empty tokens', () => {
    const { container } = render(<DiffDisplay tokens={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders correct characters with text-gray-900', () => {
    const tokens: DiffToken[] = [
      { char: '你', type: 'correct' },
      { char: '好', type: 'correct' },
    ];
    render(<DiffDisplay tokens={tokens} />);
    const spans = screen.getAllByText(/你|好/);
    spans.forEach((span) => {
      expect(span).toHaveClass('text-gray-900');
    });
  });

  it('renders wrong characters with bg-error and tooltip', () => {
    const tokens: DiffToken[] = [
      { char: '你', type: 'wrong', expected: '他' },
    ];
    render(<DiffDisplay tokens={tokens} />);
    const span = screen.getByText('你');
    expect(span).toHaveClass('bg-error', 'text-white');
    expect(span).toHaveAttribute('title', '應該是「他」');
  });

  it('renders missing characters with bg-gray-200 and dashed border', () => {
    const tokens: DiffToken[] = [
      { char: '世', type: 'missing' },
    ];
    render(<DiffDisplay tokens={tokens} />);
    const span = screen.getByText('世');
    expect(span).toHaveClass('bg-gray-200', 'text-gray-400', 'border-dashed');
    expect(span).toHaveAttribute('title', '漏讀');
  });

  it('renders extra characters with line-through', () => {
    const tokens: DiffToken[] = [
      { char: '啊', type: 'extra' },
    ];
    render(<DiffDisplay tokens={tokens} />);
    const span = screen.getByText('啊');
    expect(span).toHaveClass('line-through');
    expect(span).toHaveAttribute('title', '多讀');
  });

  it('renders mixed token types correctly', () => {
    const tokens: DiffToken[] = [
      { char: '你', type: 'correct' },
      { char: '好', type: 'wrong', expected: '號' },
      { char: '嗎', type: 'missing' },
      { char: '的', type: 'extra' },
    ];
    render(<DiffDisplay tokens={tokens} />);

    expect(screen.getByText('你')).toHaveClass('text-gray-900');
    expect(screen.getByText('好')).toHaveClass('bg-error');
    expect(screen.getByText('嗎')).toHaveClass('bg-gray-200');
    expect(screen.getByText('的')).toHaveClass('line-through');
  });

  it('renders legend when showLegend is true', () => {
    const tokens: DiffToken[] = [{ char: '字', type: 'correct' }];
    render(<DiffDisplay tokens={tokens} showLegend />);
    expect(screen.getByText('正確')).toBeInTheDocument();
    expect(screen.getByText('讀錯')).toBeInTheDocument();
    expect(screen.getByText('漏讀')).toBeInTheDocument();
    expect(screen.getByText('多讀')).toBeInTheDocument();
  });

  it('does not render legend by default', () => {
    const tokens: DiffToken[] = [{ char: '字', type: 'correct' }];
    render(<DiffDisplay tokens={tokens} />);
    expect(screen.queryByText('正確')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const tokens: DiffToken[] = [{ char: '字', type: 'correct' }];
    const { container } = render(<DiffDisplay tokens={tokens} className="my-custom" />);
    expect(container.firstChild).toHaveClass('my-custom');
  });
});
