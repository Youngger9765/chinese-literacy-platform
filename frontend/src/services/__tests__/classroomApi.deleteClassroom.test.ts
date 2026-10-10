import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { deleteClassroom } from '../classroomApi';

describe('deleteClassroom', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('resolves without throwing on a real 204 No Content response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    await expect(deleteClassroom('tok', 42)).resolves.toBeUndefined();
  });

  it('still surfaces a readable error on failure', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Not your classroom' }),
    });

    await expect(deleteClassroom('tok', 42)).rejects.toThrow('Not your classroom');
  });
});
