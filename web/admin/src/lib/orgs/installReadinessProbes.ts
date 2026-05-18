import type { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import type { PreflightResult } from "../layers/preflight";
import {
  orgListRowFromAnalysis,
  type GitHubAppInstallReadiness,
  type OrgListAnalysisErr,
  type OrgListAnalysisOk,
  type OrgListRowCluster,
} from "./orgListRow";

const probeCache = new Map<string, GitHubAppInstallReadiness>();

/** Cleared on sign-out so the next account does not reuse another user’s probe results. */
export function clearInstallReadinessProbeCache(): void {
  probeCache.clear();
}

function cacheKey(githubLogin: string, org: string): string {
  return `${githubLogin.trim().toLowerCase()}\0${org.trim().toLowerCase()}`;
}

function isForbidden(err: unknown): boolean {
  return err instanceof RequestError && err.status === 403;
}

/**
 * Read-only checks for GitHub App user access tokens (and other tokens) that do not
 * populate `X-OAuth-Scopes`. Probes mirror the practical needs of `fullsend admin install`:
 * org repository visibility, Actions workflows, and org-level Actions secrets.
 *
 * @see internal/layers/preflight.go — when `GetTokenScopes` is nil, Go skips scope comparison
 * and proceeds; the SPA uses these probes instead of assuming classic OAuth scopes exist.
 */
export async function probeGitHubAppInstallReadiness(
  octokit: Octokit,
  org: string,
  options?: { signal?: AbortSignal },
): Promise<GitHubAppInstallReadiness> {
  const missing: string[] = [];
  const signal = options?.signal;
  const request = signal ? { signal } : undefined;

  let firstRepo: string | null = null;
  try {
    const { data } = await octokit.rest.repos.listForOrg({
      org,
      per_page: 1,
      type: "all",
      request,
    });
    if (data[0]?.name) {
      firstRepo = data[0].name;
    }
  } catch (e) {
    if (isForbidden(e)) {
      missing.push("View and manage repositories in this organisation");
      return { ok: false, missing };
    }
    throw e;
  }

  if (firstRepo) {
    try {
      await octokit.rest.actions.listRepoWorkflows({
        owner: org,
        repo: firstRepo,
        per_page: 1,
        request,
      });
    } catch (e) {
      if (isForbidden(e)) {
        missing.push("Use GitHub Actions on repositories in this organisation");
        return { ok: false, missing };
      }
      throw e;
    }
  }

  try {
    await octokit.request("GET /orgs/{org}/actions/secrets/public-key", {
      org,
      request,
    });
  } catch (e) {
    if (isForbidden(e)) {
      missing.push("Organisation-level GitHub Actions secrets");
      return { ok: false, missing };
    }
    throw e;
  }

  return { ok: true, missing: [] };
}

export async function probeGitHubAppInstallReadinessCached(
  octokit: Octokit,
  githubLogin: string,
  org: string,
  options?: { signal?: AbortSignal },
): Promise<GitHubAppInstallReadiness> {
  const key = cacheKey(githubLogin, org);
  const hit = probeCache.get(key);
  if (hit) {
    return hit;
  }
  const result = await probeGitHubAppInstallReadiness(octokit, org, options);
  probeCache.set(key, result);
  return result;
}

/**
 * Resolves org-list Deploy / Cannot deploy / Configure using classic scope preflight when
 * `X-OAuth-Scopes` is present, otherwise GitHub App install probes for `not_installed` rows.
 */
export async function resolveOrgListDeployRowCluster(
  result: OrgListAnalysisOk | OrgListAnalysisErr,
  deployPreflight: PreflightResult,
  octokit: Octokit,
  githubUserLogin: string,
  orgLogin: string,
  options?: { signal?: AbortSignal },
): Promise<OrgListRowCluster> {
  let githubAppReadiness: GitHubAppInstallReadiness | null = null;
  if (deployPreflight.skipped && result.kind === "ok") {
    const configReport = result.reports.find((r) => r.name === "config-repo");
    if (configReport?.status === "not_installed") {
      githubAppReadiness = await probeGitHubAppInstallReadinessCached(
        octokit,
        githubUserLogin,
        orgLogin,
        options,
      );
    }
  }
  return orgListRowFromAnalysis(result, deployPreflight, githubAppReadiness);
}
