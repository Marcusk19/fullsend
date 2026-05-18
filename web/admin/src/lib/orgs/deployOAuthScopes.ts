/**
 * Classic OAuth scopes required for `fullsend admin install` (Go `Stack.CollectRequiredScopes(OpInstall)`).
 * Used in the admin SPA only when GitHub returns `X-OAuth-Scopes` on `HEAD /user`.
 * GitHub App user tokens usually omit that header — use read-only API probes instead
 * (`installReadinessProbes.ts`).
 * @see internal/layers/configrepo.go, workflows.go, secrets.go, enrollment.go, dispatch.go — RequiredScopes(OpInstall)
 */
export function deployRequiredOAuthScopes(): readonly string[] {
  return ["repo", "workflow", "admin:org"] as const;
}
