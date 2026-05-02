/**
 * LayoutShell — dispatches ComprehensionChat to the correct layout variant
 * based on lesson.layout_mode.
 *
 * layout_mode === 'graphic-text'  → GraphicTextLayout (left/right dual-pane)
 * layout_mode === 'standard' | undefined → StandardLayout (existing 1-col)
 *
 * Related to #1341
 */
import React from 'react';
import { Story, ReadingAttempt, ComprehensionResult } from '../../../types';
import GraphicTextLayout from './GraphicTextLayout';
import StandardLayout from './StandardLayout';

interface LayoutShellProps {
  story: Story;
  attempt: ReadingAttempt;
  onFinish: (result: ComprehensionResult) => void;
  onBack: () => void;
  dbSessionId?: number;
  initialProgress?: Record<string, unknown>;
  onProgressChange?: (stepData: Record<string, unknown>, immediate?: boolean) => void;
}

const LayoutShell: React.FC<LayoutShellProps> = ({ story, ...rest }) => {
  if (story.layout_mode === 'graphic-text') {
    return <GraphicTextLayout story={story} />;
  }
  return <StandardLayout story={story} {...rest} />;
};

export default LayoutShell;
