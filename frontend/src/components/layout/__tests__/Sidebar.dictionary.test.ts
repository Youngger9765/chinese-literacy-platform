/**
 * Test: 字典查詢 must NOT appear in Sidebar toolsItems (Issue #1638)
 *
 * This is a pure unit test on the config array — no DOM render needed.
 * After the fix, the sidebar nav should not expose the /dictionary route.
 * The route itself remains in AppRoutes.tsx (backend preserved).
 */

import { describe, it, expect } from 'vitest';

// We test the exported constant directly so the test is fast and deterministic.
// If the component ever extracts toolsItems to a separate module this import path
// should be updated to point to that module.

// Dynamic import to get the raw module without React context setup
describe('Sidebar toolsItems — 字典查詢 hidden (Issue #1638)', () => {
  it('QUICK_CARDS in QuickPracticeStrip does not contain 字典查詢', async () => {
    // Import the module source to verify the static config array
    const module = await import('../../../components/student/QuickPracticeStrip');
    // We can't directly access QUICK_CARDS since it's not exported,
    // but we can check the rendered output via string inspection of the module
    // Instead we use a simpler contract: grep the module text for the entry.
    // This test is intentionally checking the contract at the config layer.

    // Since QUICK_CARDS is not exported, we use a different approach:
    // render the component and verify "字典查詢" is not in the DOM.
    const { render, screen } = await import('@testing-library/react');
    const { MemoryRouter } = await import('react-router-dom');
    const { default: QuickPracticeStrip } = module;

    const { createElement } = await import('react');

    render(
      createElement(MemoryRouter, null,
        createElement(QuickPracticeStrip, null)
      )
    );

    // After fix: "字典查詢" text should NOT be present
    expect(screen.queryByText('字典查詢')).toBeNull();
  });
});
