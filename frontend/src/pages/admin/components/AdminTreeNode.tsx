/**
 * AdminTreeNode
 *
 * Recursive tree node component for org → school → classroom hierarchy.
 * Extracted from AdminTreeSidebar (Issue #1950).
 */
import React from 'react';
import { BuildingIcon, SchoolIcon } from '../../../components/icons';
import { ChevronIcon } from './AdminTreeIcons';
import type { OrgTreeData, SchoolTreeData } from '../hooks/useAdminTreeState';
import type { OrganizationResponse } from '../../../services/organizationApi';
import type { TreeNodeSelection } from '../AdminTreeSidebar';

// ── Types ─────────────────────────────────────────────────────────────────

interface OrgNodeProps {
  org: OrganizationResponse;
  isSelected: boolean;
  isExpanded: boolean;
  orgData: OrgTreeData | undefined;
  expandedSchools: Set<number>;
  schoolData: Record<number, SchoolTreeData>;
  onToggleOrg: (orgId: string) => void;
  onSelectNode: (node: TreeNodeSelection) => void;
  onToggleSchool: (schoolId: number) => void;
  isSchoolSelected: (id: number) => boolean;
  isClassroomSelected: (id: number) => boolean;
}

// ── Loading spinner (shared small) ────────────────────────────────────────

const SmallSpinner: React.FC = () => (
  <div className="flex items-center gap-2">
    <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
    <span className="text-xs text-gray-400">載入中...</span>
  </div>
);

// ── AdminTreeNode ─────────────────────────────────────────────────────────

const AdminTreeNode: React.FC<OrgNodeProps> = ({
  org,
  isSelected,
  isExpanded,
  orgData,
  expandedSchools,
  schoolData,
  onToggleOrg,
  onSelectNode,
  onToggleSchool,
  isSchoolSelected,
  isClassroomSelected,
}) => {
  return (
    <div>
      {/* Org row */}
      <div
        className={`flex items-center gap-1 px-2 py-1 mx-1 rounded-md group transition-colors ${
          isSelected
            ? 'bg-blue-50 text-blue-700'
            : 'hover:bg-gray-50'
        }`}
      >
        {/* Chevron toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleOrg(org.id); }}
          className="p-0.5 rounded hover:bg-gray-200/50 cursor-pointer shrink-0"
          aria-label={isExpanded ? '收合' : '展開'}
        >
          <ChevronIcon expanded={isExpanded} />
        </button>

        {/* Org name button */}
        <button
          onClick={() => onSelectNode({ type: 'org', id: org.id })}
          className="flex items-center gap-1.5 flex-1 min-w-0 py-0.5 cursor-pointer text-left"
        >
          <BuildingIcon className={isSelected ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-500'} />
          <span className={`text-sm truncate ${
            isSelected ? 'font-semibold text-blue-700' : 'text-gray-700'
          }`}>
            {org.display_name || org.name}
          </span>
          {org.school_count > 0 && (
            <span className={`text-[10px] ml-auto shrink-0 ${
              isSelected ? 'text-blue-400' : 'text-gray-400'
            }`}>
              {org.school_count}
            </span>
          )}
        </button>
      </div>

      {/* Expanded children: schools */}
      {isExpanded && (
        <div className="ml-4">
          {/* Loading schools */}
          {orgData?.isLoading && (
            <div className="pl-4 py-1">
              <SmallSpinner />
            </div>
          )}

          {/* Error loading schools */}
          {orgData?.error && (
            <div className="pl-4 py-1">
              <span className="text-xs text-red-500">{orgData.error}</span>
            </div>
          )}

          {/* School nodes */}
          {orgData && !orgData.isLoading && !orgData.error && orgData.schools.map((school) => {
            const schoolSelected = isSchoolSelected(school.id);
            const isSchoolExpanded = expandedSchools.has(school.id);
            const sData = schoolData[school.id];

            return (
              <div key={school.id}>
                <div
                  className={`flex items-center gap-1 px-2 py-1 mx-1 rounded-md group transition-colors ${
                    schoolSelected
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {/* Chevron toggle for school */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleSchool(school.id); }}
                    className="p-0.5 rounded hover:bg-gray-200/50 cursor-pointer shrink-0"
                    aria-label={isSchoolExpanded ? '收合' : '展開'}
                  >
                    <ChevronIcon expanded={isSchoolExpanded} />
                  </button>

                  {/* School name button */}
                  <button
                    onClick={() => onSelectNode({ type: 'school', id: school.id })}
                    className="flex items-center gap-1.5 flex-1 min-w-0 py-0.5 cursor-pointer text-left"
                  >
                    <SchoolIcon className={schoolSelected ? 'text-emerald-500' : 'text-gray-400 group-hover:text-gray-500'} />
                    <span className={`text-sm truncate ${
                      schoolSelected ? 'font-semibold text-emerald-700' : 'text-gray-600'
                    }`}>
                      {school.display_name || school.name}
                    </span>
                    {!school.is_active && (
                      <span className="text-[10px] text-gray-400 ml-auto shrink-0">停用</span>
                    )}
                  </button>
                </div>

                {/* Expanded children: classrooms */}
                {isSchoolExpanded && (
                  <div className="ml-4">
                    {/* Loading classrooms */}
                    {sData?.isLoading && (
                      <div className="pl-4 py-1">
                        <SmallSpinner />
                      </div>
                    )}

                    {/* Error loading classrooms */}
                    {sData?.error && (
                      <div className="pl-4 py-1">
                        <span className="text-xs text-red-500">{sData.error}</span>
                      </div>
                    )}

                    {/* Classroom nodes */}
                    {sData && !sData.isLoading && !sData.error && sData.classrooms.map((cls) => {
                      const clsSelected = isClassroomSelected(cls.id);

                      return (
                        <button
                          key={cls.id}
                          onClick={() => onSelectNode({ type: 'classroom', id: cls.id })}
                          className={`flex items-center gap-1.5 w-full pl-6 pr-2 py-0.5 mx-1 rounded-md text-left transition-colors cursor-pointer group ${
                            clsSelected
                              ? 'bg-sky-50 text-sky-700'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <span className={`text-xs truncate ${
                            clsSelected ? 'font-semibold text-sky-700' : 'text-gray-500'
                          }`}>
                            {cls.name}
                          </span>
                          {!cls.is_active && (
                            <span className="text-[10px] text-gray-400 ml-auto shrink-0">停用</span>
                          )}
                        </button>
                      );
                    })}

                    {/* No classrooms */}
                    {sData && !sData.isLoading && !sData.error && sData.classrooms.length === 0 && (
                      <div className="pl-6 py-1">
                        <span className="text-xs text-gray-400">無班級</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* No schools */}
          {orgData && !orgData.isLoading && !orgData.error && orgData.schools.length === 0 && (
            <div className="pl-4 py-1">
              <span className="text-xs text-gray-400">無所屬學校</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminTreeNode;
