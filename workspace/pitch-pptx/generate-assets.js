const sharp = require('sharp');
const path = require('path');

async function main() {
  const outDir = path.join(__dirname, 'slides');

  // Slide 1 background: dark navy gradient
  const bgSvg1 = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="810">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#1a1a2e"/>
        <stop offset="50%" style="stop-color:#2d2b55"/>
        <stop offset="100%" style="stop-color:#3b3477"/>
      </linearGradient>
      <radialGradient id="glow1" cx="85%" cy="10%" r="35%">
        <stop offset="0%" style="stop-color:rgba(91,79,196,0.4)"/>
        <stop offset="100%" style="stop-color:rgba(91,79,196,0)"/>
      </radialGradient>
      <radialGradient id="glow2" cx="10%" cy="90%" r="25%">
        <stop offset="0%" style="stop-color:rgba(255,183,77,0.2)"/>
        <stop offset="100%" style="stop-color:rgba(255,183,77,0)"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="url(#glow1)"/>
    <rect width="100%" height="100%" fill="url(#glow2)"/>
  </svg>`;
  await sharp(Buffer.from(bgSvg1)).png().toFile(path.join(outDir, 'bg-hero.png'));

  // Vision box gradient background
  const visionBgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200">
    <defs>
      <linearGradient id="v" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:rgba(91,79,196,0.35)"/>
        <stop offset="100%" style="stop-color:rgba(91,79,196,0.18)"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#v)" rx="10" ry="10"/>
  </svg>`;
  await sharp(Buffer.from(visionBgSvg)).png().toFile(path.join(outDir, 'vision-bg.png'));

  // Slide 3 CTA gradient background
  const ctaBgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="160">
    <defs>
      <linearGradient id="c" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#F0EEFA"/>
        <stop offset="100%" style="stop-color:#E8E4F8"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#c)" rx="12" ry="12"/>
  </svg>`;
  await sharp(Buffer.from(ctaBgSvg)).png().toFile(path.join(outDir, 'cta-bg.png'));

  // Gold gradient text image for "有耐心的閱讀老師"
  const goldTextSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="80">
    <defs>
      <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#FFB74D"/>
        <stop offset="100%" style="stop-color:#FFA726"/>
      </linearGradient>
    </defs>
    <text x="450" y="60" font-family="Arial" font-size="52" font-weight="800"
          fill="url(#gold)" text-anchor="middle">有耐心的閱讀老師</text>
  </svg>`;
  await sharp(Buffer.from(goldTextSvg)).png().toFile(path.join(outDir, 'gold-text.png'));

  // Crop photos to circles
  const photos = ['fang', 'kw', 'young', 'raymond', 'xiung'];
  const photoDir = path.join(__dirname, '..', '..', 'frontend', 'public', 'presentation', 'photos');
  for (const name of photos) {
    const ext = 'jpg';
    const src = path.join(photoDir, `${name}.${ext}`);
    const meta = await sharp(src).metadata();
    const size = Math.min(meta.width, meta.height);
    const circleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/>
    </svg>`;
    await sharp(src)
      .resize(size, size, { fit: 'cover', position: 'center' })
      .composite([{ input: Buffer.from(circleSvg), blend: 'dest-in' }])
      .png()
      .toFile(path.join(outDir, `${name}-circle.png`));
  }

  console.log('Assets generated');
}

main().catch(console.error);
