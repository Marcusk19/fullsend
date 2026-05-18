export type OrgRow = {
  login: string;
};

/**
 * Case-insensitive substring search over org logins, then alphabetical sort.
 */
export function filterOrgsBySearch(orgs: OrgRow[], q: string): OrgRow[] {
  const p = q.trim().toLowerCase();
  const sorted = [...orgs].sort((a, b) => a.login.localeCompare(b.login));
  if (!p) return sorted;
  return sorted.filter((o) => o.login.toLowerCase().includes(p));
}
