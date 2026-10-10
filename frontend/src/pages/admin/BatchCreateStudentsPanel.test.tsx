import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BatchCreateStudentsPanel from './BatchCreateStudentsPanel';
import type { BatchCreateResult } from '../../services/classroomApi';

// Regression lock for the typecheck-ratchet catch on #3378: `classroomApi.ts`'s
// `BatchCreateResult.errors` was mistyped as `string[]` while the backend
// (`BatchStudentError`) actually returns `{ name, seat_number, error }` objects.
// Rendering the raw object directly (`<li>{err}</li>`) throws
// "Objects are not valid as a React child" at runtime — this never surfaced
// because the wrong type let `{err}` type-check as a string.
describe('BatchCreateStudentsPanel errors render (#3378 typecheck-ratchet fix)', () => {
  const noop = vi.fn();

  it('renders each error object as readable text, not [object Object]', () => {
    const batchResult: BatchCreateResult = {
      created: [],
      errors: [{ name: '王小明', seat_number: '3', error: '座號重複' }],
    };

    render(
      <BatchCreateStudentsPanel
        batchInput=""
        batchPreview={[]}
        isSubmittingBatch={false}
        batchResult={batchResult}
        batchError=""
        onBatchInputChange={noop}
        onSubmitBatch={noop}
        onDownloadCredentials={noop}
        onContinue={noop}
        onClose={noop}
      />
    );

    expect(screen.getByText(/王小明/)).toBeInTheDocument();
    expect(screen.getByText(/座號 3/)).toBeInTheDocument();
    expect(screen.getByText(/座號重複/)).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });
});
