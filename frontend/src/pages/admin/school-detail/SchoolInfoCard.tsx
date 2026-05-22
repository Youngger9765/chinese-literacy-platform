/**
 * SchoolInfoCard — view/edit card for school basic information.
 *
 * Extracted from SchoolDetailPanel (Issue #1849).
 * Uses EditSection primitive from shared admin components.
 */
import React from 'react';
import EditSection from '../../../components/admin/EditSection';
import { SchoolResponse } from '../../../services/schoolApi';

export interface SchoolInfoCardProps {
  school: SchoolResponse;
  /** Edit field states */
  isEditing: boolean;
  editName: string;
  editDisplayName: string;
  editAddress: string;
  editPhone: string;
  isSaving: boolean;
  editError: string;
  isTogglingActive: boolean;
  /** Callbacks */
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onEditName: (v: string) => void;
  onEditDisplayName: (v: string) => void;
  onEditAddress: (v: string) => void;
  onEditPhone: (v: string) => void;
  onToggleActive: () => void;
}

const INPUT_CLS =
  'w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors';

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const SchoolInfoCard: React.FC<SchoolInfoCardProps> = ({
  school,
  isEditing,
  editName,
  editDisplayName,
  editAddress,
  editPhone,
  isSaving,
  editError,
  isTogglingActive,
  onStartEdit,
  onCancelEdit,
  onSave,
  onEditName,
  onEditDisplayName,
  onEditAddress,
  onEditPhone,
  onToggleActive,
}) => {
  return (
    <EditSection
      title="學校資訊"
      isEditing={isEditing}
      onEdit={onStartEdit}
      onSave={onSave}
      onCancel={onCancelEdit}
      isSaving={isSaving}
      error={editError}
      className="bg-white rounded-2xl shadow-card"
    >
      {isEditing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-school-name" className="block text-sm font-medium text-gray-700 mb-1">
                學校名稱 <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-school-name"
                type="text"
                value={editName}
                onChange={(e) => onEditName(e.target.value)}
                required
                autoFocus
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="edit-school-display" className="block text-sm font-medium text-gray-700 mb-1">
                顯示名稱
              </label>
              <input
                id="edit-school-display"
                type="text"
                value={editDisplayName}
                onChange={(e) => onEditDisplayName(e.target.value)}
                placeholder="自訂顯示名稱"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="edit-school-phone" className="block text-sm font-medium text-gray-700 mb-1">
                電話
              </label>
              <input
                id="edit-school-phone"
                type="text"
                value={editPhone}
                onChange={(e) => onEditPhone(e.target.value)}
                placeholder="例：02-2345-6789"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="edit-school-address" className="block text-sm font-medium text-gray-700 mb-1">
                地址
              </label>
              <input
                id="edit-school-address"
                type="text"
                value={editAddress}
                onChange={(e) => onEditAddress(e.target.value)}
                placeholder="例：台北市大安區信義路四段1號"
                className={INPUT_CLS}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {school.display_name || school.name}
            </h2>
            {school.display_name && (
              <p className="text-xs text-gray-400 font-mono mt-0.5">{school.name}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-gray-500">
              <span className={school.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                {school.is_active ? '使用中' : '已停用'}
              </span>
              <span>{formatDate(school.created_at)}</span>
            </div>
            {(school.address || school.phone) && (
              <div className="mt-4 space-y-2 text-sm text-gray-600">
                {school.address && (
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                    </svg>
                    <span>{school.address}</span>
                  </div>
                )}
                {school.phone && (
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                    </svg>
                    <span>{school.phone}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onToggleActive}
              disabled={isTogglingActive}
              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors cursor-pointer ${
                isTogglingActive ? 'opacity-50 cursor-not-allowed' : ''
              } ${
                school.is_active
                  ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              {isTogglingActive ? '更新中...' : school.is_active ? '停用' : '啟用'}
            </button>
          </div>
        </div>
      )}
    </EditSection>
  );
};

export default SchoolInfoCard;
