# Admin org list from GitHub App installations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace repo-inferred org listing with **`GET /user/installations`** (Octokit `octokit.rest.apps.listInstallationsForAuthenticatedUser`), add install guidance + OAuth **`state`** slug fallback, **manual Refresh** after GitHub install (no session flag / auto-refresh), pagination-cap warning when the safety page limit is hit, and accurate error/empty copy — per [`2026-04-29-admin-spa-org-list-installations-design.md`](../specs/2026-04-29-admin-spa-org-list-installations-design.md).

**Architecture:** Browser-only GitHub API calls using the existing user Octokit factory (`web/admin/src/lib/github/client.ts`). Map each installation with `account.type === "Organization"` to `OrgRow`. Resolve install URL slug from the **first installation payload** that exposes `app_slug` / nested `app.slug`, else from **`localStorage`** populated from Worker OAuth `state`. No Worker org-list proxy unless CORS is proven broken (contingency only).

**Tech Stack:** TypeScript, Svelte 5, Vitest, Octokit REST, Cloudflare Worker (OAuth `state` only for slug fallback).

---

## File map (create / modify)

| File | Responsibility |
|------|------------------|
| `web/admin/src/lib/orgs/installationOrgRows.ts` | Map GitHub installation REST items → `OrgRow[]`, dedupe by login, extract optional app slug string safely. |
| `web/admin/src/lib/orgs/installationOrgRows.test.ts` | Fixtures: org installs, user install filtered out, duplicate org, slug from `app_slug` vs `app.slug`. |
| `web/admin/src/lib/orgs/fetchOrgs.ts` | Paginate `listInstallationsForAuthenticatedUser`; progress meta = installation pages; memory cache; `installationListTruncated` when page cap hit; `FetchOrgsError` messages for 403 vs transient. |
| `web/admin/src/lib/orgs/fetchOrgs.test.ts` | Mock iterator; empty list; 403; slug propagation; truncation when page cap exceeded. |
| `web/admin/src/lib/orgs/emptyOrgListHint.ts` | Replace repo-based empty hints with **installations**-specific copy (or delete unused helpers; keep `headersToRecord` only if still needed — if unused, remove). |
| `web/admin/src/lib/orgs/emptyOrgListHint.test.ts` | Update or replace tests for new empty-hint builder. |
| `web/admin/src/lib/github/githubAppInstallLink.ts` | Build `https://github.com/apps/<slug>/installations/new`; validate slug; return `null` if unusable. |
| `web/admin/src/lib/github/githubAppInstallLink.test.ts` | Slug validation + URL shape. |
| `web/admin/src/lib/auth/tokenStore.ts` | `persistGithubAppSlugFromOAuth` / `loadGithubAppSlug`; `clearSession` clears slug key. |
| `web/admin/src/lib/auth/oauth.ts` | Extend Worker-expanded `state` JSON with optional `g` (slug); `tryParseWorkerExpandedOauthState`; call `persistGithubAppSlugFromOAuth` after successful token save. |
| `web/admin/src/lib/auth/oauth.test.ts` | Parser + persistence tests for `g`. |
| `cloudflare_site/worker/src/index.ts` | `GITHUB_APP_SLUG` env; `buildGithubState` includes `g` when set. |
| `cloudflare_site/worker/src/index.worker.test.ts` | Assert authorize redirect `state` decodes to JSON containing `g` when env set. |
| `web/admin/src/routes/OrgList.svelte` | Empty-region copy order; always-on install block; red warning when `installationListTruncated`; pass resolved slug into install link. |
| `sample.env.local` | Document optional `GITHUB_APP_SLUG` for Worker. |
| `web/admin/README.md` | One paragraph: slug via installations response or OAuth `state`; optional `GITHUB_APP_SLUG` in Worker env. |

---

### Task 1: Installation → org row mapping (TDD)

**Files:**

- Create: `web/admin/src/lib/orgs/installationOrgRows.ts`
- Create: `web/admin/src/lib/orgs/installationOrgRows.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// web/admin/src/lib/orgs/installationOrgRows.test.ts
import { describe, expect, it } from "vitest";
import { orgRowsAndSlugFromInstallations } from "./installationOrgRows";

describe("orgRowsAndSlugFromInstallations", () => {
  it("keeps Organization accounts and sorts by login", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      {
        id: 2,
        app_slug: "fullsend-dev",
        account: { login: "zebra", type: "Organization" },
      },
      {
        id: 1,
        app_slug: "fullsend-dev",
        account: { login: "alpha", type: "Organization" },
      },
    ]);
    expect(orgs.map((o) => o.login)).toEqual(["alpha", "zebra"]);
    expect(appSlug).toBe("fullsend-dev");
  });

  it("drops User installations", () => {
    const { orgs } = orgRowsAndSlugFromInstallations([
      { id: 1, account: { login: "alice", type: "User" } },
    ]);
    expect(orgs).toEqual([]);
  });

  it("dedupes same org from multiple installation records", () => {
    const { orgs } = orgRowsAndSlugFromInstallations([
      { id: 1, account: { login: "acme", type: "Organization" } },
      { id: 2, account: { login: "acme", type: "Organization" } },
    ]);
    expect(orgs).toEqual([{ login: "acme" }]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -- --run web/admin/src/lib/orgs/installationOrgRows.test.ts`
Expected: FAIL (module or export missing).

- [ ] **Step 3: Implement**

```typescript
// web/admin/src/lib/orgs/installationOrgRows.ts
import type { OrgRow } from "./filter";

type MinimalInstallation = {
  id?: number;
  app_slug?: string | null;
  app?: { slug?: string | null } | null;
  account?: { login?: string | null; type?: string | null } | null;
};

const SLUG_RE = /^[a-zA-Z0-9-]{1,99}$/;

function normalizeSlug(raw: string | null | undefined): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || !SLUG_RE.test(s)) return null;
  return s;
}

function slugFromInstallation(inst: MinimalInstallation): string | null {
  const flat = normalizeSlug(inst.app_slug ?? undefined);
  if (flat) return flat;
  const nested = inst.app?.slug;
  return normalizeSlug(nested ?? undefined);
}

/**
 * Maps GitHub `GET /user/installations` items to org picker rows (organizations only).
 * Returns the first non-empty safe `app_slug` / `app.slug` seen for install URL building.
 */
export function orgRowsAndSlugFromInstallations(
  installations: MinimalInstallation[],
): { orgs: OrgRow[]; appSlug: string | null } {
  const byKey = new Map<string, string>();
  let appSlug: string | null = null;

  for (const inst of installations) {
    const slug = slugFromInstallation(inst);
    if (slug && !appSlug) appSlug = slug;

    const acc = inst.account;
    if (!acc || acc.type !== "Organization") continue;
    const login = typeof acc.login === "string" ? acc.login.trim() : "";
    if (!login) continue;
    byKey.set(login.toLowerCase(), login);
  }

  const orgs = [...byKey.values()].sort((a, b) => a.localeCompare(b)).map((login) => ({ login }));
  return { orgs, appSlug };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -- --run web/admin/src/lib/orgs/installationOrgRows.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/admin/src/lib/orgs/installationOrgRows.ts web/admin/src/lib/orgs/installationOrgRows.test.ts
git commit -m "feat(admin): map GitHub app installations to org rows"
```

---

### Task 2: GitHub App install URL helper (TDD)

**Files:**

- Create: `web/admin/src/lib/github/githubAppInstallLink.ts`
- Create: `web/admin/src/lib/github/githubAppInstallLink.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// web/admin/src/lib/github/githubAppInstallLink.test.ts
import { describe, expect, it } from "vitest";
import { githubAppInstallationsNewUrl } from "./githubAppInstallLink";

describe("githubAppInstallationsNewUrl", () => {
  it("returns encoded GitHub URL for a valid slug", () => {
    expect(githubAppInstallationsNewUrl("my-app")).toBe(
      "https://github.com/apps/my-app/installations/new",
    );
  });

  it("returns null for invalid slug", () => {
    expect(githubAppInstallationsNewUrl("bad/slug")).toBeNull();
    expect(githubAppInstallationsNewUrl("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npm run test -- --run web/admin/src/lib/github/githubAppInstallLink.test.ts`

- [ ] **Step 3: Implement**

```typescript
// web/admin/src/lib/github/githubAppInstallLink.ts
const SLUG_RE = /^[a-zA-Z0-9-]{1,99}$/;

export function githubAppInstallationsNewUrl(slug: string): string | null {
  const s = slug.trim();
  if (!SLUG_RE.test(s)) return null;
  return `https://github.com/apps/${encodeURIComponent(s)}/installations/new`;
}
```

- [ ] **Step 4: Run — PASS**

Run: `npm run test -- --run web/admin/src/lib/github/githubAppInstallLink.test.ts`

- [ ] **Step 5: Commit**

```bash
git add web/admin/src/lib/github/githubAppInstallLink.ts web/admin/src/lib/github/githubAppInstallLink.test.ts
git commit -m "feat(admin): validate slug for GitHub app install URL"
```

---

### Task 3: (removed) Post-install session flag

**Superseded:** Users return from GitHub manually and use **Refresh** on the org list. No `sessionStorage` flag or automatic forced reload on route load.

---

### Task 4: Replace `fetchOrgs` with installations pagination

**Files:**

- Modify: `web/admin/src/lib/orgs/fetchOrgs.ts`
- Modify: `web/admin/src/lib/orgs/fetchOrgs.test.ts`
- Modify: `web/admin/src/lib/orgs/emptyOrgListHint.ts`
- Modify: `web/admin/src/lib/orgs/emptyOrgListHint.test.ts`

**Contract changes:**

- `FetchOrgsResult` becomes `{ orgs: OrgRow[]; emptyHint: string | null; appSlugFromApi: string | null; installationListTruncated: boolean }`.
- `FetchOrgsProgressMeta`: rename `repoPagesFetched` → `installationPagesFetched` (update `OrgList.svelte` references if any).

- [ ] **Step 1: Rewrite `fetchOrgs.test.ts`** to mock:

```typescript
octokit.paginate.iterator(octokit.rest.apps.listInstallationsForAuthenticatedUser, { per_page: ... })
```

Yield pages with `data: { installations: [...] }` per GitHub response shape (`installations` array on each page). Assert: sorted orgs, `appSlugFromApi`, empty list + `emptyHint` text mentions **install** / **no organisations have this app**, not repos.

- [ ] **Step 2: Run tests — FAIL**

Run: `npm run test -- --run web/admin/src/lib/orgs/fetchOrgs.test.ts`

- [ ] **Step 3: Implement `fetchOrgs.ts`**

- Use `INSTALLATIONS_PER_PAGE` (e.g. 30) and `MAX_INSTALLATION_LIST_PAGES` (e.g. 20).
- Inside iterator loop: `const list = Array.isArray(page.data.installations) ? page.data.installations : [];` then `orgRowsAndSlugFromInstallations` **cumulatively** (re-scan full list each page) **or** merge incrementally — simplest correct approach: accumulate all `MinimalInstallation` in an array across pages, then map once per progress (acceptable for expected page counts); document if large installs become an issue.
- On **200 + empty**: `emptyHint` from new `buildEmptyInstallationsHint()` in `emptyOrgListHint.ts` (single paragraph: no org installs visible; install app below).
- **403** message: distinguish **GitHub App configuration** (operator adjusts app permissions / metadata) vs transient (use status + `friendlyInstallationsListHttpError`).
- Remove **all** `repos.listForAuthenticatedUser` / repo-owner inference.

- [ ] **Step 4: Replace `emptyOrgListHint.ts`** — remove `buildEmptyOrgsFromReposHint` and repo-specific helpers unless used elsewhere (grep repo). Add:

```typescript
export function buildEmptyInstallationsHint(): string {
  return (
    "No GitHub organisations in this list have the Fullsend app installed for your account yet. " +
    "Use “Add the app…” below to install it on the organisations you administer."
  );
}
```

Update `emptyOrgListHint.test.ts` accordingly.

- [ ] **Step 5: Run full org package tests**

Run: `npm run test -- --run web/admin/src/lib/orgs/`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/admin/src/lib/orgs/
git commit -m "feat(admin): fetch org list from user app installations"
```

---

### Task 5: OAuth `state` slug fallback (Worker + SPA)

**Files:**

- Modify: `cloudflare_site/worker/src/index.ts`
- Modify: `cloudflare_site/worker/src/index.worker.test.ts`
- Modify: `web/admin/src/lib/auth/tokenStore.ts`
- Modify: `web/admin/src/lib/auth/tokenStore.test.ts`
- Modify: `web/admin/src/lib/auth/oauth.ts`
- Modify: `web/admin/src/lib/auth/oauth.test.ts`

- [ ] **Step 1: Worker** — extend `Env` with `GITHUB_APP_SLUG?: string`. In `buildGithubState`, add `g` to JSON when trimmed slug non-empty; ensure total base64 `state` still under `MAX_GITHUB_STATE_LEN`.

- [ ] **Step 2: Worker test** — GET `/api/oauth/authorize` with valid params; decode `Location` query `state` from base64url JSON; when `GITHUB_APP_SLUG=my-app`, expect `g === "my-app"`.

- [ ] **Step 3: SPA `tryParseWorkerExpandedOauthState`** — allow optional `g` with the same regex as `installationOrgRows`. If `g` is present but **not a string**, **fail the full parse**. If `g` is a string that **fails slug validation**, **omit** `g` and continue (sign-in must not be blocked by a bad Worker slug; install link falls back to API slug).

- [ ] **Step 4: `persistGithubAppSlugFromOAuth` / `loadGithubAppSlug` / `clearSession`** in `tokenStore.ts` (localStorage key e.g. `fullsend_admin_github_app_slug`).

- [ ] **Step 5: `completeGithubOAuthFromHandoff`** — after `saveToken`, call `persistGithubAppSlugFromOAuth(expanded.g)`.

- [ ] **Step 6: Run tests**

Run: `npm run test -- --run web/admin/src/lib/auth/oauth.test.ts web/admin/src/lib/auth/tokenStore.test.ts`
Run: `npm run test -- --run cloudflare_site/worker/src/index.worker.test.ts`
(Use repo’s actual worker test script if different.)

- [ ] **Step 7: Commit**

```bash
git add cloudflare_site/worker/src/index.ts cloudflare_site/worker/src/index.worker.test.ts web/admin/src/lib/auth/
git commit -m "feat(admin): optional GitHub App slug in OAuth state for install links"
```

---

### Task 6: `OrgList.svelte` UX (install block, empty order, pagination warning)

**Files:**

- Modify: `web/admin/src/routes/OrgList.svelte`

- [ ] **Step 1: Resolved slug** — `$derived` or function:

```typescript
import { loadGithubAppSlug } from "../lib/auth/tokenStore";
import { githubAppInstallationsNewUrl } from "../lib/github/githubAppInstallLink";
// after fetch: store last appSlugFromApi from result in $state
const installHref = $derived(() => {
  const slug = appSlugFromLastFetch ?? loadGithubAppSlug() ?? "";
  return githubAppInstallationsNewUrl(slug);
});
```

Track `appSlugFromLastFetch` from `fetchOrgsWithProgress` final result (`r.appSlugFromApi`).

- [ ] **Step 2: Empty branch** — when `filteredAll.length === 0` and `serverOrgs.length === 0` and **no error**: show primary muted line, then `emptyHint` if non-null, then **extra** paragraph (spec: empty may mean no installs), **then** do **not** duplicate the always-on block inside empty only — structure: list region contains empty messages; **below** the `{#if error}` / `{:else if filteredAll...}` block’s closing, add a **single** always-on `.install-app` section (or after list `<ul>` when non-empty) so it appears for both empty and non-empty. Match spec: always-on block **below** list area; empty **extra** paragraph **above** that block.

- [ ] **Step 3: Install link** — `<a rel="noopener noreferrer" target="_blank" href={installHref}>` — only render `href` when `installHref` non-null; else show muted “Install link unavailable (missing app slug).” Copy should tell users to click **Refresh** after returning from GitHub.

- [ ] **Step 4: Pagination cap** — when `r.installationListTruncated`, show **red** helper text (same severity styling as the “showing 15 organisations” cap) explaining that not all installation pages were loaded.

- [ ] **Step 5: Manual smoke** — `npm run dev`, sign in, open Network: `user/installations` returns 200 from browser origin (CORS). If blocked, stop and document Worker proxy contingency in a short `docs/` note or issue comment — do **not** implement proxy without confirmation.

- [ ] **Step 6: Commit**

```bash
git add web/admin/src/routes/OrgList.svelte
git commit -m "feat(admin): org list install guidance and pagination-cap warning"
```

---

### Task 7: Documentation and env sample

**Files:**

- Modify: `sample.env.local`
- Modify: `web/admin/README.md`

- [ ] **Step 1:** Add commented `GITHUB_APP_SLUG=your_app_slug_here` under GitHub App section; note optional; used for OAuth `state` when API omits slug.

- [ ] **Step 2:** README paragraph linking to spec + slug sources.

- [ ] **Step 3: Commit**

```bash
git add sample.env.local web/admin/README.md
git commit -m "docs(admin): document GitHub App slug for install links"
```

---

## Plan self-review (spec coverage)

| Spec section | Tasks |
|--------------|--------|
| Installations API primary | Task 4 |
| Browser-only / CORS | Task 6 Step 5 + Task 4 (contingency note) |
| No repo fallback | Task 4 removes repos path |
| Error vs empty | Tasks 4 + 6 |
| Install UI + empty order | Task 6 |
| Slug API + OAuth fallback | Tasks 1–2, 4 result, 5, 6 |
| After install: manual Refresh only | Task 6 copy + no session flag |
| Pagination cap warning | Task 4 `installationListTruncated` + Task 6 |
| Security slug validation | Tasks 1–2, 5 |
| Tracking #547 | Mention in PR / commit body |

**Placeholder scan:** No `TBD` / `TODO` left in tasks above.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-admin-spa-org-list-installations.md`.

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline execution** — run tasks in this session with executing-plans checkpoints.

Which approach do you want?
