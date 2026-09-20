import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadRemoteFile, downloadAuthenticatedFile } from './downloadRemoteFile';

/**
 * Issue #2486: worksheet_pdf_url / worksheet_docx_url are now relative
 * same-origin paths (e.g. "/assets/worksheets/G5-L23.pdf") instead of
 * absolute GCS URLs. `filenameFromUrl`'s fallback path used
 * `new URL(url)` with no base, which throws on a relative URL — silently
 * swallowed by the try/catch into a generic 'download' filename. This test
 * locks the fix: relative URLs must produce a real filename, not silently
 * degrade.
 */
describe('downloadRemoteFile', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: vi.fn().mockResolvedValue(new Blob(['fake pdf bytes'])),
    });
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-object-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('fetches a relative same-origin URL without throwing', async () => {
    await expect(downloadRemoteFile('/assets/worksheets/G5-L23.pdf')).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith('/assets/worksheets/G5-L23.pdf');
  });

  it('derives a real filename from a relative URL when no filename is given', async () => {
    const anchor = document.createElement('a');
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    await downloadRemoteFile('/assets/worksheets/G5-L23.pdf');

    expect(anchor.download).toBe('G5-L23.pdf');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('still works with an absolute cross-origin URL (Cloud Run direct-serve case)', async () => {
    const anchor = document.createElement('a');
    vi.spyOn(anchor, 'click').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    await downloadRemoteFile('https://lingoleap-backend-staging-xxx.run.app/assets/worksheets/G5-L23.pdf');

    expect(anchor.download).toBe('G5-L23.pdf');
  });

  it('uses the explicit filename argument when provided, regardless of URL shape', async () => {
    const anchor = document.createElement('a');
    vi.spyOn(anchor, 'click').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    await downloadRemoteFile('/assets/worksheets/G5-L23.pdf', 'G5-L23.pdf');

    expect(anchor.download).toBe('G5-L23.pdf');
  });

  it('throws when the response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(downloadRemoteFile('/assets/worksheets/missing.pdf')).rejects.toThrow('404');
  });
});

/**
 * #3276: role-gated downloads (worksheet teacher edition) need an Authorization
 * header — plain downloadRemoteFile always fetches anonymously, which is
 * correct for the public /assets/* proxy but would 401 against an
 * authenticated endpoint.
 */
describe('downloadAuthenticatedFile', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: vi.fn().mockResolvedValue(new Blob(['fake docx bytes'])),
    });
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-object-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('sends the token as a Bearer Authorization header', async () => {
    await downloadAuthenticatedFile('/api/lessons/L0001/worksheet/teacher', 'test-token-123');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/lessons/L0001/worksheet/teacher',
      { headers: { Authorization: 'Bearer test-token-123' } },
    );
  });

  it('throws when the response is not ok (e.g. a real 403 from the role gate)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(
      downloadAuthenticatedFile('/api/lessons/L0001/worksheet/teacher', 'student-token'),
    ).rejects.toThrow('403');
  });

  it('uses the explicit filename argument when provided', async () => {
    const anchor = document.createElement('a');
    vi.spyOn(anchor, 'click').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    await downloadAuthenticatedFile('/api/lessons/L0001/worksheet/teacher', 'tok', 'L0001-teacher.docx');

    expect(anchor.download).toBe('L0001-teacher.docx');
  });
});
