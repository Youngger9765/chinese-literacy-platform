import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  createOrganization,
  OrganizationApiError,
} from '../../services/organizationApi';

interface CreateOrgPanelProps {
  onCreated: (orgId: string) => void;
  onCancel: () => void;
}

const CreateOrgPanel: React.FC<CreateOrgPanelProps> = ({ onCreated, onCancel }) => {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim()) return;

    setIsSubmitting(true);
    setError('');
    try {
      const org = await createOrganization(token, {
        name: name.trim(),
        display_name: displayName.trim() || undefined,
      });
      onCreated(org.id);
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setError(err.message);
      } else {
        setError('建立機構失敗');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">新增機構</h2>
          <p className="text-sm text-gray-500 mt-1">建立新的機構，之後可在機構下新增學校</p>
        </div>

        <div className="bg-white rounded-2xl shadow-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="create-org-name" className="block text-sm font-medium text-gray-700 mb-1">
                機構代碼 <span className="text-red-500">*</span>
              </label>
              <input
                id="create-org-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                placeholder="例：junyi-academy"
                className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
              <p className="text-xs text-gray-400 mt-1">唯一識別碼，建立後不建議修改</p>
            </div>

            <div>
              <label htmlFor="create-org-display" className="block text-sm font-medium text-gray-700 mb-1">
                顯示名稱
              </label>
              <input
                id="create-org-display"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例：均一教育平台"
                className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !name.trim()}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                {isSubmitting ? '建立中...' : '建立機構'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateOrgPanel;
