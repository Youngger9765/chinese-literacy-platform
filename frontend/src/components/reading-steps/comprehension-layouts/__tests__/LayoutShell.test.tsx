/**
 * LayoutShell unit tests
 * Tests that layout_mode correctly dispatches to the right layout variant.
 *
 * Related to #1341
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LayoutShell from '../LayoutShell';
import { Story, ReadingAttempt, ComprehensionResult } from '../../../../types';

// Stub child components to keep tests focused on dispatch logic
vi.mock('../GraphicTextLayout', () => ({
  default: () => <div data-testid="graphic-text-layout">GraphicTextLayout</div>,
}));

vi.mock('../StandardLayout', () => ({
  default: () => <div data-testid="standard-layout">StandardLayout</div>,
}));

const baseStory: Story = {
  id: 'test-1',
  title: '測試課文',
  level: '5',
  content: ['第一段', '第二段'],
  thumbnail: '',
  category: 'Daily',
  filename: 'test.yml',
};

const baseAttempt: ReadingAttempt = {
  storyId: 'test-1',
  accuracy: 0.9,
  fluency: 0.8,
  cpm: 200,
  mispronouncedWords: [],
  transcription: '',
  timestamp: Date.now(),
};

const noopFinish = (_: ComprehensionResult) => {};
const noopBack = () => {};

describe('LayoutShell', () => {
  it('renders GraphicTextLayout when layout_mode is graphic-text', () => {
    render(
      <LayoutShell
        story={{ ...baseStory, layout_mode: 'graphic-text' }}
        attempt={baseAttempt}
        onFinish={noopFinish}
        onBack={noopBack}
      />
    );
    expect(screen.getByTestId('graphic-text-layout')).toBeTruthy();
    expect(screen.queryByTestId('standard-layout')).toBeNull();
  });

  it('renders StandardLayout when layout_mode is standard', () => {
    render(
      <LayoutShell
        story={{ ...baseStory, layout_mode: 'standard' }}
        attempt={baseAttempt}
        onFinish={noopFinish}
        onBack={noopBack}
      />
    );
    expect(screen.getByTestId('standard-layout')).toBeTruthy();
    expect(screen.queryByTestId('graphic-text-layout')).toBeNull();
  });

  it('falls back to StandardLayout when layout_mode is undefined', () => {
    render(
      <LayoutShell
        story={{ ...baseStory }}
        attempt={baseAttempt}
        onFinish={noopFinish}
        onBack={noopBack}
      />
    );
    expect(screen.getByTestId('standard-layout')).toBeTruthy();
    expect(screen.queryByTestId('graphic-text-layout')).toBeNull();
  });
});
