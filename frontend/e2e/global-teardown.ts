/**
 * Global teardown — clean up E2E test artifacts from the staging database.
 *
 * Deletes organizations whose name starts with "e2e-" via the admin API.
 * Runs after all test suites complete.
 */

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.E2E_BASE_URL ||
  'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';

const API_URL = BASE_URL.replace('frontend', 'backend');

async function globalTeardown() {
  console.log('[teardown] Cleaning up E2E test organizations...');

  try {
    const loginRes = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.com', password: 'admin1234' }),
    });
    if (!loginRes.ok) {
      console.warn('[teardown] Admin login failed, skipping cleanup');
      return;
    }
    const { access_token } = await loginRes.json();

    const orgsRes = await fetch(`${API_URL}/api/organizations`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!orgsRes.ok) {
      console.warn('[teardown] Failed to list organizations');
      return;
    }
    const { items } = await orgsRes.json();
    const e2eOrgs = items.filter((o: { name: string }) => o.name.startsWith('e2e-'));

    if (e2eOrgs.length === 0) {
      console.log('[teardown] No E2E organizations to clean up');
      return;
    }

    let deleted = 0;
    for (const org of e2eOrgs) {
      const res = await fetch(`${API_URL}/api/organizations/${org.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (res.status === 204) {
        deleted++;
      } else {
        console.warn(`[teardown] Failed to delete org ${org.name}: ${res.status}`);
      }
    }
    console.log(`[teardown] Deleted ${deleted}/${e2eOrgs.length} E2E organizations`);
  } catch (err) {
    console.warn('[teardown] Cleanup error (non-fatal):', err);
  }
}

export default globalTeardown;
