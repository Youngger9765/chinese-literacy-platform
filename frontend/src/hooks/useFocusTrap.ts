/**
 * useFocusTrap — React hook for WAI-ARIA Dialog focus management.
 *
 * When `active` is true:
 *  - Saves the previously focused element so it can be restored on close.
 *  - Moves focus to the first focusable element inside the container.
 *  - Traps Tab / Shift+Tab so focus cannot leave the container.
 *
 * Usage:
 *   const dialogRef = useRef<HTMLDivElement>(null);
 *   useFocusTrap(dialogRef, isOpen);
 */

import { useEffect, useRef } from 'react';
import { trapFocus, focusFirst, saveFocus } from '../utils/accessibility';

/**
 * @param containerRef  Ref to the modal/dialog container element.
 * @param active        Whether the focus trap should be active (modal is open).
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
): void {
  // Keep a stable ref to the cleanup functions so we can call them on deactivation.
  const cleanupRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    // Save where focus was before the modal opened so we can restore it on close.
    const restoreFocus = saveFocus();

    // Move focus into the modal.
    focusFirst(container);

    // Trap Tab / Shift+Tab inside the modal.
    const removeTrap = trapFocus(container);

    // Store cleanup functions.
    cleanupRef.current = [removeTrap, restoreFocus];

    return () => {
      // Remove keydown listener.
      removeTrap();
      // Return focus to the triggering element.
      restoreFocus();
      cleanupRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
