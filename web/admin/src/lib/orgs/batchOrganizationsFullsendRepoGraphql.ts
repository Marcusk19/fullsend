import type { Octokit } from "@octokit/rest";

const REPO = ".fullsend";
/** Keep each GraphQL document small to avoid complexity limits. */
const CHUNK = 10;

/**
 * Escapes `"` and `\` for use inside GraphQL double-quoted strings.
 * Safe only with inputs already constrained (e.g. org logins validated with
 * `/^[a-zA-Z0-9-]+$/` before interpolation); not a general-purpose GraphQL
 * literal encoder (control characters are not escaped).
 */
function escapeGraphqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * One GraphQL round-trip per chunk: for each org, whether `owner/.fullsend` exists.
 * Returns `null` for an org when the hint is unknown (GraphQL error, org field null, etc.).
 */
export async function batchOrganizationsFullsendRepoExists(
  octokit: Octokit,
  logins: readonly string[],
): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  for (const raw of logins) {
    out.set(raw.trim().toLowerCase(), null);
  }

  for (let start = 0; start < logins.length; start += CHUNK) {
    const chunk = logins.slice(start, start + CHUNK);
    const parts: string[] = [];
    const aliasKeys: string[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const login = chunk[i]!.trim();
      const key = login.toLowerCase();
      if (!/^[a-zA-Z0-9-]+$/.test(login)) {
        continue;
      }
      const alias = `o${parts.length}`;
      aliasKeys.push(key);
      const escLogin = escapeGraphqlString(login);
      const escRepo = escapeGraphqlString(REPO);
      parts.push(
        `${alias}: organization(login: "${escLogin}") { repository(name: "${escRepo}") { id } }`,
      );
    }
    if (parts.length === 0) {
      continue;
    }
    const query = `query BatchFullsendRepo {\n${parts.join("\n")}\n}`;
    try {
      const res = await octokit.request("POST /graphql", { query });
      const body = res.data as {
        data?: Record<string, { repository: { id: string } | null } | null> | null;
        errors?: { message: string }[];
      };
      if (body.errors?.length) {
        continue;
      }
      const gqlData = body.data;
      if (!gqlData) {
        continue;
      }
      for (let j = 0; j < parts.length; j++) {
        const alias = `o${j}`;
        const key = aliasKeys[j]!;
        const node = gqlData[alias];
        if (node === undefined) {
          continue;
        }
        if (node === null) {
          out.set(key, null);
          continue;
        }
        out.set(key, node.repository != null);
      }
    } catch {
      /* leave null for this chunk */
    }
  }

  return out;
}
