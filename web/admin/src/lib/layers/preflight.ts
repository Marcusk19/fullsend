import type { Octokit } from "@octokit/rest";

/**
 * Mirrors `PreflightResult` from `internal/layers/preflight.go`.
 */
export type PreflightResult = {
  required: string[];
  granted: string[] | null;
  missing: string[];
  skipped: boolean;
};

export function parseXOauthScopesHeader(header: string | undefined): string[] | null {
  if (header === undefined || header.trim() === "") {
    return null;
  }
  return header
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Compare required OAuth scopes to granted list.
 * When `granted` is null (no `X-OAuth-Scopes`, e.g. GitHub App user-to-server tokens),
 * returns `skipped: true` per Go `Stack.Preflight`. The org list then uses
 * `installReadinessProbes.ts` instead of assuming classic scopes exist.
 */
export function computePreflight(required: string[], granted: string[] | null): PreflightResult {
  if (required.length === 0) {
    return { required: [], granted: granted ?? null, missing: [], skipped: false };
  }
  if (granted === null) {
    return { required, granted: null, missing: [], skipped: true };
  }
  const grantedSet = new Set(granted);
  const missing = required.filter((scope) => !grantedSet.has(scope));
  return { required, granted, missing, skipped: false };
}

export function preflightOk(result: PreflightResult): boolean {
  return result.skipped || result.missing.length === 0;
}

/** Reads `X-OAuth-Scopes` from `HEAD /user` (classic OAuth / PAT only). */
export async function readTokenScopesHeader(octokit: Octokit): Promise<string[] | null> {
  const { headers } = await octokit.request("HEAD /user");
  const raw = headers["x-oauth-scopes"] as string | string[] | undefined;
  let joined: string | undefined;
  if (typeof raw === "string") {
    joined = raw;
  } else if (Array.isArray(raw)) {
    joined = raw.join(",");
  }
  return parseXOauthScopesHeader(joined);
}

let scopeHeaderCacheToken: string | null = null;
/** `undefined` means unset; `null` is a valid cached “no scopes header” result. */
let scopeHeaderCacheResult: string[] | null | undefined;

/** Cleared on sign-out so the next session always re-reads headers. */
export function clearOAuthScopeHeaderCache(): void {
  scopeHeaderCacheToken = null;
  scopeHeaderCacheResult = undefined;
}

/**
 * Same as {@link readTokenScopesHeader}, but at most **one** `HEAD /user` per stored
 * access token for the SPA lifetime (until {@link clearOAuthScopeHeaderCache}).
 * Org list re-runs preflight whenever `displayedOrgs` changes; without this, each run
 * would hit GitHub’s `/user` quota again.
 */
export async function readTokenScopesHeaderCached(
  octokit: Octokit,
  accessToken: string,
): Promise<string[] | null> {
  if (!accessToken) {
    return readTokenScopesHeader(octokit);
  }
  if (scopeHeaderCacheToken === accessToken && scopeHeaderCacheResult !== undefined) {
    return scopeHeaderCacheResult;
  }
  const result = await readTokenScopesHeader(octokit);
  scopeHeaderCacheToken = accessToken;
  scopeHeaderCacheResult = result;
  return result;
}
