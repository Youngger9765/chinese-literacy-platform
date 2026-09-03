/**
 * sloParticipants.ts — Single Logout (SLO) participant allowlist.
 *
 * Junyi Academy drives a sequential top-level 302 redirect chain on logout so
 * each RP clears its own session (doc/THIRD_PARTY_SSO.md §6.2). The `continue`
 * query param passed to our SLO logout route (JunyiSloLogoutPage) is precomputed
 * by Junyi to point at the NEXT station in that chain.
 *
 * We honor `continue` only when it targets a known SLO participant over HTTPS —
 * this is the open-redirect protection. Matching is anchored: an exact host, or
 * a properly dot-anchored parent-domain suffix. Never a substring match, so
 * `eviljutor.ai` or `jutor.ai.evil.com` are rejected.
 */

/** Exact hostnames allowed as an SLO `continue` target. */
const ALLOWED_HOSTS: Record<string, true> = {
  // Junyi
  'www.junyiacademy.org': true,
  // LingoLeap — this RP's own hosts
  'lingoleap-prod.web.app': true,
  'lingoleap-staging.web.app': true,
  'lingoleap-dev.web.app': true,
  // shareclass
  'www.shareclass.org': true,
  'test.shareclass.org': true,
  // ActiveAI
  'app.active-ai.io': true,
  'staging.app.active-ai.io': true,
  'testing.app.active-ai.io': true,
  'testing.gcp.active-ai.io': true,
  'gcp.active-ai.io': true,
};

/**
 * Parent domains whose subdomains are allowed. Matched with a dot-anchored
 * suffix so only genuine subdomains qualify (e.g. `foo.jutor.ai`), never a
 * lookalike registrable domain.
 */
const ALLOWED_DOMAIN_SUFFIXES: readonly string[] = [
  '.junyiacademy.org', // Junyi: *.junyiacademy.org
  '.jutor.ai', //         jutor: *.jutor.ai
];

/**
 * Returns true iff `rawUrl` is an absolute HTTPS URL whose host is an allowed
 * SLO participant. Used to validate the `continue` param before redirecting.
 */
export function isAllowedSloContinue(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  if (ALLOWED_HOSTS[host]) return true;
  return ALLOWED_DOMAIN_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
