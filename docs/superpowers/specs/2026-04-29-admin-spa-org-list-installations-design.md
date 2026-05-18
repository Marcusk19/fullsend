# Design: Admin org list from GitHub App installations (browser-first)

Date: 2026-04-29
Status: Accepted (brainstorm → spec)
Delivery branch: `feat/admin-spa-org-list` (may ship in the same PR as replacement of current org-list implementation).

## Tracking

- Implementation tracker: [#547 — Admin web: trustworthy org listing and GitHub App install guidance](https://github.com/fullsend-ai/fullsend/issues/547) (sub-issue of [#509](https://github.com/fullsend-ai/fullsend/issues/509), blocked by [#513](https://github.com/fullsend-ai/fullsend/issues/513) where that dependency still applies).
- Related org-picker scope: [#510 — Admin web: pick and search organizations you administer](https://github.com/fullsend-ai/fullsend/issues/510).

## Problem

The admin organisation picker is driven by **`GET /user/installations`** (see `web/admin/src/lib/orgs/fetchOrgs.ts`): organisations appear only when the **Fullsend Admin GitHub App** is installed for the signed-in user. **Earlier designs** inferred orgs from **`GET /user/repos`**, which could be **misleading** relative to **org setup, deploy, and install-state checks** that assume the app is installed. Installations-backed listing avoids showing orgs the user cannot act on and pairs empty states with **install** guidance.

## Goals

1. **List orgs (and org-like installation targets)** using the **primary GitHub API that enumerates app installations for the signed-in user’s token** — i.e. installations of **this** admin GitHub App the user may access — not repo-owner inference.
2. **Single simple client flow:** prefer **one paginated GitHub call** from the **browser** (Octokit or `fetch` to `api.github.com` with the user access token). **Do not** add a Worker-backed org list endpoint unless GitHub **blocks** browser access (documented example: **CORS** or an equivalent hard limitation).
3. **No fallback** to the repo-scan org list when the installations API fails: show **accurate** errors and guidance (**Refresh** for transient failures; stable **403/permission** text for deployers vs **install app on orgs** for admins).
4. **Install guidance:** always-on copy + link to GitHub’s **install the app** flow; when the list is empty, **additional** explanation in the **list region**, **above** that block (see [UI](#ui)).
5. **App slug for install URL:** **prefer** a slug (or equivalent) from the **installations API response** when present; **otherwise** pass slug in **OAuth `state`** alongside the Turnstile site key (same Worker authorize path as today — not `VITE_*` / not a separate “install redirect” Worker route).
6. **After install:** users **stay on GitHub** until they navigate back to the admin SPA; they use **Refresh** on the organisation list to reload installations. **No** session flag, automatic redirect, or forced full-page refresh on return. **Optional UX:** if the user remains on the org list with a **success-empty** result (zero org rows), the SPA may run a **small number of delayed background re-fetches** to absorb GitHub propagation delay; this supplements **Refresh** and does not replace it after returning from GitHub.

## Non-goals

- Listing **every** org membership independent of app installation (supersedes the older “all memberships” org-list wording in [`2026-04-06-fullsend-admin-spa-design.md`](2026-04-06-fullsend-admin-spa-design.md) §3 for **this picker** — that doc remains authoritative for other product areas unless updated separately).
- **Multi-endpoint orchestration** (e.g. memberships + installations merge + per-org probes) as the default design; if implementation discovers a **second** call is unavoidable, document it in the implementation plan with justification.
- **Worker-first** org listing for convenience; Worker is **exception-only**.

## API choice (normative)

**Primary source:** GitHub’s **“list app installations accessible to the user access token”** resource (REST: **`GET /user/installations`** per [GitHub REST — Apps / Installations](https://docs.github.com/rest/apps/installations); OpenAPI operation `apps/list-installations-for-authenticated-user`; Octokit: **`octokit.rest.apps.listInstallationsForAuthenticatedUser`**).

**Pagination:** Use GitHub’s **standard page / per_page** (or cursor if GitHub documents one for this resource); cap pages if the codebase already uses a safety cap pattern from `fetchOrgs.ts`.

**Row model:** Each installation whose `account` is an **Organization** (and any **user-account** installation the product explicitly supports, if applicable) becomes one **org list row**. Filtering to **orgs only** is acceptable if user-account installs are out of scope for Fullsend org admin flows.

## Slug and install URL

- **Preferred:** derive **`https://github.com/apps/<slug>/installations/new`** from fields on the installation or nested **app** object returned by **`GET /user/installations`**, when GitHub includes **`app.slug`** (or equivalent) the SPA is allowed to read.
- **Fallback:** extend the Worker-built OAuth **`state`** payload (same mechanism as **`TURNSTILE_SITE_KEY`**) with an optional **`GITHUB_APP_SLUG`** (or keyed field) so the SPA can persist slug after sign-in when the installations response does not carry it.
- **Validation:** in the SPA parser, **`g` must be a string** when present; wrong JSON types **fail the whole `state` parse** (same discipline as other required `state` fields). A **string** `g` that **fails slug format** is **omitted** so a misconfigured Worker cannot block sign-in; install links then fall back to slug from the installations API or remain unavailable until fixed.

## Errors and empty states

| Situation | UX |
|-----------|-----|
| **HTTP 5xx, network error, rate limit** | Treat as **transient**: message + **Refresh**; do not imply misconfigured GitHub App permissions. |
| **401** | Session invalid → existing re-auth / sign-out behaviour. |
| **403** or documented “missing scope” | **Stable** configuration: operator may need to grant permissions on the **GitHub App**; copy should distinguish from “install on org.” |
| **200 with empty `installations`** | **Success empty:** explain that **no orgs have this app installed** (for this user’s visibility); show **install** CTA block below. |
| **Repo-scan hint** | **Remove** for this screen once installations drive the list; any “empty repos” messaging belongs elsewhere, not as a fallback list. |

## UI

- **Non-empty list:** existing list + row evaluation patterns stay; adapt data source from inferred org rows to **installation-backed** rows (field mapping in implementation plan).
- **Always-on block** below the list: short text that **actions on an org require the Fullsend GitHub App to be installed** on that org, plus a **single link** to GitHub’s install flow (`…/installations/new`), using resolved slug rules above.
- **Empty list:** in the **list region** (where rows would be): primary empty line, optional secondary hints, then **extra** paragraph that empty can mean **no installs** (not only “no repos”); **above** the always-on install block.

## Pagination cap

When the implementation stops after a **maximum number** of `GET /user/installations` pages (safety cap), the UI must show a **visible warning** that the organisation list may be incomplete — not a silent truncation.

## Security and privacy

- **Slug in OAuth `state`:** same constraints as today’s expanded `state` (length limits, base64url JSON); keep under GitHub’s **`state`** size limits.
- **No new secrets** in the static bundle; slug from API or `state` only.

## Testing

- **Unit tests:** pagination helper, row mapping from fixture installation JSON, slug resolution order (API wins over stale stored slug), `state` parser with optional slug (including **omit invalid string `g`**, **fail parse on wrong `g` type**), error classification helpers.
- **Integration / manual:** token with zero installs, token with multiple org installs, 403 with missing GitHub App permission (staging app).

## Open items (for implementation plan)

1. Exact **Octokit** method name and **response typing** for the chosen REST route; fixture snapshots from GitHub’s documented JSON.
2. Whether **`repository_selection`** or other fields must appear in row UI (out of scope unless product asks).
3. Confirm **CORS** for `GET https://api.github.com/user/installations` with **`Authorization: Bearer`** from the admin SPA origin; if blocked, document the **minimal Worker proxy** exception (read-only pass-through) as a contingency.

## Implementation note

Replace **`web/admin/src/lib/orgs/fetchOrgs.ts`** (and dependents such as **`OrgList.svelte`**, **`emptyOrgListHint.ts`**) rather than keeping parallel “old infer / new install” paths, once the new flow is verified.
