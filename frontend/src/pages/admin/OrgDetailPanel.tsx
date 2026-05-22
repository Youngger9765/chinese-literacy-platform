import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getOrganization,
  updateOrganization,
  getPointsLogs,
  OrganizationDetailResponse,
  PointsLogResponse,
  OrganizationApiError,
} from '../../services/organizationApi';
import OrgInfoCard from './OrgInfoCard';
import OrgPointsUsage from './OrgPointsUsage';
import PointsLogsSection from './PointsLogsSection';
import OrgSchoolsSection from './OrgSchoolsSection';

interface OrgDetailPanelProps {
  organizationId: string;
  onSchoolCreated?: () => void;
  onSelectSchool?: (schoolId: number) => void;
}

const LOGS_PAGE_SIZE = 10;

const OrgDetailPanel: React.FC<OrgDetailPanelProps> = ({ organizationId, onSchoolCreated, onSelectSchool }) => {
  const { token } = useAuth();
  const [org, setOrg] = useState<OrganizationDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTaxId, setEditTaxId] = useState('');
  const [editContactEmail, setEditContactEmail] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Toggle active loading
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  // Points logs state
  const [logs, setLogs] = useState<PointsLogResponse[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsOffset, setLogsOffset] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);

  const loadOrg = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getOrganization(token, organizationId);
      setOrg(data);
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setError(err.message);
      } else {
        setError('無法載入機構資料');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, organizationId]);

  const loadLogs = useCallback(async (offset: number) => {
    if (!token) return;
    setLogsLoading(true);
    try {
      const data = await getPointsLogs(token, organizationId, { limit: LOGS_PAGE_SIZE, offset });
      if (offset === 0) {
        setLogs(data.items);
      } else {
        setLogs((prev) => [...prev, ...data.items]);
      }
      setLogsTotal(data.total);
      setLogsOffset(offset);
    } catch {
      // silently ignore log load errors
    } finally {
      setLogsLoading(false);
    }
  }, [token, organizationId]);

  useEffect(() => {
    setIsEditing(false);
    setLogs([]);
    setLogsOffset(0);
    loadOrg();
    loadLogs(0);
  }, [loadOrg, loadLogs]);

  const startEditing = () => {
    if (!org) return;
    setEditName(org.name);
    setEditDisplayName(org.display_name || '');
    setEditDescription(org.description || '');
    setEditTaxId(org.tax_id || '');
    setEditContactEmail(org.contact_email || '');
    setEditContactPhone(org.contact_phone || '');
    setEditAddress(org.address || '');
    setEditError('');
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !org || !editName.trim()) return;

    setIsSaving(true);
    setEditError('');
    try {
      await updateOrganization(token, org.id, {
        name: editName.trim(),
        display_name: editDisplayName.trim() || undefined,
        description: editDescription.trim() || undefined,
        tax_id: editTaxId.trim() || undefined,
        contact_email: editContactEmail.trim() || undefined,
        contact_phone: editContactPhone.trim() || undefined,
        address: editAddress.trim() || undefined,
      });
      setIsEditing(false);
      await loadOrg();
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setEditError(err.message);
      } else {
        setEditError('更新失敗');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!token || !org) return;
    const name = org.display_name || org.name;
    const confirmed = org.is_active
      ? window.confirm(`確定要停用「${name}」嗎？停用後將無法使用。`)
      : window.confirm(`確定要啟用「${name}」嗎？`);
    if (!confirmed) return;
    setIsTogglingActive(true);
    try {
      await updateOrganization(token, org.id, {
        is_active: !org.is_active,
      });
      await loadOrg();
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setError(err.message);
      } else {
        setError('更新狀態失敗');
      }
    } finally {
      setIsTogglingActive(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-card p-6 space-y-4">
            <div className="h-6 bg-gray-200 animate-pulse rounded w-1/3" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !org) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button onClick={loadOrg} className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer">
              重試
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!org) return null;

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Inline error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline cursor-pointer">關閉</button>
          </div>
        )}

        {/* Org info + business info card */}
        <OrgInfoCard
          org={org}
          isEditing={isEditing}
          editName={editName}
          editDisplayName={editDisplayName}
          editDescription={editDescription}
          editTaxId={editTaxId}
          editContactEmail={editContactEmail}
          editContactPhone={editContactPhone}
          editAddress={editAddress}
          isSaving={isSaving}
          editError={editError}
          onEdit={startEditing}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={() => setIsEditing(false)}
          onToggleActive={handleToggleActive}
          isTogglingActive={isTogglingActive}
          onChangeEditName={setEditName}
          onChangeEditDisplayName={setEditDisplayName}
          onChangeEditDescription={setEditDescription}
          onChangeEditTaxId={setEditTaxId}
          onChangeEditContactEmail={setEditContactEmail}
          onChangeEditContactPhone={setEditContactPhone}
          onChangeEditAddress={setEditAddress}
        />

        {/* Points usage section — only show if total_points is set */}
        {org.total_points != null && (
          <OrgPointsUsage
            totalPoints={org.total_points}
            usedPoints={org.used_points}
            subscriptionStartDate={org.subscription_start_date}
            subscriptionEndDate={org.subscription_end_date}
          />
        )}

        {/* Points log section */}
        <PointsLogsSection
          logs={logs}
          logsTotal={logsTotal}
          logsLoading={logsLoading}
          onLoadMore={() => loadLogs(logsOffset + LOGS_PAGE_SIZE)}
        />

        {/* Schools in this org */}
        {token && (
          <OrgSchoolsSection
            schools={org.schools}
            onSchoolCreated={async () => {
              await loadOrg();
              onSchoolCreated?.();
            }}
            onSelectSchool={onSelectSchool}
            organizationId={organizationId}
            token={token}
          />
        )}
      </div>
    </div>
  );
};

export default OrgDetailPanel;
