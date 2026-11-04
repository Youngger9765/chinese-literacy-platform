/**
 * Tests for OmoUpload's AI kill switch behavior (Issue #3838).
 *
 * OMO (worksheet identification + grading) has no non-AI fallback, so the
 * whole upload flow is hidden when AI is off. Viewing past results
 * (onShowHistory) is a read of already-graded data, not a new AI call, and
 * stays available.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OmoUpload from './OmoUpload';
import { _resetAiFeaturesCacheForTests } from '../../hooks/useAiFeaturesEnabled';

function stubFeaturesFetch(aiFeaturesEnabled: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).includes('/api/features')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ai_features_enabled: aiFeaturesEnabled }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }),
  );
}

describe('OmoUpload — AI kill switch (#3838)', () => {
  beforeEach(() => {
    _resetAiFeaturesCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetAiFeaturesCacheForTests();
  });

  it('hides the scan/upload entry points and shows the disabled notice when AI is off', async () => {
    stubFeaturesFetch(false);
    const onUploaded = vi.fn();
    const onShowHistory = vi.fn();

    render(
      <OmoUpload token="t" onUploaded={onUploaded} onShowHistory={onShowHistory} />,
    );

    expect(await screen.findByText('AI 功能暫時關閉')).toBeInTheDocument();
    expect(screen.queryByText('掃描上傳（連續拍多頁）')).not.toBeInTheDocument();
    expect(screen.queryByText('選擇照片或 PDF')).not.toBeInTheDocument();
    // Read-only history view is not an AI call — stays available.
    expect(screen.getByText('查看批改記錄')).toBeInTheDocument();
  });

  it('shows the normal upload CTAs when AI is on', async () => {
    stubFeaturesFetch(true);
    render(<OmoUpload token="t" onUploaded={vi.fn()} />);

    expect(await screen.findByText('掃描上傳（連續拍多頁）')).toBeInTheDocument();
    expect(screen.getByText('選擇照片或 PDF')).toBeInTheDocument();
    expect(screen.queryByText('AI 功能暫時關閉')).not.toBeInTheDocument();
  });
});
