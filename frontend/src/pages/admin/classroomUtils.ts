/**
 * Pure utility functions for ClassroomDetailPanel (Issue #1850)
 * Extracted to enable isolated unit testing.
 */

import { BatchStudentInput, BatchCreateResult } from '../../services/classroomApi';

/**
 * Parse multiline textarea input into BatchStudentInput array.
 * Format per line: "name [seat_number]"
 * Blank lines are ignored.
 */
export function parseBatchInput(input: string): BatchStudentInput[] {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/\s+/);
      const name = parts[0];
      const seat_number = parts[1] || undefined;
      return { name, seat_number };
    });
}

/**
 * Generate and trigger download of a CSV file with student credentials.
 * Includes UTF-8 BOM so Excel opens Chinese text correctly.
 */
export function downloadCredentialsCsv(
  batchResult: BatchCreateResult,
  classroomName: string,
  classroomId: number,
): void {
  const header = '姓名,座號,帳號,密碼';
  const rows = batchResult.created.map(
    (s) => `${s.name},${s.seat_number},${s.username},${s.password}`,
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `班級學生帳號_${classroomName || classroomId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
