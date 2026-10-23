import { API_BASE } from './apiConfig';
/**
 * IAP allowlist API service — admin-only read of who IAP lets through to
 * staging/preview (Issue #3720). GCP is the source of truth; there is no
 * write endpoint here (grants are made by scripts/iap-grant.sh).
 */

export interface IapExternalGrant {
  email: string;
  name: string;
  status: 'active' | 'expired';
  expires_at: string | null;
}

export interface IapAllowlistResponse {
  configured: boolean;
  message?: string;
  junyi_domain_active?: boolean;
  external_grants?: IapExternalGrant[];
}

export class IapAllowlistApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IapAllowlistApiError';
    this.status = status;
  }
}

export async function getIapAllowlist(token: string): Promise<IapAllowlistResponse> {
  const res = await fetch(`${API_BASE}/api/admin/iap-allowlist`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new IapAllowlistApiError(message, res.status);
  }
  return res.json() as Promise<IapAllowlistResponse>;
}
