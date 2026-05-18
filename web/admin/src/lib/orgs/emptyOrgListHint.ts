/**
 * Copy when the org picker is empty after listing **GitHub App installations**
 * (`GET /user/installations`).
 */

/**
 * Shown when the installations API returned **200** and there are **no** organisation
 * installations in the aggregated result (success-empty, not an error).
 */
export function buildEmptyInstallationsHint(): string {
  return (
    "No GitHub organisations in this list have the Fullsend app installed for your account yet. " +
    "Use “Add the app…” below to install it on the organisations you administer."
  );
}
