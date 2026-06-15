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

  it('does not render extra characters (hidden for future coaching hints)', () => {
    const tokens: DiffToken[] = [
      { char: '啊', type: 'extra' },
    ];
    render(<DiffDisplay tokens={tokens} />);
    // extra tokens are intentionally not rendered in the diff view
    expect(screen.queryByText('啊')).not.toBeInTheDocument();
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
    // extra token '的' is not rendered
    expect(screen.queryByText('的')).not.toBeInTheDocument();
  });

  it('renders legend when showLegend is true', () => {
    const tokens: DiffToken[] = [{ char: '字', type: 'correct' }];
    render(<DiffDisplay tokens={tokens} showLegend />);
    expect(screen.getByText('正確')).toBeInTheDocument();
    expect(screen.getByText('讀錯')).toBeInTheDocument();
    expect(screen.getByText('漏讀')).toBeInTheDocument();
    // extra tokens are not shown in the diff display, so 多讀 is not in the legend
    expect(screen.queryByText('多讀')).not.toBeInTheDocument();
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

  it('renders bopomofo annotation above character when zhuyin is provided', () => {
    const tokens: DiffToken[] = [
      { char: '你', type: 'correct', zhuyin: 'ㄋㄧˇ' },
    ];
    const { container } = render(<DiffDisplay tokens={tokens} />);
    const ruby = container.querySelector('ruby');
    expect(ruby).toBeInTheDocument();
    const rt = container.querySelector('rt');
    expect(rt).toHaveTextContent('ㄋㄧˇ');
  });

  it('renders wrong token with zhuyin annotation', () => {
    const tokens: DiffToken[] = [
      { char: '你', type: 'wrong', expected: '他', zhuyin: 'ㄋㄧˇ' },
    ];
    const { container } = render(<DiffDisplay tokens={tokens} />);
    const rt = container.querySelector('rt');
    expect(rt).toHaveTextContent('ㄋㄧˇ');
  });

  it('renders missing token with zhuyin annotation', () => {
    const tokens: DiffToken[] = [
      { char: '世', type: 'missing', zhuyin: 'ㄕˋ' },
    ];
    const { container } = render(<DiffDisplay tokens={tokens} />);
    const rt = container.querySelector('rt');
    expect(rt).toHaveTextContent('ㄕˋ');
  });

  it('does not render ruby element when zhuyin is absent', () => {
    const tokens: DiffToken[] = [
      { char: '字', type: 'correct' },
    ];
    const { container } = render(<DiffDisplay tokens={tokens} />);
    expect(container.querySelector('ruby')).not.toBeInTheDocument();
  });
});
