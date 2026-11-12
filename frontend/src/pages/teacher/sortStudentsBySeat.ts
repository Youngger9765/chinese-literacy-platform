/**
 * sortStudentsBySeat — shared roster ordering (#3992, Junyi-parity 座號).
 *
 * Extracted so StudentListTab's table AND SeatNumberDialog (owned one
 * level up, by ClassroomDetail) show the roster in the SAME order. Before
 * this was pulled out, ClassroomDetail passed `classroom.students` --
 * un-sorted, original enrollment order -- straight into the dialog while
 * StudentListTab sorted its own copy locally: reopening the dialog after
 * saving a new seat order silently reset it back to enrollment order,
 * discovered via real end-to-end QA on the PR preview (teacher saves
 * 小華=1/小明=2/skip/E2e-diag=4, closes the dialog, reopens it, sees
 * 小明/小華/E2e-diag again).
 *
 * Students with no seat_number yet sort after every seated student; ties
 * (including "nobody has a seat yet") keep their original relative order
 * via a stable sort, so the list doesn't reshuffle on every re-render.
 */
import type { StudentInClassroomResponse } from '../../services/classroomApi';

export function sortStudentsBySeat(
  students: StudentInClassroomResponse[],
): StudentInClassroomResponse[] {
  return students
    .map((s, originalIndex) => ({ s, originalIndex }))
    .sort((a, b) => {
      const aSeat = a.s.seat_number ?? Infinity;
      const bSeat = b.s.seat_number ?? Infinity;
      if (aSeat !== bSeat) return aSeat - bSeat;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ s }) => s);
}
