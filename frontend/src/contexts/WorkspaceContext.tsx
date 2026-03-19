/**
 * WorkspaceContext — manages the user's active "view" across the app.
 *
 * Solves #547 (hierarchy navigation), #548 (multi-school teacher),
 * #549 (multi-school student), #557 (multi-role switching).
 *
 * Persists activeView + activeSchoolId to localStorage so they survive
 * page refreshes. Auto-initialises from the user's role list on login.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import type { AuthUser, UserRole } from '../services/authApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The four possible "views" the sidebar can render. */
export type WorkspaceView = 'teacher' | 'student' | 'admin' | 'parent';

interface WorkspaceContextValue {
  /** Current sidebar view. Determines which nav items are shown. */
  activeView: WorkspaceView;
  /** Switch the sidebar view. Persisted to localStorage. */
  setActiveView: (view: WorkspaceView) => void;

  /** Currently-selected school ID (for teachers in multiple schools). */
  activeSchoolId: number | null;
  /** Switch active school. Persisted to localStorage. */
  setActiveSchoolId: (id: number | null) => void;

  /** All distinct views available to this user (derived from roles). */
  availableViews: WorkspaceView[];
  /** All school IDs the current user has a teacher role in. */
  teacherSchoolIds: number[];
  /** All school IDs the current user has a student role in. */
  studentSchoolIds: number[];

  /** Convenience: does the user have more than one view? */
  hasMultipleViews: boolean;
  /** Convenience: is the user a teacher in more than one school? */
  hasMultipleSchools: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LS_VIEW_KEY = 'lingoleap_workspace_view';
const LS_SCHOOL_KEY = 'lingoleap_workspace_school';

const TEACHER_ROLES = new Set([
  'teacher', 'homeroom_teacher', 'principal', 'director',
]);
const ADMIN_ROLES = new Set(['system_admin', 'org_owner', 'org_admin']);

function deriveAvailableViews(user: AuthUser | null): WorkspaceView[] {
  if (!user) return [];
  const views = new Set<WorkspaceView>();
  for (const r of user.roles) {
    if (ADMIN_ROLES.has(r.role_name)) views.add('admin');
    if (TEACHER_ROLES.has(r.role_name)) views.add('teacher');
    if (r.role_name === 'student') views.add('student');
    if (r.role_name === 'parent') views.add('parent');
  }
  // Admin users also get teacher view (they manage classrooms)
  if (views.has('admin') && !views.has('teacher')) views.add('teacher');
  return Array.from(views);
}

function deriveSchoolIds(user: AuthUser | null, roleNames: Set<string>): number[] {
  if (!user) return [];
  const ids = new Set<number>();
  for (const r of user.roles) {
    if (roleNames.has(r.role_name) && r.scope_type === 'school' && r.scope_id) {
      const id = parseInt(r.scope_id, 10);
      if (!Number.isNaN(id)) ids.add(id);
    }
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function pickDefaultView(available: WorkspaceView[], stored: string | null): WorkspaceView {
  if (stored && available.includes(stored as WorkspaceView)) {
    return stored as WorkspaceView;
  }
  // Priority: admin > teacher > student > parent
  const priority: WorkspaceView[] = ['admin', 'teacher', 'student', 'parent'];
  for (const v of priority) {
    if (available.includes(v)) return v;
  }
  return 'student';
}

function pickDefaultSchool(schoolIds: number[], stored: string | null): number | null {
  if (schoolIds.length === 0) return null;
  if (stored) {
    const id = parseInt(stored, 10);
    if (!Number.isNaN(id) && schoolIds.includes(id)) return id;
  }
  return schoolIds[0];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return ctx;
}

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const availableViews = useMemo(() => deriveAvailableViews(user), [user]);
  const teacherSchoolIds = useMemo(() => deriveSchoolIds(user, TEACHER_ROLES), [user]);
  const studentSchoolIds = useMemo(
    () => deriveSchoolIds(user, new Set(['student'])),
    [user],
  );

  const [activeView, setActiveViewRaw] = useState<WorkspaceView>(() =>
    pickDefaultView(availableViews, localStorage.getItem(LS_VIEW_KEY)),
  );
  const [activeSchoolId, setActiveSchoolIdRaw] = useState<number | null>(() =>
    pickDefaultSchool(teacherSchoolIds, localStorage.getItem(LS_SCHOOL_KEY)),
  );

  // Re-derive when user changes (login/logout)
  useEffect(() => {
    const views = deriveAvailableViews(user);
    const storedView = localStorage.getItem(LS_VIEW_KEY);
    setActiveViewRaw(pickDefaultView(views, storedView));

    const schools = deriveSchoolIds(user, TEACHER_ROLES);
    const storedSchool = localStorage.getItem(LS_SCHOOL_KEY);
    setActiveSchoolIdRaw(pickDefaultSchool(schools, storedSchool));
  }, [user]);

  const setActiveView = useCallback((view: WorkspaceView) => {
    setActiveViewRaw(view);
    try { localStorage.setItem(LS_VIEW_KEY, view); } catch { /* ignore */ }
  }, []);

  const setActiveSchoolId = useCallback((id: number | null) => {
    setActiveSchoolIdRaw(id);
    try {
      if (id != null) localStorage.setItem(LS_SCHOOL_KEY, String(id));
      else localStorage.removeItem(LS_SCHOOL_KEY);
    } catch { /* ignore */ }
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => ({
    activeView,
    setActiveView,
    activeSchoolId,
    setActiveSchoolId,
    availableViews,
    teacherSchoolIds,
    studentSchoolIds,
    hasMultipleViews: availableViews.length > 1,
    hasMultipleSchools: teacherSchoolIds.length > 1,
  }), [activeView, setActiveView, activeSchoolId, setActiveSchoolId, availableViews, teacherSchoolIds, studentSchoolIds]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};
