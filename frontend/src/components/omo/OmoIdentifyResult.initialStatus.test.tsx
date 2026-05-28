import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import OmoIdentifyResult from './OmoIdentifyResult';

vi.mock('../../services/omoApi', () => ({
  getOmoStatus: vi.fn(() => new Promise(() => {})),
  confirmOmoLesson: vi.fn(),
  regradeOmo: vi.fn(),
  getOmoLessons: vi.fn(),
}));

describe('OmoIdentifyResult initialStatus', () => {
  it('shows grading spinner copy immediately when initialStatus is grading', () => {
    render(
      <OmoIdentifyResult
        uploadId={1}
        token="token"
        initialStatus="grading"
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('status', { name: 'AI 批改中' })).toBeInTheDocument();
    expect(screen.getByText('AI 正在批改你的學習單')).toBeInTheDocument();
  });
});
