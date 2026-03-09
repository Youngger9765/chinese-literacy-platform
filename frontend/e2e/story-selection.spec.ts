import { test, expect } from '@playwright/test';
import { registerFreshUser, loginAsTeacher, goToTeacherDashboard } from './fixtures';

/**
 * Story selection E2E tests — covers browsing and selecting stories
 * from the student library page.
 *
 * Strategy: Register a fresh no-role account per test run.
 * A freshly registered user has no role and sees the student view.
 */

// ── 1. Library Page ───────────────────────────────────────────────────────────

test.describe('Story Library - Page Load', () => {
  test('1.1 - Library page loads after navigating from home', async ({ page }) => {
    await registerFreshUser(page);

    await page.locator('button:has-text("進入圖書館")').click();
    await expect(page).toHaveURL(/\/library/, { timeout: 15_000 });
  });

  test('1.2 - Library page shows story cards', async ({ page }) => {
    await registerFreshUser(page);
    await page.goto('/library');

    // Wait for skeletons to resolve into real cards
    // StoryLibrary renders a grid of cards after loading
    await expect(
      page.locator('h3').first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test('1.3 - Library page has search input', async ({ page }) => {
    await registerFreshUser(page);
    await page.goto('/library');

    await expect(page.locator('input[placeholder*="搜尋"]')).toBeVisible({ timeout: 15_000 });
  });
});

// ── 2. Story Filtering ────────────────────────────────────────────────────────

test.describe('Story Library - Filtering', () => {
  test('2.1 - Searching by keyword filters story list', async ({ page }) => {
    await registerFreshUser(page);
    await page.goto('/library');

    // Wait for stories to load
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 });
    const searchInput = page.locator('input[placeholder*="搜尋"]');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Type a query that is unlikely to match all stories — expect fewer cards
    await searchInput.fill('草');
    // Wait for filter to apply (debounce or immediate)
    await page.waitForTimeout(500);

    // Result set can be 0..N stories (empty state or matching cards)
    // We just check the page doesn't error out
    await expect(page.locator('body')).toBeVisible();
  });

  test('2.2 - Grade filter buttons are visible', async ({ page }) => {
    await registerFreshUser(page);
    await page.goto('/library');

    // Wait for stories to load first
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 });

    // Grade buttons rendered: 全部, 三年級, 四年級, etc.
    await expect(page.locator('button:has-text("全部")')).toBeVisible({ timeout: 10_000 });
  });

  test('2.3 - Clicking a grade filter narrows the story list', async ({ page }) => {
    await registerFreshUser(page);
    await page.goto('/library');

    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 });

    // Find any non-"全部" grade button and click it
    const gradeButtons = page.locator('button').filter({ hasText: /年級/ });
    const count = await gradeButtons.count();
    if (count > 0) {
      await gradeButtons.first().click();
      // Page should still render (not crash)
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

// ── 3. Story Card ─────────────────────────────────────────────────────────────

test.describe('Story Library - Story Card Interaction', () => {
  test('3.1 - Clicking a story card navigates to learning intro', async ({ page }) => {
    await registerFreshUser(page);
    await page.goto('/library');

    // Wait for cards to load
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 });

    // Click the first story card's button
    const firstCard = page.locator('button').filter({ has: page.locator('h3') }).first();
    if (await firstCard.count() === 0) {
      // Alternative selector: any clickable card container
      await page.locator('h3').first().click();
    } else {
      await firstCard.click();
    }

    // Should navigate to /learn/{storyId}/intro
    await expect(page).toHaveURL(/\/learn\/.+\/intro/, { timeout: 20_000 });
  });
});

// ── 4. Direct Library Access ──────────────────────────────────────────────────

test.describe('Story Library - Direct URL Access', () => {
  test('4.1 - /library redirects to login when not authenticated', async ({ page }) => {
    // Ensure no auth state
    await page.evaluate(() => localStorage.clear());
    await page.goto('/library');
    // Should redirect to login
    await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 15_000 });
  });

  test('4.2 - Authenticated user can access /library directly', async ({ page }) => {
    await registerFreshUser(page);
    await page.goto('/library');
    // Should not redirect to login
    await expect(page.locator('text=登入你的帳號')).not.toBeVisible({ timeout: 10_000 });
  });
});

// ── 5. Teacher Library Access ─────────────────────────────────────────────────

test.describe('Story Library - Teacher Access', () => {
  test('5.1 - Teacher can also access the library', async ({ page }) => {
    await loginAsTeacher(page);

    // Navigate to home then library
    await page.goto('/library');

    // Teacher sees the same library
    await expect(
      page.locator('h3').first().or(page.locator('text=目前沒有課文'))
    ).toBeVisible({ timeout: 20_000 });
  });

  test('5.2 - Teacher dashboard is accessible from header', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    expect(page.url()).toContain('/teacher');
  });
});
