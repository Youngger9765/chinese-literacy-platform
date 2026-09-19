function filenameFromUrl(url: string): string {
  try {
    // Issue #2486: worksheet URLs are now same-origin relative paths
    // (e.g. "/assets/worksheets/G5-L23.pdf") rather than absolute GCS URLs.
    // `new URL(url)` throws on a relative string with no base — pass
    // window.location.origin as the base so both shapes resolve correctly.
    const base = new URL(url, window.location.origin).pathname.split('/').pop();
    return base && base.length > 0 ? base : 'download';
  } catch {
    return 'download';
  }
}

async function triggerBlobDownload(response: Response, url: string, filename?: string): Promise<void> {
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename ?? filenameFromUrl(url);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

/** Trigger a browser file download for a same-origin or cross-origin URL. */
export async function downloadRemoteFile(url: string, filename?: string): Promise<void> {
  const response = await fetch(url);
  await triggerBlobDownload(response, url, filename);
}

/**
 * Same as downloadRemoteFile, but attaches an Authorization header (#3276).
 *
 * Needed for role-gated endpoints (e.g. GET /api/lessons/{uid}/worksheet/teacher)
 * that require a Bearer token — a bare `fetch(url)` like downloadRemoteFile's
 * always sends anonymously, which is fine for the public /assets/* proxy but
 * would just get a 401 here.
 */
export async function downloadAuthenticatedFile(
  url: string,
  token: string,
  filename?: string,
): Promise<void> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  await triggerBlobDownload(response, url, filename);
}
