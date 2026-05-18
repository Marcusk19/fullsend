import { normalizeSlug } from "../orgs/installationOrgRows";

export function githubAppInstallationsNewUrl(slug: string): string | null {
  const s = normalizeSlug(slug);
  if (s == null) return null;
  return `https://github.com/apps/${encodeURIComponent(s)}/installations/new`;
}
