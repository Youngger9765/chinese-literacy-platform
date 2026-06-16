function filenameFromUrl(url: string): string {
  try {
    const base = new URL(url).pathname.split('/').pop();
    return base && base.length > 0 ? base : 'download';
  } catch {
    return 'download';
  }
}

/** Trigger a browser file download for a cross-origin URL (e.g. GCS public assets). */
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
