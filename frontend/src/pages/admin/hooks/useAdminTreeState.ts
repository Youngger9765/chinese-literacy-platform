/**
 * useAdminTreeState
 *
 * Manages all expand/collapse/load state for the admin org→school→classroom tree.
 * Extracted from AdminTreeSidebar (Issue #1950).
 */
import { useState, useCallback, useEffect } from 'react';
import {
  listOrganizations,
  getOrganization,
  OrganizationResponse,
  OrganizationApiError,
} from '../../../services/organizationApi';
import { listSchoolClassrooms, SchoolClassroomResponse } from '../../../services/schoolApi';
import type { SchoolInOrgResponse } from '../../../services/organizationApi';

// ── Types ─────────────────────────────────────────────────────────────────

export interface OrgTreeData {
  schools: SchoolInOrgResponse[];
  isLoading: boolean;
  error: string;
}

export interface SchoolTreeData {
  classrooms: SchoolClassroomResponse[];
  isLoading: boolean;
  error: string;
}

export interface AdminTreeStateResult {
  // Org list
  orgs: OrganizationResponse[];
  isLoadingOrgs: boolean;
  orgsError: string;
  loadOrgs: () => Promise<void>;

  // Org expand/collapse
  expandedOrgs: Set<string>;
  toggleOrg: (orgId: string) => Promise<void>;
  orgData: Record<string, OrgTreeData>;

  // School expand/collapse
  expandedSchools: Set<number>;
  toggleSchool: (schoolId: number) => Promise<void>;
  schoolData: Record<number, SchoolTreeData>;
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useAdminTreeState(
  token: string | null,
  refreshTrigger?: number,
): AdminTreeStateResult {
  const [orgs, setOrgs] = useState<OrganizationResponse[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
  const [orgsError, setOrgsError] = useState('');

  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [orgData, setOrgData] = useState<Record<string, OrgTreeData>>({});

  const [expandedSchools, setExpandedSchools] = useState<Set<number>>(new Set());
  const [schoolData, setSchoolData] = useState<Record<number, SchoolTreeData>>({});

  // ── Load organizations ──────────────────────────────────────────────────

  const loadOrgs = useCallback(async () => {
    if (!token) return;
    setIsLoadingOrgs(true);
    setOrgsError('');
    try {
      const data = await listOrganizations(token);
      setOrgs(data.items);
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setOrgsError(err.message);
      } else {
        setOrgsError('載入失敗');
      }
    } finally {
      setIsLoadingOrgs(false);
    }
  }, [token]);

  useEffect(() => {
    loadOrgs();
  }, [loadOrgs]);

  // Reload when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger != null && refreshTrigger > 0) {
      setOrgData({});
      setSchoolData({});
      loadOrgs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  // ── Expand / collapse org ───────────────────────────────────────────────

  const toggleOrg = useCallback(async (orgId: string) => {
    setExpandedOrgs(prev => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });

    // Fetch schools if not already loaded
    if (!orgData[orgId] && token) {
      setOrgData(prev => ({
        ...prev,
        [orgId]: { schools: [], isLoading: true, error: '' },
      }));
      try {
        const detail = await getOrganization(token, orgId);
        setOrgData(prev => ({
          ...prev,
          [orgId]: { schools: detail.schools, isLoading: false, error: '' },
        }));
      } catch (err) {
        const message = err instanceof OrganizationApiError ? err.message : '載入學校失敗';
        setOrgData(prev => ({
          ...prev,
          [orgId]: { schools: [], isLoading: false, error: message },
        }));
      }
    }
  }, [orgData, token]);

  // ── Expand / collapse school ─────────────────────────────────────────────

  const toggleSchool = useCallback(async (schoolId: number) => {
    setExpandedSchools(prev => {
      const next = new Set(prev);
      if (next.has(schoolId)) {
        next.delete(schoolId);
      } else {
        next.add(schoolId);
      }
      return next;
    });

    // Fetch classrooms if not already loaded
    if (!schoolData[schoolId] && token) {
      setSchoolData(prev => ({
        ...prev,
        [schoolId]: { classrooms: [], isLoading: true, error: '' },
      }));
      try {
        const classrooms = await listSchoolClassrooms(token, schoolId);
        setSchoolData(prev => ({
          ...prev,
          [schoolId]: { classrooms, isLoading: false, error: '' },
        }));
      } catch {
        setSchoolData(prev => ({
          ...prev,
          [schoolId]: { classrooms: [], isLoading: false, error: '載入班級失敗' },
        }));
      }
    }
  }, [schoolData, token]);

  return {
    orgs,
    isLoadingOrgs,
    orgsError,
    loadOrgs,
    expandedOrgs,
    toggleOrg,
    orgData,
    expandedSchools,
    toggleSchool,
    schoolData,
  };
}
