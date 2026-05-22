import React from 'react';
import EditSection from '../../components/admin/EditSection';
import { OrganizationDetailResponse } from '../../services/organizationApi';

interface OrgInfoCardProps {
  org: OrganizationDetailResponse;
  isEditing: boolean;
  editName: string;
  editDisplayName: string;
  editDescription: string;
  editTaxId: string;
  editContactEmail: string;
  editContactPhone: string;
  editAddress: string;
  isSaving: boolean;
  editError: string;
  onEdit: () => void;
  onSaveEdit: (e: React.FormEvent) => void;
  onCancelEdit: () => void;
  onToggleActive: () => void;
  isTogglingActive: boolean;
  onChangeEditName: (v: string) => void;
  onChangeEditDisplayName: (v: string) => void;
  onChangeEditDescription: (v: string) => void;
  onChangeEditTaxId: (v: string) => void;
  onChangeEditContactEmail: (v: string) => void;
  onChangeEditContactPhone: (v: string) => void;
  onChangeEditAddress: (v: string) => void;
}

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

const OrgInfoCard: React.FC<OrgInfoCardProps> = ({
  org,
  isEditing,
  editName,
  editDisplayName,
  editDescription,
  editTaxId,
  editContactEmail,
  editContactPhone,
  editAddress,
  isSaving,
  editError,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onToggleActive,
  isTogglingActive,
  onChangeEditName,
  onChangeEditDisplayName,
  onChangeEditDescription,
  onChangeEditTaxId,
  onChangeEditContactEmail,
  onChangeEditContactPhone,
  onChangeEditAddress,
}) => {
  return (
    <>
      <EditSection
        title="機構資訊"
        isEditing={isEditing}
        onEdit={onEdit}
        onSave={() => undefined}
        onCancel={onCancelEdit}
        isSaving={isSaving}
        error={editError}
        className="contents [&>div:first-child]:hidden [&>div:nth-child(2)]:contents [&>div:last-child]:hidden"
      >
        <div className="bg-white rounded-2xl shadow-card p-6">
          {isEditing ? (
            <form onSubmit={onSaveEdit} className="space-y-4">
              <h2 className="text-base font-bold text-gray-900">編輯機構</h2>
              {editError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {editError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-org-name" className="block text-sm font-medium text-gray-700 mb-1">
                    機構代碼 <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="edit-org-name"
                    type="text"
                    value={editName}
                    onChange={(e) => onChangeEditName(e.target.value)}
                    required
                    autoFocus
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="edit-org-display" className="block text-sm font-medium text-gray-700 mb-1">
                    顯示名稱
                  </label>
                  <input
                    id="edit-org-display"
                    type="text"
                    value={editDisplayName}
                    onChange={(e) => onChangeEditDisplayName(e.target.value)}
                    placeholder="自訂顯示名稱"
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="edit-org-tax-id" className="block text-sm font-medium text-gray-700 mb-1">
                    統一編號
                  </label>
                  <input
                    id="edit-org-tax-id"
                    type="text"
                    value={editTaxId}
                    onChange={(e) => onChangeEditTaxId(e.target.value)}
                    placeholder="例：12345678"
                    maxLength={20}
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="edit-org-email" className="block text-sm font-medium text-gray-700 mb-1">
                    聯絡信箱
                  </label>
                  <input
                    id="edit-org-email"
                    type="email"
                    value={editContactEmail}
                    onChange={(e) => onChangeEditContactEmail(e.target.value)}
                    placeholder="contact@example.com"
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="edit-org-phone" className="block text-sm font-medium text-gray-700 mb-1">
                    聯絡電話
                  </label>
                  <input
                    id="edit-org-phone"
                    type="text"
                    value={editContactPhone}
                    onChange={(e) => onChangeEditContactPhone(e.target.value)}
                    placeholder="例：02-1234-5678"
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="edit-org-address" className="block text-sm font-medium text-gray-700 mb-1">
                    地址
                  </label>
                  <input
                    id="edit-org-address"
                    type="text"
                    value={editAddress}
                    onChange={(e) => onChangeEditAddress(e.target.value)}
                    placeholder="例：台北市中正區重慶南路一段122號"
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="edit-org-description" className="block text-sm font-medium text-gray-700 mb-1">
                    備註說明
                  </label>
                  <textarea
                    id="edit-org-description"
                    value={editDescription}
                    onChange={(e) => onChangeEditDescription(e.target.value)}
                    rows={3}
                    placeholder="機構簡介或備註"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !editName.trim()}
                  className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
                >
                  {isSaving ? '儲存中...' : '儲存'}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {org.display_name || org.name}
                </h2>
                {org.display_name && (
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{org.name}</p>
                )}
                <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-gray-500">
                  <span className={org.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                    {org.is_active ? '使用中' : '已停用'}
                  </span>
                  <span>{org.school_count} 所學校</span>
                  <span>{formatDate(org.created_at)}</span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={onEdit}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  編輯
                </button>
                <button
                  onClick={onToggleActive}
                  disabled={isTogglingActive}
                  className={`px-3 py-1.5 rounded-lg border text-sm transition-colors cursor-pointer ${
                    isTogglingActive ? 'opacity-50 cursor-not-allowed' : ''
                  } ${
                    org.is_active
                      ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  {isTogglingActive ? '更新中...' : org.is_active ? '停用' : '啟用'}
                </button>
              </div>
            </div>
          )}
        </div>
      </EditSection>

      {!isEditing && (org.description || org.tax_id || org.contact_email || org.contact_phone || org.address) && (
        <div className="bg-white rounded-2xl shadow-card p-6">
          <h3 className="font-bold text-gray-900 mb-4">商業資訊</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {org.tax_id && (
              <>
                <dt className="text-gray-500">統一編號</dt>
                <dd className="text-gray-900 font-mono">{org.tax_id}</dd>
              </>
            )}
            {org.contact_email && (
              <>
                <dt className="text-gray-500">聯絡信箱</dt>
                <dd className="text-gray-900">{org.contact_email}</dd>
              </>
            )}
            {org.contact_phone && (
              <>
                <dt className="text-gray-500">聯絡電話</dt>
                <dd className="text-gray-900">{org.contact_phone}</dd>
              </>
            )}
            {org.address && (
              <>
                <dt className="text-gray-500">地址</dt>
                <dd className="text-gray-900 sm:col-span-1">{org.address}</dd>
              </>
            )}
            {org.description && (
              <>
                <dt className="text-gray-500 sm:col-span-2 mt-1">備註說明</dt>
                <dd className="text-gray-700 sm:col-span-2 whitespace-pre-wrap">{org.description}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </>
  );
};

export default OrgInfoCard;
