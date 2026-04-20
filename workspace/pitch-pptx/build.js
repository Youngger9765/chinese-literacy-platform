const pptxgen = require('pptxgenjs');
const path = require('path');
const html2pptx = require('/Users/young/.claude-junyi/skills/pptx/scripts/html2pptx.js');

async function main() {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'LingoLeap';
  pptx.title = '朗朗上口 — 5/1 簡報';

  const slidesDir = path.join(__dirname, 'slides');

  // Slide 1: Hero / Vision
  console.log('Building slide 1...');
  await html2pptx(path.join(slidesDir, 'slide1.html'), pptx, { tmpDir: slidesDir });

  // Slide 2: Product
  console.log('Building slide 2...');
  await html2pptx(path.join(slidesDir, 'slide2.html'), pptx, { tmpDir: slidesDir });

  // Slide 3: The Ask
  console.log('Building slide 3...');
  await html2pptx(path.join(slidesDir, 'slide3.html'), pptx, { tmpDir: slidesDir });

  // Slide 4: Team
  console.log('Building slide 4...');
  await html2pptx(path.join(slidesDir, 'slide4.html'), pptx, { tmpDir: slidesDir });

  const outPath = path.join(__dirname, '..', 'pitch.pptx');
  await pptx.writeFile({ fileName: outPath });
  console.log(`Presentation saved to ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
