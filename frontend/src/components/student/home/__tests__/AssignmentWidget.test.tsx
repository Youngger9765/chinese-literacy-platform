/**
 * TDD tests for AssignmentWidget (Issue #1952)
 * Covers the 班級作業 + 圖書館 2-col tile grid.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// RED: will fail until AssignmentWidget is created
import AssignmentWidget from '../AssignmentWidget';

describe('AssignmentWidget', () => {
  it('renders 班級作業 tile', () => {
    render(
      <BrowserRouter>
        <AssignmentWidget pendingCount={0} onGoAssignments={vi.fn()} onGoLibrary={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.getByText('班級作業')).toBeTruthy();
  });

  it('renders 圖書館 tile', () => {
    render(
      <BrowserRouter>
        <AssignmentWidget pendingCount={0} onGoAssignments={vi.fn()} onGoLibrary={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.getByText('圖書館')).toBeTruthy();
  });

  it('shows pending count badge when pendingCount > 0', () => {
    render(
      <BrowserRouter>
        <AssignmentWidget pendingCount={3} onGoAssignments={vi.fn()} onGoLibrary={vi.fn()} />
      </BrowserRouter>,
    );
    // badge text
    const badges = screen.getAllByText('3');
    expect(badges.length).toBeGreaterThan(0);
    // subtitle
    expect(screen.getByText('3 個待完成')).toBeTruthy();
  });

  it('shows "查看紀錄" when pendingCount is 0', () => {
    render(
      <BrowserRouter>
        <AssignmentWidget pendingCount={0} onGoAssignments={vi.fn()} onGoLibrary={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.getByText('查看紀錄')).toBeTruthy();
  });

  it('calls onGoAssignments when 班級作業 tile is clicked', () => {
    const onGoAssignments = vi.fn();
    render(
      <BrowserRouter>
        <AssignmentWidget pendingCount={0} onGoAssignments={onGoAssignments} onGoLibrary={vi.fn()} />
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByLabelText('查看班級作業'));
    expect(onGoAssignments).toHaveBeenCalledTimes(1);
  });

  it('calls onGoLibrary when 圖書館 tile is clicked', () => {
    const onGoLibrary = vi.fn();
    render(
      <BrowserRouter>
        <AssignmentWidget pendingCount={0} onGoAssignments={vi.fn()} onGoLibrary={onGoLibrary} />
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByLabelText('前往圖書館'));
    expect(onGoLibrary).toHaveBeenCalledTimes(1);
  });
});
