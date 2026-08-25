import { chromium } from 'playwright';
const F = 'https://lingoleap-staging.web.app';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 1600 } });
await p.goto(`${F}/login`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.locator('button', { hasText: '小明' }).first().click();
await p.waitForTimeout(4000);
await p.goto(`${F}/learn/20063/full-text-annotate`, { waitUntil: 'networkidle' });
await p.waitForTimeout(3500);
// 所有可點的導覽元素文字（不預設是 nav）
const all = await p.locator('a[href*="/learn/"], button').allInnerTexts();
const steps = all.map(s => s.replace(/\s+/g,' ').trim()).filter(Boolean);
console.log('  可點元素文字（前 30）:');
console.log('   ', JSON.stringify(steps.slice(0,30)));
const hrefs = await p.locator('a[href*="/learn/20063/"]').evaluateAll(a => a.map(x => x.getAttribute('href')));
console.log(`  指向本課的連結 ${hrefs.length} 個:`);
console.log('   ', JSON.stringify(hrefs.slice(0,25)));
await b.close();
