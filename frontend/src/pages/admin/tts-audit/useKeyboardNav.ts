// useKeyboardNav.ts — keyboard navigation for TTS audit list (Issue #1120)
import { useEffect } from 'react';

interface KeyboardNavOptions {
  /** total visible rows */
  total: number;
  /** currently selected row index (0-based), null = none */
  selectedIndex: number | null;
  /** callback to move selection */
  onSelect: (index: number) => void;
  /** callback to close side panel */
  onClose: () => void;
  /** callback to play/pause current row */
  onPlayPause: () => void;
  /** callback to focus search input */
  onFocusSearch: () => void;
  /** whether the panel is open */
  panelOpen: boolean;
}

export function useKeyboardNav({
  total,
  selectedIndex,
  onSelect,
  onClose,
  onPlayPause,
  onFocusSearch,
  panelOpen,
}: KeyboardNavOptions): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      const isInputActive =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // "/" — always focus search even when in list
      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        onFocusSearch();
        return;
      }

      if (isInputActive) return;

      switch (e.key) {
        case 'ArrowDown':
        case 'j': {
          e.preventDefault();
          const next = selectedIndex === null ? 0 : Math.min(selectedIndex + 1, total - 1);
          onSelect(next);
          break;
        }
        case 'ArrowUp':
        case 'k': {
          e.preventDefault();
          const prev = selectedIndex === null ? 0 : Math.max(selectedIndex - 1, 0);
          onSelect(prev);
          break;
        }
        case ' ': {
          e.preventDefault();
          if (selectedIndex !== null) onPlayPause();
          break;
        }
        case 'Escape': {
          if (panelOpen) {
            e.preventDefault();
            onClose();
          }
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [total, selectedIndex, onSelect, onClose, onPlayPause, onFocusSearch, panelOpen]);
}
