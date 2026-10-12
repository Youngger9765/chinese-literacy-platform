import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentCreateForm } from '../AssignmentCreateForm';

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

describe('AssignmentCreateForm scroll and focus (#3423)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scrolls the 課文 select into view when the form mounts', () => {
    render(<AssignmentCreateForm {...(baseProps as any)} selectedStoryId="" />);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('focuses the 課文 select when the form mounts', () => {
    render(<AssignmentCreateForm {...(baseProps as any)} selectedStoryId="" />);

    expect(document.activeElement).toBe(screen.getByLabelText(/課文/));
  });

  it('still works while stories are loading (select not rendered yet) — must not throw', () => {
    expect(() => render(<AssignmentCreateForm {...(baseProps as any)} isLoadingStories />)).not.toThrow();
  });
});
