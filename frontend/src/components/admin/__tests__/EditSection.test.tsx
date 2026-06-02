/**
 * Tests for EditSection (Issue #1847)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditSection from '../EditSection';

const BASE_PROPS = {
  title: '基本資料',
  isEditing: false,
  onEdit: vi.fn(),
  onSave: vi.fn(),
  onCancel: vi.fn(),
};

describe('EditSection', () => {
  it('renders the section title', () => {
    render(<EditSection {...BASE_PROPS}><span>view</span></EditSection>);
    expect(screen.getByText('基本資料')).toBeTruthy();
  });

  it('shows "編輯" button when not editing', () => {
    render(<EditSection {...BASE_PROPS}><span /></EditSection>);
    expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
  });

  it('calls onEdit when "編輯" is clicked', () => {
    const onEdit = vi.fn();
    render(<EditSection {...BASE_PROPS} onEdit={onEdit}><span /></EditSection>);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('shows "儲存" and "取消" when isEditing=true', () => {
    render(
      <EditSection {...BASE_PROPS} isEditing>
        <span />
      </EditSection>,
    );
    expect(screen.getByRole('button', { name: /儲存/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
    // "編輯" button should not be visible in edit mode
    expect(screen.queryByRole('button', { name: '編輯' })).toBeNull();
  });

  it('calls onSave when "儲存" is clicked', () => {
    const onSave = vi.fn();
    render(
      <EditSection {...BASE_PROPS} isEditing onSave={onSave}>
        <span />
      </EditSection>,
    );
    fireEvent.click(screen.getByRole('button', { name: /儲存/ }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('calls onCancel when "取消" is clicked', () => {
    const onCancel = vi.fn();
    render(
      <EditSection {...BASE_PROPS} isEditing onCancel={onCancel}>
        <span />
      </EditSection>,
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('displays error message in edit mode', () => {
    render(
      <EditSection {...BASE_PROPS} isEditing error="儲存失敗">
        <span />
      </EditSection>,
    );
    expect(screen.getByRole('alert').textContent).toContain('儲存失敗');
  });

  it('hides "編輯" button when canEdit=false', () => {
    render(
      <EditSection {...BASE_PROPS} canEdit={false}>
        <span />
      </EditSection>,
    );
    expect(screen.queryByRole('button', { name: '編輯' })).toBeNull();
  });
});
