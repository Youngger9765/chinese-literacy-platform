/**
 * Desktop left class list (#3401) — persistent "我的班級" list next to the
 * classroom detail tabs, modelled after the reference teacher UI we're matching
 * (a left sidebar listing every class with the current one highlighted).
 * Same data source as ClassSwitcher (the dropdown used on narrow screens);
 * this is the >=1024px alternative, not a replacement.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { ClassroomResponse, listMyClassrooms } from '../../../services/classroomApi';

interface ClassListSidebarProps {
  currentId: number;
  onSwitch: (classroomId: number) => void;
}

const ClassListSidebar: React.FC<ClassListSidebarProps> = ({ currentId, onSwitch }) => {
  const { token } = useAuth();
  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    if (!token) return;
    listMyClassrooms(token, { limit: 100 })
      .then((r) => setClassrooms(r.items))
      .catch(() => setClassrooms([]));
  }, [token]);

  // A single class has nothing to switch to; don't add a control that does
  // nothing (matches ClassSwitcher's own rule).
  if (classrooms.length < 2) return null;

  const activeClassrooms = classrooms.filter((classroom) => classroom.is_active !== false);
  const inactiveClassrooms = classrooms.filter((classroom) => classroom.is_active === false);

  const renderClassroom = (classroom: ClassroomResponse, isInactive = false) => {
    const isCurrent = classroom.id === currentId;
    const className = isInactive
      ? `w-full text-left px-3 py-2 rounded-lg text-sm font-normal transition-colors cursor-pointer truncate ${
          isCurrent ? 'bg-gray-50 text-gray-400' : 'text-gray-400 hover:bg-gray-50'
        }`
      : `w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer truncate ${
          isCurrent ? 'bg-accent-bg text-accent' : 'text-gray-700 hover:bg-gray-50'
        }`;

    return (
      <li key={classroom.id}>
        <button
          type="button"
          onClick={() => onSwitch(classroom.id)}
          aria-current={isCurrent ? 'true' : undefined}
          className={className}
        >
          {classroom.name}
          {classroom.grade != null ? `（${classroom.grade} 年級）` : ''}
        </button>
      </li>
    );
  };

  return (
    <nav aria-label="我的班級" className="bg-white rounded-2xl shadow-card p-3">
      <h2 className="px-2 py-1.5 text-sm font-semibold text-gray-500">我的班級</h2>
      <ul className="space-y-0.5">{activeClassrooms.map((classroom) => renderClassroom(classroom))}</ul>
      {inactiveClassrooms.length > 0 && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={() => setShowInactive((isOpen) => !isOpen)}
            aria-expanded={showInactive}
            className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded cursor-pointer"
          >
            已停用 ({inactiveClassrooms.length})
          </button>
          {showInactive && (
            <ul className="mt-1 space-y-0.5">
              {inactiveClassrooms.map((classroom) => renderClassroom(classroom, true))}
            </ul>
          )}
        </div>
      )}
    </nav>
  );
};

export default ClassListSidebar;
