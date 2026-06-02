import React, { useState } from 'react';
import { PlusIcon, SchoolIcon } from '../../components/icons';
import { SchoolInOrgResponse } from '../../services/organizationApi';
import {
  createSchool,
  SchoolApiError,
} from '../../services/schoolApi';

interface OrgSchoolsSectionProps {
  schools: SchoolInOrgResponse[];
  onSchoolCreated?: () => void;
  onSelectSchool?: (schoolId: number) => void;
  organizationId: string;
  token: string;
}

const OrgSchoolsSection: React.FC<OrgSchoolsSectionProps> = ({
  schools,
  onSchoolCreated,
  onSelectSchool,
  organizationId,
  token,
}) => {
  const [isCreatingSchool, setIsCreatingSchool] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState('');
  const [newSchoolAddress, setNewSchoolAddress] = useState('');
  const [newSchoolPhone, setNewSchoolPhone] = useState('');
  const [isSubmittingSchool, setIsSubmittingSchool] = useState(false);
  const [createSchoolError, setCreateSchoolError] = useState('');

  const resetSchoolForm = () => {
    setIsCreatingSchool(false);
    setNewSchoolName('');
    setNewSchoolAddress('');
    setNewSchoolPhone('');
    setCreateSchoolError('');
  };

  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newSchoolName.trim()) return;

    setIsSubmittingSchool(true);
    setCreateSchoolError('');
    try {
      await createSchool(token, {
        name: newSchoolName.trim(),
        organization_id: organizationId,
        address: newSchoolAddress.trim() || undefined,
        phone: newSchoolPhone.trim() || undefined,
      });
      resetSchoolForm();
      onSchoolCreated?.();
    } catch (err) {
      if (err instanceof SchoolApiError) {
        setCreateSchoolError(err.message);
      } else {
        setCreateSchoolError('建立學校失敗');
      }
    } finally {
      setIsSubmittingSchool(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-card">
      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-bold text-gray-900">所屬學校</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{schools.length} 所</span>
          {!isCreatingSchool && (
            <button
              onClick={() => setIsCreatingSchool(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              新增學校
            </button>
          )}
        </div>
      </div>

      {isCreatingSchool && (
        <div className="p-5 border-b border-gray-100 bg-gray-50/50">
          <form onSubmit={handleCreateSchool} className="space-y-4">
            <h4 className="text-sm font-bold text-gray-900">新增學校</h4>
            {createSchoolError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {createSchoolError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="new-school-name" className="block text-sm font-medium text-gray-700 mb-1">
                  學校名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  id="new-school-name"
                  type="text"
                  value={newSchoolName}
                  onChange={(e) => setNewSchoolName(e.target.value)}
                  required
                  autoFocus
                  placeholder="例：大安國小"
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label htmlFor="new-school-phone" className="block text-sm font-medium text-gray-700 mb-1">
                  電話
                </label>
                <input
                  id="new-school-phone"
                  type="text"
                  value={newSchoolPhone}
                  onChange={(e) => setNewSchoolPhone(e.target.value)}
                  placeholder="例：02-2345-6789"
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="new-school-address" className="block text-sm font-medium text-gray-700 mb-1">
                  地址
                </label>
                <input
                  id="new-school-address"
                  type="text"
                  value={newSchoolAddress}
                  onChange={(e) => setNewSchoolAddress(e.target.value)}
                  placeholder="例：台北市大安區信義路四段1號"
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={resetSchoolForm}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSubmittingSchool || !newSchoolName.trim()}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                {isSubmittingSchool ? '建立中...' : '建立學校'}
              </button>
            </div>
          </form>
        </div>
      )}

      {schools.length === 0 && !isCreatingSchool ? (
        <div className="p-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-accent-bg rounded-xl mb-3">
            <SchoolIcon className="w-6 h-6 text-accent" />
          </div>
          <p className="text-sm font-medium text-gray-700 mb-1">尚無所屬學校</p>
          <p className="text-xs text-gray-500">點擊上方「新增學校」按鈕建立</p>
        </div>
      ) : schools.length > 0 ? (
        <div className="divide-y divide-gray-100">
          {schools.map((school) => (
            <div
              key={school.id}
              onClick={() => onSelectSchool?.(school.id)}
              className={`px-5 py-3 flex items-center justify-between ${onSelectSchool ? 'cursor-pointer hover:bg-gray-50' : ''}`}
            >
              <div>
                <p className={`text-sm font-medium ${onSelectSchool ? 'text-accent hover:underline' : 'text-gray-900'}`}>
                  {school.display_name || school.name}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {school.address && (
                    <p className="text-xs text-gray-500 truncate max-w-xs">{school.address}</p>
                  )}
                </div>
              </div>
              <span className={`text-xs ${school.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                {school.is_active ? '使用中' : '已停用'}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default OrgSchoolsSection;
