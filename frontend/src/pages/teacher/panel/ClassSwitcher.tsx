/**
 * 班級切換器 (#3367)
 *
 * 現場回饋：多班級時容易混淆。頁首常駐一個切換器，切到別班時停在同一個分頁，
 * 老師不必回班級列表再點進來、也不會弄丟正在看的分頁。
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { ClassroomResponse, listMyClassrooms } from '../../../services/classroomApi';

interface ClassSwitcherProps {
  currentId: number;
  onSwitch: (classroomId: number) => void;
}

const ClassSwitcher: React.FC<ClassSwitcherProps> = ({ currentId, onSwitch }) => {
  const { token } = useAuth();
  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);

  useEffect(() => {
    if (!token) return;
    listMyClassrooms(token, { limit: 100 })
      .then((r) => setClassrooms(r.items))
      .catch(() => setClassrooms([]));
  }, [token]);

  // A single class has nothing to switch to; don't add a control that does nothing.
  if (classrooms.length < 2) return null;

  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
      切換班級
      <select
        value={currentId}
        onChange={(e) => onSwitch(Number(e.target.value))}
        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-base font-semibold text-gray-900 cursor-pointer"
        aria-label="切換班級"
      >
        {classrooms.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}{c.grade != null ? `（${c.grade} 年級）` : ''}
          </option>
        ))}
      </select>
    </label>
  );
};

export default ClassSwitcher;
