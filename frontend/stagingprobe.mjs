import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 1400 } });
for (const F of ['https://lingoleap-staging.web.app',
                 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app']) {
  await p.goto(`${F}/learn/20063/full-text-annotate?p=p3kud`, { waitUntil: 'networkidle' }).catch(()=>{});
  await p.waitForTimeout(3000);
  const t = (await p.locator('body').innerText().catch(()=>'')).replace(/\s+/g,'');
  console.log(`── ${F.replace('https://','')}`);
  console.log(`   長度 ${t.length}  含「第2篇」: ${t.includes('第2篇')}  含「第23課」: ${t.includes('第23課')}  含「政府可以干預」: ${t.includes('政府可以干預')}`);
  console.log(`   開頭: ${t.slice(0,60)}`);
}
await b.close();
