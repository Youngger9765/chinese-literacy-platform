import { describe, it, expect } from 'vitest';
import { sortStudentsBySeat } from './sortStudentsBySeat';
import type { StudentInClassroomResponse } from '../../services/classroomApi';

const s = (id: number, name: string, seat: number | null): StudentInClassroomResponse => ({
  id,
  name,
  email: `${name}@x.com`,
  enrolled_at: '2026-01-01',
  seat_number: seat,
});

describe('sortStudentsBySeat (#3992)', () => {
  it('sorts by seat_number ascending', () => {
    const out = sortStudentsBySeat([s(1, 'c', 3), s(2, 'a', 1), s(3, 'b', 2)]);
    expect(out.map((x) => x.name)).toEqual(['a', 'b', 'c']);
  });

  it('puts students with no seat_number after every seated student', () => {
    const out = sortStudentsBySeat([s(1, 'noseat', null), s(2, 'seated5', 5)]);
    expect(out.map((x) => x.name)).toEqual(['seated5', 'noseat']);
  });

  it('keeps original relative order for ties (stable sort)', () => {
    const out = sortStudentsBySeat([s(1, 'first-noseat', null), s(2, 'second-noseat', null)]);
    expect(out.map((x) => x.name)).toEqual(['first-noseat', 'second-noseat']);
  });

  it('does not mutate the input array', () => {
    const input = [s(1, 'b', 2), s(2, 'a', 1)];
    const out = sortStudentsBySeat(input);
    expect(input.map((x) => x.name)).toEqual(['b', 'a']); // unchanged
    expect(out.map((x) => x.name)).toEqual(['a', 'b']);
  });
});
