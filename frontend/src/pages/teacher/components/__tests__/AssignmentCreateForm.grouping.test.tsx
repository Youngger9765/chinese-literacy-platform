import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AssignmentCreateForm } from '../AssignmentCreateForm';

// Minimal mock for ReadingGoalsForm
vi.mock('../../../../components/teacher/ReadingGoalsForm', () => ({
  default: () => <div data-testid="reading-goals-form" />,
}));

const baseProps = {
  stories: [{ id: 's1', title: '測試課文', grade: 5 }],
  storyGrade: 5,
  isLoadingStories: false,
  storiesError: null,
  selectedStoryId: 's1',
  setSelectedStoryId: vi.fn(),
  formTitle: '',
  setFormTitle: vi.fn(),
  formDescription: '',
  setFormDescription: vi.fn(),
  formDueDate: '',
  setFormDueDate: vi.fn(),
  formSkipCompleted: false,
  setFormSkipCompleted: vi.fn(),
  formGoals: { targetDifficulty: '', targetSpeed: '', targetAccuracy: '' } as any,
  setFormGoals: vi.fn(),
  isCreating: false,
  createError: '',
  onSubmit: vi.fn(),
  onClose: vi.fn(),
  onRetryStories: vi.fn(),
};

describe('AssignmentCreateForm — 3-group layout (#1989)', () => {
  it('renders "基本資訊" section header', () => {
    render(<AssignmentCreateForm {...baseProps} />);
    expect(screen.getByText('基本資訊')).toBeInTheDocument();
  });

  it('renders "設定選項" section header', () => {
    render(<AssignmentCreateForm {...baseProps} />);
    expect(screen.getByText('設定選項')).toBeInTheDocument();
  });

  it('renders "朗讀目標" section header', () => {
    render(<AssignmentCreateForm {...baseProps} />);
    expect(screen.getByText('朗讀目標')).toBeInTheDocument();
  });
});
