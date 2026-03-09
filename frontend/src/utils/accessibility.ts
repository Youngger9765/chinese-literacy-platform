/**
 * Accessibility utilities for WCAG 2.1 AA compliance.
 *
 * Covers:
 * - Focus trap for modals and overlays
 * - Live region announcements for dynamic content
 * - Focus management helpers
 * - Keyboard navigation utilities
 */
// No React import needed — all utilities are DOM-level

// -----------------------------------------------------------------------
// Live region announcer
// -----------------------------------------------------------------------

let announcePoliteEl: HTMLElement | null = null;
let announceAssertiveEl: HTMLElement | null = null;

function getAnnounceEl(politeness: 'polite' | 'assertive'): HTMLElement {
  if (politeness === 'assertive') {
    if (!announceAssertiveEl) {
      announceAssertiveEl = document.createElement('div');
      announceAssertiveEl.setAttribute('aria-live', 'assertive');
      announceAssertiveEl.setAttribute('aria-atomic', 'true');
      announceAssertiveEl.setAttribute('role', 'status');
      Object.assign(announceAssertiveEl.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap',
        border: '0',
      });
      document.body.appendChild(announceAssertiveEl);
    }
    return announceAssertiveEl;
  }

  if (!announcePoliteEl) {
    announcePoliteEl = document.createElement('div');
    announcePoliteEl.setAttribute('aria-live', 'polite');
    announcePoliteEl.setAttribute('aria-atomic', 'true');
    announcePoliteEl.setAttribute('role', 'status');
    Object.assign(announcePoliteEl.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0,0,0,0)',
      whiteSpace: 'nowrap',
      border: '0',
    });
    document.body.appendChild(announcePoliteEl);
  }
  return announcePoliteEl;
}

/**
 * Announce a message to screen readers.
 *
 * @param message  Text to announce
 * @param politeness  'polite' (default) waits for user idle; 'assertive' interrupts immediately
 */
export function announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
  if (!message) return;
  const el = getAnnounceEl(politeness);
  // Clear then set — forces re-announcement even if message is the same
  el.textContent = '';
  // Use rAF to ensure DOM update triggers announcement
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}

// -----------------------------------------------------------------------
// Focus trap
// -----------------------------------------------------------------------

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(', ');

/**
 * Returns all focusable elements within a container.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.hasAttribute('hidden') && getComputedStyle(el).display !== 'none'
  );
}

/**
 * Creates a keyboard event handler that traps focus within a container.
 * Returns a cleanup function.
 *
 * Usage:
 *   const cleanup = trapFocus(modalRef.current);
 *   // on unmount:
 *   cleanup();
 */
export function trapFocus(container: HTMLElement): () => void {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusable = getFocusableElements(container);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);
  return () => container.removeEventListener('keydown', handleKeyDown);
}

// -----------------------------------------------------------------------
// Focus management
// -----------------------------------------------------------------------

/**
 * Moves focus to the first focusable element inside a container.
 */
export function focusFirst(container: HTMLElement): void {
  const focusable = getFocusableElements(container);
  if (focusable.length > 0) {
    focusable[0].focus();
  }
}

/**
 * Saves the currently focused element and returns a function to restore focus.
 *
 * Useful for modals: save focus before opening, restore when closing.
 */
export function saveFocus(): () => void {
  const saved = document.activeElement as HTMLElement | null;
  return () => {
    if (saved && typeof saved.focus === 'function') {
      saved.focus();
    }
  };
}

// -----------------------------------------------------------------------
// Keyboard helpers
// -----------------------------------------------------------------------

/**
 * Returns true if the event is an activation key (Enter or Space).
 * Useful for making non-button elements keyboard-accessible.
 */
export function isActivationKey(e: globalThis.KeyboardEvent): boolean {
  return e.key === 'Enter' || e.key === ' ';
}

/**
 * Returns true if the event is a dismissal key (Escape).
 */
export function isDismissKey(e: globalThis.KeyboardEvent): boolean {
  return e.key === 'Escape';
}

// -----------------------------------------------------------------------
// ID generator for aria-labelledby / aria-describedby
// -----------------------------------------------------------------------

let idCounter = 0;

/**
 * Generates a unique ID for use in ARIA attributes.
 */
export function generateAriaId(prefix = 'aria'): string {
  return `${prefix}-${++idCounter}`;
}
