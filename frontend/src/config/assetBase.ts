/**
 * ASSET_BASE — base path for public course assets (thumbnails, lesson images),
 * served via the same-origin `/assets/*` proxy in front of the (now-private)
 * `lingoleap-assets` GCS bucket.
 *
 * Issue #2486: components used to hardcode
 * `https://storage.googleapis.com/lingoleap-assets/...` directly, which let
 * anyone anonymously enumerate + bulk-download the entire course library
 * (egress cost risk + content enumeration). The bucket is now private; the
 * backend's `/assets/{path}` route (app/routes/assets.py) reads it with its
 * own service-account credentials instead.
 *
 * Mirrors apiConfig.ts's own `API_BASE` resolution exactly, because the two
 * proxy paths are deployed identically:
 * - Firebase Hosting build (VITE_API_URL="") → relative "/assets", handled by
 *   the `/assets/**` rewrite in firebase.json (same trick as `/api/**`).
 * - Cloud Run direct-serve frontend / PR preview (VITE_API_URL=absolute
 *   backend URL) → `{backend}/assets`, a direct cross-origin call to the
 *   backend's own Cloud Run service.
 * - Local dev (VITE_API_URL unset) → same localhost:8000 default as API_BASE.
 */
import { API_BASE } from '../services/apiConfig';

export const ASSET_BASE = import.meta.env.VITE_ASSET_BASE ?? `${API_BASE}/assets`;
