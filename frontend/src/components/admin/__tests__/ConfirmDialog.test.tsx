/**
 * Tests for ConfirmDialog (Issue #1847)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../ConfirmDialog';

const BASE_PROPS = {
  open: true,
  title: '確認操作',
  message: '你確定嗎？',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('ConfirmDialog', () => {
  it('renders nothing when open=false', () => {
    render(<ConfirmDialog {...BASE_PROPS} open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog when open=true', () => {
    render(<ConfirmDialog {...BASE_PROPS} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('確認操作')).toBeTruthy();
    expect(screen.getByText('你確定嗎？')).toBeTruthy();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...BASE_PROPS} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...BASE_PROPS} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...BASE_PROPS} onCancel={onCancel} />);
    // The backdrop is the outermost div with role="presentation"
    fireEvent.click(screen.getByRole('presentation'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('respects custom confirmLabel and cancelLabel', () => {
    render(
      <ConfirmDialog
        {...BASE_PROPS}
        confirmLabel="停用"
        cancelLabel="返回"
      />,
    );
    expect(screen.getByRole('button', { name: '停用' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy();
  });

  it('disables buttons when isLoading=true', () => {
    render(<ConfirmDialog {...BASE_PROPS} isLoading />);
    const confirmBtn = screen.getByRole('button', { name: /確認/ });
    const cancelBtn = screen.getByRole('button', { name: '取消' });
    expect(confirmBtn).toHaveProperty('disabled', true);
    expect(cancelBtn).toHaveProperty('disabled', true);
  });
});
