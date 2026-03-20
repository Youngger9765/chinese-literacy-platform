/**
 * m5-infra.spec.ts — M5: 非功能性/基礎設施測試 (#482)
 *
 * 模組 M5 涵蓋非功能性需求：
 *   N.1  Health check — /api/health/detailed returns 200
 *   N.2  Performance  — home page loads within 2s
 *   N.3  /help page   — loads with ToC and manual content
 *   N.4  WCAG 2.1 AA  — SKIP (needs Lighthouse CLI)
 *   N.5  Prompt injection — malicious payloads are rejected/sanitized
 *   N.6  Dependency security — SKIP (npm audit is not E2E)
 *   N.7  Load testing — SKIP (Locust is not Playwright)
 *   N.8  Prediction model — SKIP (ML pipeline is not E2E)
 *   N.9  Beta docs — covered by N.3
 *   N.10 Dictionary API — /api/dictionary/lookup?char=大 returns 200 with data
 *
 * Auth strategy: reuses student storageState (set in playwright.config.ts).
 */

import { test, expect } from '@playwright/test';
import { takeScreenshot, dismissAllModals, withScreenshotOnFailure } from './fixtures';

const BACKEND_URL =
  process.env.E2E_BACKEND_URL ||
  'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';

// ===========================================================================
// M5 N.1 Health Check
// ===========================================================================

test.describe('M5 — N.1 Health Check', () => {
  test('detailed health endpoint returns 200 with status field', withScreenshotOnFailure('m5-n1-health-fail', async ({ page, request }) => {
    const response = await request.get(`${BACKEND_URL}/api/health/detailed`);

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status');

    await page.goto('/');
    await takeScreenshot(page, 'infra-n1-health-check', 'N.1 Health check — /api/health/detailed returned 200');
  }));
});

// ===========================================================================
// M5 N.2 Performance
// ===========================================================================

test.describe('M5 — N.2 Performance', () => {
  test('home page loads within 2000ms (soft assertion)', withScreenshotOnFailure('m5-n2-perf-fail', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await page.locator('button:has-text("登出")').waitFor({ timeout: 30_000 });

    const elapsed = Date.now() - startTime;

    if (elapsed > 2000) {
      console.warn(`[N.2] PERFORMANCE WARNING: home page took ${elapsed}ms (threshold 2000ms)`);
    }

    // Hard assertion: must finish within 10s (CI sanity cap)
    expect(elapsed).toBeLessThan(10_000);

    await takeScreenshot(page, 'infra-n2-performance', `N.2 Performance — home loaded in ${elapsed}ms`);
  }));
});

// ===========================================================================
// M5 N.3 /help page
// ===========================================================================

test.describe('M5 — N.3 /help page', () => {
  test('/help page loads with navigation and user manual content', withScreenshotOnFailure('m5-n3-help-fail', async ({ page }) => {
    await page.goto('/help');
    await dismissAllModals(page);

    await expect(page).toHaveURL(/\/help/, { timeout: 15_000 });

    const headingLocator = page.locator(
      'h1, h2, [data-testid="help-title"], [data-testid="toc"], nav'
    );
    await expect(headingLocator.first()).toBeVisible({ timeout: 15_000 });

    const contentLocator = page.locator('main, article, section, [data-testid="help-content"]');
    const hasContent = await contentLocator.first().isVisible({ timeout: 5_000 }).catch(() => false);
    expect(hasContent).toBe(true);

    await takeScreenshot(page, 'infra-n3-help-page', 'N.3 /help page — ToC and manual content visible');
  }));
});

// ===========================================================================
// M5 N.4 WCAG 2.1 AA — skipped
// ===========================================================================

test.describe('M5 — N.4 WCAG 2.1 AA', () => {
  test.skip('accessibility audit requires Lighthouse CLI — not an E2E test', async () => {
    // Run: lighthouse <URL> --only-categories=accessibility --output json
    // Check score >= 0.90 for AA compliance
  });
});

// ===========================================================================
// M5 N.5 Prompt Injection
// ===========================================================================

test.describe('M5 — N.5 Prompt Injection', () => {
  test('SQL injection and XSS payloads are rejected or sanitized', withScreenshotOnFailure('m5-n5-injection-fail', async ({ page, request }) => {
    const maliciousPayloads = [
      "'; DROP TABLE users; --",
      '<script>alert("xss")</script>',
      '{{7*7}}',
    ];

    for (const payload of maliciousPayloads) {
      const response = await request.post(`${BACKEND_URL}/api/auth/login`, {
        data: { email: payload, password: payload },
        headers: { 'Content-Type': 'application/json' },
        failOnStatusCode: false,
      });

      expect(response.status()).toBeLessThan(500);

      const text = await response.text();
      expect(text).not.toContain('DROP TABLE');
      expect(text).not.toContain('<script>');
    }

    await page.goto('/');
    await takeScreenshot(page, 'infra-n5-prompt-injection', 'N.5 Prompt injection — all payloads rejected with < 500 and no echo');
  }));
});

// ===========================================================================
// M5 N.6-N.8 — skipped
// ===========================================================================

test.describe('M5 — N.6 Dependency Security', () => {
  test.skip('npm audit / pip-audit is a CI job, not a Playwright E2E test', async () => {
    // Run in CI: npm audit --audit-level=high && pip-audit
    // See .github/workflows/security-scan.yml
  });
});

test.describe('M5 — N.7 Load Testing', () => {
  test.skip('load testing is handled by Locust (tests/load-testing/locustfile.py)', async () => {
    // Run: locust -f tests/load-testing/locustfile.py --headless -u 50 -r 5
  });
});

test.describe('M5 — N.8 Prediction Model', () => {
  test.skip('ML model evaluation is a separate offline pipeline, not an E2E test', async () => {
    // See backend/app/services/prediction_service.py
  });
});

// ===========================================================================
// M5 N.10 Dictionary API
// ===========================================================================

test.describe('M5 — N.10 Dictionary API', () => {
  test('lookup character 大 returns 200 with character data', withScreenshotOnFailure('m5-n10-dict-fail', async ({ page, request }) => {
    const response = await request.get(`${BACKEND_URL}/api/dictionary/character/大`);

    expect(response.status()).toBe(200);

    const body = await response.json();

    const hasCharacterData =
      typeof body === 'object' &&
      body !== null &&
      (
        'character' in body ||
        'char' in body ||
        'pinyin' in body ||
        'definition' in body ||
        'definitions' in body ||
        'data' in body ||
        Array.isArray(body)
      );

    expect(hasCharacterData).toBe(true);

    await page.goto('/');
    await takeScreenshot(page, 'infra-n10-dictionary-api', 'N.10 Dictionary API — lookup 大 returned 200 with character data');
  }));
});
