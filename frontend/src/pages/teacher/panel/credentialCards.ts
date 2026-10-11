/**
 * 帳密卡 (#3378) —— 一張 A4 排滿全班，剪下來貼在課本第一頁（帳密卡是我們自己加的功能，非均一原生）。
 * 開一個只有卡片的列印視窗，不帶整個 app 的版面。
 */
export interface CredentialRow {
  name: string;
  seat_number: string;
  username: string;
  password: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function credentialCardsHtml(classroomName: string, rows: CredentialRow[], loginUrl: string): string {
  const cards = rows
    .map(
      (r) => `<div class="card">
  <div class="cls">${esc(classroomName)}・${esc(r.seat_number)} 號</div>
  <div class="name">${esc(r.name)}</div>
  <div class="row"><span>帳號</span><b>${esc(r.username)}</b></div>
  <div class="row"><span>密碼</span><b>${esc(r.password)}</b></div>
  <div class="url">${esc(loginUrl)}</div>
</div>`,
    )
    .join('\n');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(classroomName)} 帳密卡</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: "Noto Sans TC", system-ui, sans-serif; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .card { border: 1px dashed #999; border-radius: 3mm; padding: 4mm; break-inside: avoid; }
  .cls { font-size: 10pt; color: #555; }
  .name { font-size: 15pt; font-weight: 700; margin: 1mm 0 2mm; }
  .row { display: flex; justify-content: space-between; font-size: 12pt; margin: 1mm 0; }
  .row b { font-family: ui-monospace, Menlo, monospace; letter-spacing: .05em; }
  .url { font-size: 8pt; color: #777; margin-top: 2mm; word-break: break-all; }
  @media screen { body { padding: 16px; } .hint { margin-bottom: 12px; font-size: 14px; } }
  @media print { .hint { display: none; } }
</style></head><body>
<p class="hint">列印後沿虛線剪下，發給每位學生（建議貼在課本第一頁）</p>
<div class="grid">${cards}</div>
<script>window.onload = () => window.print();</script>
</body></html>`;
}

export function openCredentialCards(classroomName: string, rows: CredentialRow[]): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(credentialCardsHtml(classroomName, rows, `${window.location.origin}/login`));
  w.document.close();
}
