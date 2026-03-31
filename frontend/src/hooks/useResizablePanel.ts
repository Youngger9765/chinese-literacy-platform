import React, { useRef, useEffect } from 'react';

/**
 * Handles the drag-to-resize logic for a side panel divider.
 *
 * Attaches mousemove/mouseup and touchmove/touchend listeners to window
 * so the drag works even when the pointer leaves the divider element.
 *
 * Returns:
 *   - `isDraggingRef`       — ref set to true while a drag is in progress
 *   - `dragStartXRef`       — X coordinate where the current drag started
 *   - `dragStartWidthRef`   — panel width at the start of the current drag
 *   - `onDividerMouseDown`  — mousedown handler to attach to the divider element
 *   - `onDividerTouchStart` — touchstart handler to attach to the divider element
 */
export function useResizablePanel(
  rightPanelWidth: number,
  onPanelWidthChange: (w: number) => void,
) {
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(rightPanelWidth);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - e.clientX;
      onPanelWidthChange(Math.max(240, Math.min(600, dragStartWidthRef.current + delta)));
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - e.touches[0].clientX;
      onPanelWidthChange(Math.max(240, Math.min(600, dragStartWidthRef.current + delta)));
    };
    const onTouchEnd = () => {
      isDraggingRef.current = false;
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [onPanelWidthChange]);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = rightPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  const onDividerTouchStart = (e: React.TouchEvent) => {
    isDraggingRef.current = true;
    dragStartXRef.current = e.touches[0].clientX;
    dragStartWidthRef.current = rightPanelWidth;
    document.body.style.userSelect = 'none';
  };

  return {
    isDraggingRef,
    dragStartXRef,
    dragStartWidthRef,
    onDividerMouseDown,
    onDividerTouchStart,
  };
}
