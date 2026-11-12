/**
 * IapAllowlistPanel — admin-only, read-only view of who IAP currently lets
 * through to staging/preview (Issue #3720, follow-up to #3719).
 *
 * GCP is the source of truth; there is no add/remove UI here on purpose —
 * grants are made with `scripts/iap-grant.sh` by Young/IT. Until IAP is
 * actually turned on (see #3719), the API returns `configured: false` and
 * this panel just explains that — it is not an error state.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { LockIcon } from '../../components/icons';
import { useAuth } from '../../contexts/AuthContext';
import {
  getIapAllowlist,
  IapAllowlistApiError,
  IapAllowlistResponse,
  IapExternalGrant,
} from '../../services/iapAllowlistApi';

const SERVICES_LABEL = 'staging 前台、staging 後台、PR 預覽站';
const DEFAULT_REQUEST_DAYS = 30;

function formatDate(iso: string | null): string {
  if (!iso) return '';
  // Keep this a plain slice rather than a full date lib — the API already
  // gives us an ISO string, and the UI only ever needs the date part.
  return iso.slice(0, 10);
}

export function buildItRequestText(grant: IapExternalGrant): string {
  return [
    '請協助為以下使用者重新開通 IAP 存取：',
    '',
    `Email：${grant.email}`,
    `姓名：${grant.name || '（未提供姓名）'}`,
    `服務：${SERVICES_LABEL}`,
    `建議效期：${DEFAULT_REQUEST_DAYS} 天（可依需求調整）`,
  ].join('\n');
}

const IapAllowlistPanel: React.FC = () => {
  const { token } = useAuth();
  const [data, setData] = useState<IapAllowlistResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const result = await getIapAllowlist(token);
      setData(result);
    } catch (err) {
      if (err instanceof IapAllowlistApiError) {
        setError(err.message);
      } else {
        setError('無法載入 IAP 開通名單');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCopy = async (grant: IapExternalGrant) => {
    try {
      await navigator.clipboard.writeText(buildItRequestText(grant));
      setCopiedEmail(grant.email);
      setTimeout(() => setCopiedEmail((current) => (current === grant.email ? null : current)), 2000);
    } catch {
      // ignore — clipboard access can be denied by the browser
    }
  };

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <LockIcon className="w-5 h-5 text-gray-400" />
          <div>
            <h2 className="text-xl font-bold text-gray-900">IAP 開通名單</h2>
            <p className="text-sm text-gray-500 mt-1">
              目前透過 IAP 被允許進入 staging / 預覽站的外部人員（唯讀，資料來自 GCP）
            </p>
          </div>
        </div>

        {error && (
          <div className="text-center py-6 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">無法載入：{error}</p>
            <button
              onClick={load}
              className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
            >
              重試
            </button>
          </div>
        )}

        {isLoading && !error && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-5 bg-gray-200 animate-pulse rounded w-2/3" />
            ))}
          </div>
        )}

        {!isLoading && !error && data && !data.configured && (
          <div className="text-center py-10 bg-gray-50 rounded-xl border border-gray-200">
            <p className="text-sm text-gray-500">{data.message}</p>
          </div>
        )}

        {!isLoading && !error && data && data.configured && (
          <div className="space-y-4">
            {data.junyi_domain_active && (
              <div className="text-sm text-gray-600 bg-accent-bg rounded-lg px-4 py-2">
                均一帳號：全部開通
              </div>
            )}

            {(data.external_grants ?? []).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">目前沒有外部開通紀錄</p>
            )}

            {(data.external_grants ?? []).length > 0 && (
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-4 py-2">Email</th>
                      <th className="text-left font-medium px-4 py-2">姓名</th>
                      <th className="text-left font-medium px-4 py-2">狀態</th>
                      <th className="text-left font-medium px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(data.external_grants ?? []).map((grant) => (
                      <tr key={grant.email}>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{grant.email}</td>
                        <td className="px-4 py-3 text-gray-700">{grant.name || '—'}</td>
                        <td className="px-4 py-3">
                          {grant.status === 'active' ? (
                            <span className="text-emerald-700">
                              已開通{grant.expires_at ? `（到期日 ${formatDate(grant.expires_at)}）` : ''}
                            </span>
                          ) : (
                            <span className="text-red-600">已過期，請 IT 協助開通 IAP</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {grant.status === 'expired' && (
                            <button
                              onClick={() => handleCopy(grant)}
                              className="text-xs text-accent underline hover:text-accent/80 cursor-pointer"
                            >
                              {copiedEmail === grant.email ? '已複製' : '複製給 IT 的資訊'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default IapAllowlistPanel;
