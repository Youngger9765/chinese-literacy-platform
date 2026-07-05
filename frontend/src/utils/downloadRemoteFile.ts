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

/** Trigger a browser file download for a same-origin or cross-origin URL. */
export async function downloadRemoteFile(url: string, filename?: string): Promise<void> {
  const response = await fetch(url);
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
