/**
 * StandardLayout — default 1-column comprehension layout.
 *
 * Extracts the existing ComprehensionChat visual output into its own component
 * so LayoutShell can swap variants cleanly. Zero behaviour change.
 *
 * Related to #1341
 */
import React from 'react';
import { Story, ReadingAttempt, ComprehensionResult } from '../../../types';
import ComprehensionChat from '../ComprehensionChat';

interface StandardLayoutProps {
  story: Story;
  attempt: ReadingAttempt;
  onFinish: (result: ComprehensionResult) => void;
  onBack: () => void;
  dbSessionId?: number;
  initialProgress?: Record<string, unknown>;
  onProgressChange?: (stepData: Record<string, unknown>, immediate?: boolean) => void;
}

const StandardLayout: React.FC<StandardLayoutProps> = (props) => {
  return <ComprehensionChat {...props} />;
};

export default StandardLayout;
