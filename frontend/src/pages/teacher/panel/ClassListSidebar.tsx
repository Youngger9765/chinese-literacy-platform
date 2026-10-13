/**
 * Desktop left class list (#3401) — persistent "我的班級" list next to the
 * classroom detail tabs, modelled after the reference teacher UI we're matching
 * (a left sidebar listing every class with the current one highlighted).
 * Same data source as ClassSwitcher (the dropdown used on narrow screens);
 * this is the >=1024px alternative, not a replacement.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { ClassroomResponse, listMyClassrooms } from '../../../services/classroomApi';

interface ClassListSidebarProps {
  currentId: number;
  onSwitch: (classroomId: number) => void;
}

const ClassListSidebar: React.FC<ClassListSidebarProps> = ({ currentId, onSwitch }) => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    if (!token) return;
    listMyClassrooms(token, { limit: 100 })
      .then((r) => setClassrooms(r.items))
      .catch(() => setClassrooms([]));
  }, [token]);

  // Junyi-parity: the column is always there (even with one class) because it
  // also holds 建立班級 — with nothing there the page showed an empty gap that looked broken.

  const activeClassrooms = classrooms.filter((classroom) => classroom.is_active !== false);
  const inactiveClassrooms = classrooms.filter((classroom) => classroom.is_active === false);

  const renderClassroom = (classroom: ClassroomResponse, isInactive = false) => {
    const isCurrent = classroom.id === currentId;
    const className = isInactive
      ? `w-full text-left px-4 py-3 text-base font-normal transition-colors cursor-pointer break-words ${
          isCurrent ? 'bg-gray-50 text-gray-400' : 'text-gray-400 hover:bg-gray-50'
        }`
      : `w-full text-left px-4 py-3 text-base font-medium transition-colors cursor-pointer break-words border-r-4 ${
          isCurrent ? 'bg-accent-bg text-accent border-accent' : 'text-gray-700 hover:bg-gray-50 border-transparent'
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
    <nav aria-label="我的班級" className="py-4">
      <div className="px-4 pb-4 border-b border-gray-200">
        <button
          type="button"
          onClick={() => navigate('/teacher', { state: { intent: 'create' } })}
          className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-accent hover:bg-accent-hover text-white text-base font-medium transition-colors cursor-pointer"
        >
          <span aria-hidden="true" className="text-lg leading-none">＋</span>
          建立班級
        </button>
      </div>
      <h2 className="px-5 pt-4 pb-2 text-base font-bold text-gray-900">我的班級</h2>
      <ul>{activeClassrooms.map((classroom) => renderClassroom(classroom))}</ul>
      {inactiveClassrooms.length > 0 && (
        <div className="mt-2 border-t border-gray-100 pt-2 px-4">
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
