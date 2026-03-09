import { test, expect } from '@playwright/test';
import { registerFreshUser, loginAsTeacher } from './fixtures';

/**
 * Learning flow E2E tests — covers the 6-step learning journey.
 *
 * These tests validate basic navigation and page rendering for each step.
 * They do NOT test AI/audio features (Speech API, Vertex AI) as those
 * require hardware and live API access.
 *
 * Strategy:
 *  - Register a fresh user, navigate to library, pick the first story,
 *    then walk through steps checking key UI elements.
 *  - Tests use the real preview backend via baseURL from playwright.config.ts.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Register a fresh user, navigate to library, click the first story,
 * and wait until the intro page loads.
 * Returns the storyId from the URL (e.g. "chuan-ji-yu-zhi-1").
 */
async function loginAndOpenFirstStory(page: import('@playwright/test').Page): Promise<string> {
  await registerFreshUser(page);
  await page.goto('/library');

  // Wait for story cards to load
  await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 });

  // Click first available story card
  const firstCard = page.locator('button').filter({ has: page.locator('h3') }).first();
  const hasCardButton = (await firstCard.count()) > 0;

  if (hasCardButton) {
    await firstCard.click();
  } else {
    // Fallback: click the first h3 element (story title)
    await page.locator('h3').first().click();
  }

  // Wait for intro page to load
  await expect(page).toHaveURL(/\/learn\/.+\/intro/, { timeout: 20_000 });

  // Extract storyId from URL
  const url = page.url();
  const match = url.match(/\/learn\/([^/]+)\/intro/);
  return match?.[1] ?? '';
}

// ── 1. Intro Page ─────────────────────────────────────────────────────────────

test.describe('Learning Flow - Step 1: Intro', () => {
  test('1.1 - Intro page loads after selecting a story', async ({ page }) => {
    await loginAndOpenFirstStory(page);
    // Intro component renders the story title
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
  });

  test('1.2 - Intro page has a back-to-library button', async ({ page }) => {
    await loginAndOpenFirstStory(page);
    await expect(
      page.locator('button:has-text("返回")').or(page.locator('button:has-text("圖書館")'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('1.3 - Intro page has a start reading button', async ({ page }) => {
    await loginAndOpenFirstStory(page);
    // The Intro component renders a 開始朗讀 button to proceed
    await expect(
      page.locator('button:has-text("開始")').or(page.locator('button:has-text("朗讀")'))
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ── 2. Stepper Navigation ─────────────────────────────────────────────────────

test.describe('Learning Flow - Stepper Navigation', () => {
  test('2.1 - Stepper is visible during learning steps', async ({ page }) => {
    await loginAndOpenFirstStory(page);
    // StepperNav is rendered in the header — it shows step indicators
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });
  });

  test('2.2 - Direct URL access to intro step works', async ({ page }) => {
    await registerFreshUser(page);

    // Get first story ID by going to library first
    await page.goto('/library');
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 });

    const firstCard = page.locator('button').filter({ has: page.locator('h3') }).first();
    const hasCardButton = (await firstCard.count()) > 0;

    if (hasCardButton) {
      await firstCard.click();
    } else {
      await page.locator('h3').first().click();
    }

    await expect(page).toHaveURL(/\/learn\/.+\/intro/, { timeout: 20_000 });
    const url = page.url();
    const match = url.match(/\/learn\/([^/]+)\/intro/);
    const storyId = match?.[1] ?? '';

    if (storyId) {
      // Navigate directly to intro URL
      await page.goto(`/learn/${storyId}/intro`);
      await expect(page).toHaveURL(`/learn/${storyId}/intro`);
      await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    }
  });
});

// ── 3. Step URL Structure ─────────────────────────────────────────────────────

test.describe('Learning Flow - URL Structure', () => {
  test('3.1 - /learn/:storyId redirects to /learn/:storyId/intro', async ({ page }) => {
    await registerFreshUser(page);
    await page.goto('/library');
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 });

    const firstCard = page.locator('button').filter({ has: page.locator('h3') }).first();
    if ((await firstCard.count()) > 0) {
      await firstCard.click();
    } else {
      await page.locator('h3').first().click();
    }

    await expect(page).toHaveURL(/\/learn\/.+\/intro/, { timeout: 20_000 });
    const url = page.url();
    const match = url.match(/\/learn\/([^/]+)\/intro/);
    const storyId = match?.[1] ?? '';

    if (storyId) {
      // Navigate to base story URL (no step)
      await page.goto(`/learn/${storyId}`);
      // Should redirect to /intro
      await expect(page).toHaveURL(`/learn/${storyId}/intro`, { timeout: 15_000 });
    }
  });
});

// ── 4. Unauthenticated Access ─────────────────────────────────────────────────

test.describe('Learning Flow - Auth Guard', () => {
  test('4.1 - Unauthenticated user is redirected from learning page', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto('/learn/test-story/intro');
    // Should redirect to login
    await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 15_000 });
  });
});

// ── 5. Teacher Learning Access ────────────────────────────────────────────────

test.describe('Learning Flow - Teacher Access', () => {
  test('5.1 - Teacher can also browse stories in the library', async ({ page }) => {
    await loginAsTeacher(page);
    await page.goto('/library');
    await expect(
      page.locator('h3').first().or(page.locator('text=目前沒有課文'))
    ).toBeVisible({ timeout: 20_000 });
  });
});
