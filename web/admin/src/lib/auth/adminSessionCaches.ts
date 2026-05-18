import { clearOrgListMemoryCache } from "../orgs/fetchOrgs";
import { clearOrgListAnalysisCache } from "../orgs/orgListAnalysisCache";
import { clearSession } from "./tokenStore";

/**
 * Clears persisted OAuth/session data and all in-memory org-list caches.
 * Use from {@link signOut}; add new user-scoped admin caches here so sign-out
 * stays a single contract.
 */
export function clearAllAdminSessionCaches(): void {
  clearSession();
  clearOrgListMemoryCache();
  clearOrgListAnalysisCache();
}
