import type { OrgListAnalysisOk } from "./orgListRow";

const cache = new Map<string, OrgListAnalysisOk>();

function norm(org: string): string {
  return org.trim().toLowerCase();
}

/** Successful org-list analysis only (errors are never cached). */
export function getOrgListAnalysisCached(org: string): OrgListAnalysisOk | undefined {
  return cache.get(norm(org));
}

export function hasOrgListAnalysisCacheEntry(org: string): boolean {
  return cache.has(norm(org));
}

export function setOrgListAnalysisCached(org: string, result: OrgListAnalysisOk): void {
  cache.set(norm(org), result);
}

/** Cleared on org list Refresh / Retry (full list) and sign-out. */
export function clearOrgListAnalysisCache(): void {
  cache.clear();
}

/** Cleared when the per-row Retry button runs after a failed analysis. */
export function invalidateOrgListAnalysisCacheEntry(org: string): void {
  cache.delete(norm(org));
}
