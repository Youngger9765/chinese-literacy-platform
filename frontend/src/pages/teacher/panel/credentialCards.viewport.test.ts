/**
 * #3424: 帳密卡列印視窗沒有 `<meta name="viewport">`，手機瀏覽器用預設
 * ~980px 桌機 viewport 渲染，畫面上字變得很小。
 */
import { describe, it, expect } from 'vitest';
import { credentialCardsHtml } from './credentialCards';

const ROWS = [{ name: '王小明', seat_number: '1', username: 'd30sqw1', password: 'abc123' }];

describe('credentialCardsHtml — mobile viewport (#3424)', () => {
  it('includes a width=device-width viewport meta tag', () => {
    const html = credentialCardsHtml('測試班', ROWS, 'https://example.test/login');
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1">/);
  });

  it('the viewport meta appears inside <head>, before </head>', () => {
    const html = credentialCardsHtml('測試班', ROWS, 'https://example.test/login');
    const headStart = html.indexOf('<head>');
    const headEnd = html.indexOf('</head>');
    const viewportIndex = html.indexOf('name="viewport"');
    expect(viewportIndex).toBeGreaterThan(headStart);
    expect(viewportIndex).toBeLessThan(headEnd);
  });

  it('drops to a single column on narrow screens so a card is not itself squeezed', () => {
    const html = credentialCardsHtml('測試班', ROWS, 'https://example.test/login');
    expect(html).toMatch(/max-width:\s*480px\)\s*\{\s*\.grid\s*\{\s*grid-template-columns:\s*1fr/);
  });
});
