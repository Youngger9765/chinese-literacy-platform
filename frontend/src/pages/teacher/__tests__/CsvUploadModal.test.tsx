/**
 * Tests for CsvUploadModal — covers the gaps identified in issue #538:
 * 1. drag-and-drop file handling
 * 2. warnings display from backend response
 * 3. credential CSV download after import
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CsvUploadModal from '../CsvUploadModal';
import * as classroomApi from '../../../services/classroomApi';

vi.mock('../../../services/classroomApi', () => ({
  uploadCsvStudents: vi.fn(),
  downloadCsvTemplate: vi.fn(),
}));

const DEFAULT_PROPS = {
  token: 'test-token',
  classroomId: 1,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

function makeCsvFile(content = 'name,seat_number\n王小明,01\n李小美,02\n') {
  return new File([content], 'students.csv', { type: 'text/csv' });
}

describe('CsvUploadModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Test 1: drag-and-drop ─────────────────────────────────────────────────

  describe('drag-and-drop file handling', () => {
    it('accepts a file dropped onto the dropzone', async () => {
      render(<CsvUploadModal {...DEFAULT_PROPS} />);

      const dropzone = screen.getByRole('region', { name: /拖曳/i });
      const file = makeCsvFile();

      fireEvent.dragOver(dropzone, {
        dataTransfer: { files: [file], types: ['Files'] },
      });
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file] },
      });

      // After drop, should move to preview phase
      await waitFor(() => {
        expect(screen.getByText(/預覽/)).toBeInTheDocument();
      });
    });

    it('applies drag-active styling when a file is dragged over', async () => {
      render(<CsvUploadModal {...DEFAULT_PROPS} />);

      const dropzone = screen.getByRole('region', { name: /拖曳/i });
      fireEvent.dragOver(dropzone, {
        dataTransfer: { files: [], types: ['Files'] },
      });

      expect(dropzone.className).toMatch(/border-accent|drag-active|ring/i);
    });

    it('removes drag-active styling when drag leaves', async () => {
      render(<CsvUploadModal {...DEFAULT_PROPS} />);

      const dropzone = screen.getByRole('region', { name: /拖曳/i });
      fireEvent.dragOver(dropzone, {
        dataTransfer: { files: [], types: ['Files'] },
      });
      fireEvent.dragLeave(dropzone);

      // Should not have drag-active border after leave
      expect(dropzone.className).not.toMatch(/ring-accent|border-accent.*ring/);
    });
  });

  // ── Test 2: warnings display ──────────────────────────────────────────────

  describe('warnings from backend', () => {
    it('displays warnings returned by the upload API', async () => {
      const mockResult = {
        created_count: 2,
        skipped_count: 0,
        errors: [],
        created: [
          { name: '王小明', seat_number: '01', username: 'ABC01', password: 'XY12ZW34', user_id: 1 },
          { name: '李小美', seat_number: '02', username: 'ABC02', password: 'YZ45QR67', user_id: 2 },
        ],
        warnings: ['學校未設定網域，使用預設 lingoleap.local 網域'],
      };
      vi.mocked(classroomApi.uploadCsvStudents).mockResolvedValue(mockResult);

      render(<CsvUploadModal {...DEFAULT_PROPS} />);

      // Simulate file selection to get to preview
      const input = document.getElementById('csv-file-input') as HTMLInputElement;
      const file = makeCsvFile();
      await userEvent.upload(input, file);

      // Click upload
      const uploadBtn = await screen.findByRole('button', { name: /確認匯入/i });
      await userEvent.click(uploadBtn);

      // Should show warning
      await waitFor(() => {
        expect(screen.getByText(/學校未設定網域/)).toBeInTheDocument();
      });
    });

    it('does not show warnings section when there are no warnings', async () => {
      const mockResult = {
        created_count: 1,
        skipped_count: 0,
        errors: [],
        created: [
          { name: '王小明', seat_number: '01', username: 'ABC01', password: 'XY12ZW34', user_id: 1 },
        ],
        warnings: [],
      };
      vi.mocked(classroomApi.uploadCsvStudents).mockResolvedValue(mockResult);

      render(<CsvUploadModal {...DEFAULT_PROPS} />);

      const input = document.getElementById('csv-file-input') as HTMLInputElement;
      const file = makeCsvFile('王小明,01\n');
      await userEvent.upload(input, file);

      const uploadBtn = await screen.findByRole('button', { name: /確認匯入/i });
      await userEvent.click(uploadBtn);

      await waitFor(() => {
        expect(screen.getByText('1')).toBeInTheDocument(); // created_count
      });

      expect(screen.queryByText(/警告/)).not.toBeInTheDocument();
    });
  });

  // ── Test 3: credential download ───────────────────────────────────────────

  describe('credential CSV download', () => {
    it('shows a download button on the result phase when students were created', async () => {
      const mockResult = {
        created_count: 2,
        skipped_count: 0,
        errors: [],
        created: [
          { name: '王小明', seat_number: '01', username: 'ABC01', password: 'XY12ZW34', user_id: 1 },
          { name: '李小美', seat_number: '02', username: 'ABC02', password: 'YZ45QR67', user_id: 2 },
        ],
        warnings: [],
      };
      vi.mocked(classroomApi.uploadCsvStudents).mockResolvedValue(mockResult);

      render(<CsvUploadModal {...DEFAULT_PROPS} />);

      const input = document.getElementById('csv-file-input') as HTMLInputElement;
      const file = makeCsvFile();
      await userEvent.upload(input, file);

      const uploadBtn = await screen.findByRole('button', { name: /確認匯入/i });
      await userEvent.click(uploadBtn);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /下載帳號/i })).toBeInTheDocument();
      });
    });

    it('does not show download button when no students were created', async () => {
      const mockResult = {
        created_count: 0,
        skipped_count: 1,
        errors: [{ name: '王小明', seat_number: '01', error: '已存在' }],
        created: [],
        warnings: [],
      };
      vi.mocked(classroomApi.uploadCsvStudents).mockResolvedValue(mockResult);

      render(<CsvUploadModal {...DEFAULT_PROPS} />);

      const input = document.getElementById('csv-file-input') as HTMLInputElement;
      const file = makeCsvFile('王小明,01\n');
      await userEvent.upload(input, file);

      const uploadBtn = await screen.findByRole('button', { name: /確認匯入/i });
      await userEvent.click(uploadBtn);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /下載帳號/i })).not.toBeInTheDocument();
      });
    });

    it('triggers CSV download when the download button is clicked', async () => {
      const mockResult = {
        created_count: 1,
        skipped_count: 0,
        errors: [],
        created: [
          { name: '王小明', seat_number: '01', username: 'ABC01', password: 'XY12ZW34', user_id: 1 },
        ],
        warnings: [],
      };
      vi.mocked(classroomApi.uploadCsvStudents).mockResolvedValue(mockResult);

      // Mock URL.createObjectURL
      const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
      const mockRevokeObjectURL = vi.fn();
      Object.defineProperty(global.URL, 'createObjectURL', { value: mockCreateObjectURL, writable: true });
      Object.defineProperty(global.URL, 'revokeObjectURL', { value: mockRevokeObjectURL, writable: true });

      // Mock anchor click
      const mockAnchorClick = vi.fn();
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'a') {
          const anchor = originalCreateElement(tag) as HTMLAnchorElement;
          anchor.click = mockAnchorClick;
          return anchor;
        }
        return originalCreateElement(tag);
      });

      render(<CsvUploadModal {...DEFAULT_PROPS} />);

      const input = document.getElementById('csv-file-input') as HTMLInputElement;
      const file = makeCsvFile('王小明,01\n');
      await userEvent.upload(input, file);

      const uploadBtn = await screen.findByRole('button', { name: /確認匯入/i });
      await userEvent.click(uploadBtn);

      const downloadBtn = await screen.findByRole('button', { name: /下載帳號/i });
      await userEvent.click(downloadBtn);

      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(mockAnchorClick).toHaveBeenCalled();
    });
  });
});
