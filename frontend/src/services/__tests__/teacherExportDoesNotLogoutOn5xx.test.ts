/**
 * exportClassroomReport logs the teacher out on ANY !res.ok, not just 401.
 *
 * A 500 while generating the CSV — a slow query, a Cloud Run restart mid
 * request — means the teacher is thrown back to the login screen. They did
 * nothing wrong and their token is fine; they just clicked Export at a bad
 * moment. sessionGuard.onApiUnauthorized already gets this right (it checks
 * for 401); this call site predates it and never caught up.
 *
 * Same family as #3085: a transient server problem read as "your session is
 * over".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifySessionUnauthorized = vi.fn();
vi.mock('../sessionGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sessionGuard')>();
  return { ...actual, notifySessionUnauthorized: () => notifySessionUnauthorized() };
});

import { exportClassroomReport } from '../teacherApi';

function respondWith(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      blob: async () => new Blob(['a,b\n1,2']),
    }),
  );
}

describe('exportClassroomReport session handling', () => {
  beforeEach(() => {
    notifySessionUnauthorized.mockReset();
    localStorage.setItem('lingoleap_token', 'a-token');
  });

  it('does NOT end the session on a 500 — the export failed, the teacher is still signed in', async () => {
    respondWith(500);
    await expect(exportClassroomReport('a-token', 1)).rejects.toThrow();
    expect(
      notifySessionUnauthorized,
      'a 500 on export signed the teacher out; their token was never the problem',
    ).not.toHaveBeenCalled();
  });

  it('does NOT end the session on a 503 either', async () => {
    respondWith(503);
    await expect(exportClassroomReport('a-token', 1)).rejects.toThrow();
    expect(notifySessionUnauthorized).not.toHaveBeenCalled();
  });

  it('DOES end the session on a 401 — that token really is dead', async () => {
    respondWith(401);
    await expect(exportClassroomReport('a-token', 1)).rejects.toThrow();
    expect(
      notifySessionUnauthorized,
      'positive control: if this never fires, the test proves nothing about the 500 case',
    ).toHaveBeenCalled();
  });
});
