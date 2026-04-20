const sharp = require('sharp');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { FaBookReader, FaRobot, FaChalkboardTeacher, FaUsers, FaCheck, FaQuestion } = require('react-icons/fa');

async function rasterizeIcon(IconComponent, color, size, filename) {
  const svgString = ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color: `#${color}`, size: String(size) })
  );
  await sharp(Buffer.from(svgString)).png().toFile(filename);
}

async function createGradient(filename, color1, color2, w, h, angle = '135') {
  const x2 = angle === '135' ? '100%' : '0%';
  const y2 = '100%';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="${x2}" y2="${y2}">
      <stop offset="0%" style="stop-color:${color1}"/>
      <stop offset="100%" style="stop-color:${color2}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filename);
}

(async () => {
  const dir = '/Users/young/project/chinese-literacy-platform/workspace/pitch-pptx';

  // Slide 1 hero background gradient
  await createGradient(`${dir}/hero-bg.png`, '#1a1a2e', '#3b3477', 1440, 810);

  // Decorative circle glow
  const glowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <defs><radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:rgba(91,79,196,0.5)"/>
      <stop offset="100%" style="stop-color:rgba(91,79,196,0)"/>
    </radialGradient></defs>
    <circle cx="200" cy="200" r="200" fill="url(#g)"/>
  </svg>`;
  await sharp(Buffer.from(glowSvg)).png().toFile(`${dir}/glow-purple.png`);

  // Icons
  await rasterizeIcon(FaBookReader, 'FFB74D', 128, `${dir}/icon-book.png`);
  await rasterizeIcon(FaRobot, '5B4FC4', 128, `${dir}/icon-robot.png`);
  await rasterizeIcon(FaChalkboardTeacher, '5B4FC4', 128, `${dir}/icon-teacher.png`);
  await rasterizeIcon(FaUsers, '5B4FC4', 128, `${dir}/icon-users.png`);
  await rasterizeIcon(FaCheck, '065f46', 96, `${dir}/icon-check.png`);
  await rasterizeIcon(FaQuestion, '5B4FC4', 96, `${dir}/icon-question.png`);

  // CTA gradient block
  await createGradient(`${dir}/cta-bg.png`, '#F0EEFA', '#E8E4F8', 1440, 300);

  // Slide 4 team bg
  await createGradient(`${dir}/cream-bg.png`, '#FDF8F0', '#FDF8F0', 1440, 810);

  console.log('Assets generated');
})();
