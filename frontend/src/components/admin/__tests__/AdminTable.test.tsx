/**
 * Tests for AdminTable (Issue #1847)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminTable, { ColumnDef } from '../AdminTable';

interface User {
  id: number;
  name: string;
  email: string;
}

const USERS: User[] = [
  { id: 1, name: '張三', email: 'test-user-a' },
  { id: 2, name: '李四', email: 'test-user-b' },
];

const COLUMNS: ColumnDef<User>[] = [
  { key: 'name', header: '姓名' },
  { key: 'email', header: 'Email' },
];

describe('AdminTable', () => {
  it('renders column headers', () => {
    render(
      <AdminTable
        columns={COLUMNS}
        rows={USERS}
        rowKey={(u) => u.id}
      />,
    );
    expect(screen.getAllByText('姓名').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Email').length).toBeGreaterThan(0);
  });

  it('renders row data', () => {
    render(
      <AdminTable
        columns={COLUMNS}
        rows={USERS}
        rowKey={(u) => u.id}
      />,
    );
    expect(screen.getAllByText('張三').length).toBeGreaterThan(0);
    expect(screen.getAllByText('李四').length).toBeGreaterThan(0);
  });

  it('calls onRowClick when a row is clicked', () => {
    const onClick = vi.fn();
    render(
      <AdminTable
        columns={COLUMNS}
        rows={USERS}
        rowKey={(u) => u.id}
        onRowClick={onClick}
      />,
    );
    // Click the first visible "張三" cell in the table (desktop view)
    const cells = screen.getAllByText('張三');
    fireEvent.click(cells[0].closest('tr')!);
    expect(onClick).toHaveBeenCalledWith(USERS[0]);
  });

  it('uses custom render function for cells', () => {
    const columns: ColumnDef<User>[] = [
      { key: 'name', header: '姓名', render: (row) => <strong>{row.name}-custom</strong> },
    ];
    render(
      <AdminTable columns={columns} rows={[USERS[0]]} rowKey={(u) => u.id} />,
    );
    expect(screen.getAllByText('張三-custom').length).toBeGreaterThan(0);
  });

  it('renders empty table with no rows without crashing', () => {
    render(
      <AdminTable columns={COLUMNS} rows={[]} rowKey={(u) => u.id} />,
    );
    expect(screen.getAllByText('姓名').length).toBeGreaterThan(0);
  });
});
