import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchStory } from '../api';
import { authToken } from '../../utils/storage';

/**
 * #3555: anonymous GET /api/stories/{id} no longer carries multiple-choice
 * answers; the student renderers grade locally, so fetchStory must send the
 * login token or every MCQ would lose its answer key.
 */
describe('fetchStory sends the login token (#3555)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    authToken.remove();
  });

  it('adds Authorization when logged in', async () => {
    authToken.set('tok-123');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 1, title: 't', paragraphs: [] }), { status: 200 }),
    );
    await fetchStory('1').catch(() => undefined);
    const init = spy.mock.calls[0][1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer tok-123');
  });
});
