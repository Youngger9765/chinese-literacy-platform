/**
 * Tests for AdminPageShell (Issue #1847)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminPageShell from '../AdminPageShell';

describe('AdminPageShell', () => {
  it('renders the page title', () => {
    render(<AdminPageShell title="使用者管理"><div>content</div></AdminPageShell>);
    expect(screen.getByText('使用者管理')).toBeTruthy();
  });

  it('renders children when not loading and no error', () => {
    render(
      <AdminPageShell title="Test">
        <p>My content</p>
      </AdminPageShell>,
    );
    expect(screen.getByText('My content')).toBeTruthy();
  });

  it('shows spinner when isLoading=true instead of children', () => {
    render(
      <AdminPageShell title="Test" isLoading>
        <p>Should not appear</p>
      </AdminPageShell>,
    );
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('Should not appear')).toBeNull();
  });

  it('shows error alert when error is set', () => {
    render(
      <AdminPageShell title="Test" error="載入失敗">
        <p>hidden</p>
      </AdminPageShell>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('載入失敗');
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('shows emptyMessage when isEmpty=true', () => {
    render(
      <AdminPageShell title="Test" isEmpty emptyMessage="沒有使用者">
        <p>hidden</p>
      </AdminPageShell>,
    );
    expect(screen.getByText('沒有使用者')).toBeTruthy();
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('renders subtitle when provided', () => {
    render(<AdminPageShell title="T" subtitle="副標題"><span /></AdminPageShell>);
    expect(screen.getByText('副標題')).toBeTruthy();
  });

  it('renders headerActions', () => {
    render(
      <AdminPageShell title="T" headerActions={<button>新增</button>}>
        <span />
      </AdminPageShell>,
    );
    expect(screen.getByRole('button', { name: '新增' })).toBeTruthy();
  });
});
