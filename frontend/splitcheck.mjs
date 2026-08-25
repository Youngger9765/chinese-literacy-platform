import { chromium } from 'playwright';
const F = 'https://lingoleap-staging.web.app';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 1600 } });
await p.goto(`${F}/login`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
// 懶人登入：學生 小明
const btn = p.locator('button', { hasText: '小明' }).first();
if (await btn.count() === 0) { console.log('  🔴 找不到懶人登入鈕（正向對照失敗，後面都不用看）'); process.exit(1); }
await btn.click();
await p.waitForTimeout(4000);
console.log(`  登入後 URL: ${p.url().replace(F,'')}  ${p.url().includes('/login') ? '🔴 還在登入頁' : '✅'}`);
for (const [code, id] of [['G5-L17',20029],['G6-L22',20063],['G8-L13',20111],['G9-L16',20137],['G9-L23',20144]]) {
  await p.goto(`${F}/learn/${id}/full-text-annotate`, { waitUntil: 'networkidle' }).catch(()=>{});
  await p.waitForTimeout(2500);
  const t = (await p.locator('body').innerText().catch(()=>'')).replace(/\s+/g,'');
  const nav = (await p.locator('nav, aside, [class*="stepper"], [class*="Stepper"]').allInnerTexts().catch(()=>[])).join('|');
  const nFull = (nav.match(/讀全文/g) || []).length;
  const nKey  = (nav.match(/念順順|重點朗讀/g) || []).length;
  const dup   = /第\s*2\s*篇/.test(t);
  console.log(`  ${code}  步驟列 讀全文×${nFull} 重點×${nKey}   同頁貼了第2篇: ${dup ? '🔴 有' : '否'}   ${t.length} 字`);
}
await b.close();
