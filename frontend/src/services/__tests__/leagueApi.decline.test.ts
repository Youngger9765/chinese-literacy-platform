/**
 * Contract regression for the 2026-10-15 backend security fix on
 * `POST /api/league/invitations/{code}/decline` (backend/app/routes/league.py).
 *
 * The backend used to accept no body at all and had zero authorization —
 * any authenticated user holding the code could decline. The fix requires
 * the caller to name `invitee_classroom_id` in the body (mirrors `accept`
 * exactly), and the route 403s a caller who doesn't own that classroom.
 *
 * This test locks the FRONTEND half of that contract: `declineInvitation`
 * must send `invitee_classroom_id` in the JSON body, the same way
 * `acceptInvitation` already does. Before this fix the frontend called the
 * endpoint with no body at all, which the backend's new contract rejects
 * with a 422 (missing required field) — breaking the 婉拒 (decline) button
 * in TeacherLeaguePage.tsx in the UI even though the backend fix itself was
 * fully tested server-side.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { declineInvitation } from '../leagueApi';

function mockJsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe('declineInvitation — sends invitee_classroom_id in the body (contract w/ backend)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('includes invitee_classroom_id in the request body, not just the code in the URL', async () => {
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        id: 1,
        code: 'ABC12345',
        inviter_classroom_id: 10,
        invitee_classroom_id: null,
        status: 'declined',
        game_start: '2026-10-20T00:00:00Z',
        game_end: '2026-10-21T00:00:00Z',
      }),
    );

    await declineInvitation('token-123', 'ABC12345', 42);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/league/invitations/ABC12345/decline');
    expect(options.method).toBe('POST');

    // The regression this locks: the OLD call site sent no `body` at all,
    // which the backend's new required-field contract rejects. A body
    // must be present and must carry invitee_classroom_id — this is the
    // line that would have stayed red against the pre-fix signature
    // `declineInvitation(token, code)` (TypeError: 3rd arg not accepted,
    // or body === undefined if the 3rd arg were silently ignored).
    expect(options.body).toBeDefined();
    const parsedBody = JSON.parse(options.body as string);
    expect(parsedBody).toEqual({ invitee_classroom_id: 42 });
  });
});
