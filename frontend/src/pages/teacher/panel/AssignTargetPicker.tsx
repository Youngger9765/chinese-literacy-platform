/**
 * 派給誰 (#3378，照均一)：全班或勾選部分學生；也可以同一份作業一次派給我的其他班。
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  ClassroomResponse,
  StudentInClassroomResponse,
  getClassroomDetail,
  listMyClassrooms,
} from '../../../services/classroomApi';

interface AssignTargetPickerProps {
  classroomId: number;
  /** null = whole class */
  studentIds: number[] | null;
  onStudentIds: (ids: number[] | null) => void;
  extraClassIds: number[];
  onExtraClassIds: (ids: number[]) => void;
}

const toggle = (ids: number[], id: number) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

const AssignTargetPicker: React.FC<AssignTargetPickerProps> = ({
  classroomId,
  studentIds,
  onStudentIds,
  extraClassIds,
  onExtraClassIds,
}) => {
  const { token } = useAuth();
  const [students, setStudents] = useState<StudentInClassroomResponse[]>([]);
  const [otherClasses, setOtherClasses] = useState<ClassroomResponse[]>([]);

  useEffect(() => {
    if (!token) return;
    getClassroomDetail(token, classroomId).then((d) => setStudents(d.students)).catch(() => setStudents([]));
    listMyClassrooms(token, { limit: 100 })
      .then((r) => setOtherClasses(r.items.filter((c) => c.id !== classroomId && c.is_active)))
      .catch(() => setOtherClasses([]));
  }, [token, classroomId]);

  const some = studentIds !== null;

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold text-gray-500 tracking-wide mb-2">派給誰</legend>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="radio" name="assign-target" checked={!some} onChange={() => onStudentIds(null)} />
          全班（{students.length} 人）
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="radio" name="assign-target" checked={some} onChange={() => onStudentIds([])} />
          部分學生
        </label>
      </div>

      {some && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto rounded-lg border border-gray-200 p-3" aria-label="選擇學生">
          {students.map((s) => (
            <label key={s.id} className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={studentIds!.includes(s.id)}
                onChange={() => onStudentIds(toggle(studentIds!, s.id))}
              />
              {s.name}
            </label>
          ))}
          {studentIds!.length === 0 && <p className="col-span-full text-sm text-amber-700">至少勾選一位學生</p>}
        </div>
      )}

      {otherClasses.length > 0 && (
        <div>
          <p className="text-sm text-gray-700 mb-1">同時派給其他班（全班）</p>
          <div className="flex flex-wrap gap-3">
            {otherClasses.map((c) => (
              <label key={c.id} className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={extraClassIds.includes(c.id)}
                  onChange={() => onExtraClassIds(toggle(extraClassIds, c.id))}
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
};

export default AssignTargetPicker;
