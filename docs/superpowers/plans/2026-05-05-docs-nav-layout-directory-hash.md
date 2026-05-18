# Docs nav layout, resizable sidebar, and directory hash — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full-height sidebar with top bar over content only, aligned tree icons, dirs-before-files ordering, user-resizable sidebar width (default ≥20vw and ≥15rem, min ~15rem), directory hash URLs that focus the tree without changing the current article, and Markdown links to directories that emit `#/<dir>/`.

**Architecture:** Extend `hashRoute` with a discriminated parse result for file vs directory fragments; keep `pageRouteKey` in `App.svelte` driven by file hashes while directory hashes update outline focus only (last-doc `sessionStorage` + default on cold load). Restructure shell DOM/CSS so the sidebar is full height beside a column that stacks top bar + main. Add a drag handle + `localStorage` for width. Centralize dirs-first ordering in `vitePluginDocs` `toManifest`. Adjust `DocTreeNav` row layout for chevron spacer alignment and accept an `expandFocusPath` prop for directory navigation and scroll targets.

**Tech stack:** Svelte 5 (`web/docs`), Vite, Vitest, existing remark link rewriter in `web/docs/build/markdown.ts`.

**Spec:** [2026-05-05-docs-nav-layout-and-directory-hash-design.md](../specs/2026-05-05-docs-nav-layout-and-directory-hash-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `web/docs/src/lib/hashRoute.ts` | Parse/format file vs directory fragments |
| `web/docs/src/lib/hashRoute.test.ts` | Unit tests for hash behavior |
| `web/docs/src/lib/routing.ts` | Thin wrappers: `getDocRouteFromWindow` may return extended parse; add `navigateToDirPath` or use `formatDocDirHash` + assign `location.hash` |
| `web/docs/src/lib/manifestDirs.ts` (new) | `collectDirPaths(manifest): Set<string>` by walking `ManifestNode[]` |
| `web/docs/src/lib/manifestDirs.test.ts` (new) | Tests for dir path collection |
| `web/docs/build/vitePluginDocs.ts` | `toManifest`: sort each level dirs first, then files |
| `web/docs/build/markdown.ts` | Detect directory targets; emit `#/<dirPath>/` |
| `web/docs/build/markdown.test.ts` | Tests for directory link URLs |
| `web/docs/build/paths.ts` | Optional: helper to test if a POSIX path under `docs/` is a directory on disk (for link rewriter) |
| `web/docs/src/App.svelte` | Shell DOM restructure; `pageRouteKey` vs hash kind; last-doc persistence; resize handler; effects for tree scroll + open sidebar |
| `web/docs/src/lib/DocTreeNav.svelte` | Chevron column + spacer; `expandFocusPath` prop; `data-doc-tree-dir` for scroll target; integrate sorted children (if not only from manifest) |
| `web/docs/src/app.css` | Full-height layout, resize handle, min/max width variables |

---

### Task 1: Hash parsing and formatting (file vs directory)

**Files:**

- Modify: `web/docs/src/lib/hashRoute.ts`
- Modify: `web/docs/src/lib/hashRoute.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that expect:

- `parseDocHash("#/guides/admin/")` → `{ kind: "dir", dirPath: "guides/admin" }` (exact shape as you implement).
- `parseDocHash("#/guides/admin/installation")` → `{ kind: "file", routeKey: "guides/admin/installation" }`.
- `parseDocHash("#/a/b::x")` → file with slug `x`.
- Directory with `::` in fragment is invalid → return `null` or a dedicated invalid handling (match spec: fall back like bad hash); assert chosen behavior.
- `formatDocDirHash("problems/applied")` → `#/problems/applied/` (no double slashes).

- [ ] **Step 2: Run tests — expect failures**

Run: `cd web && npx vitest run docs/src/lib/hashRoute.test.ts`
Expected: new tests fail.

- [ ] **Step 3: Implement**

Rules:

- Strip `#`, ignore leading `/` on the path body.
- If empty or `/` only → `null` (default route).
- If the path contains `::`, split **only for file** routes: the segment before `::` must **not** be a directory URL (no trailing `/`). If `before::` ends with `/`, treat whole hash as invalid (`null`).
- If no `::` and path ends with `/` (more than just `/`), `kind: "dir"`, `dirPath` = path with trailing slashes removed.
- Otherwise `kind: "file"`, `routeKey` = path (no leading slash), optional slug unchanged from current logic when `::` present.

Add `formatDocDirHash(dirPath: string): string` that normalizes and appends exactly one `/` in the fragment.

- [ ] **Step 4: Run tests — expect pass**

Run: `cd web && npx vitest run docs/src/lib/hashRoute.test.ts`

- [ ] **Step 5: Commit**

```bash
git add web/docs/src/lib/hashRoute.ts web/docs/src/lib/hashRoute.test.ts
git commit -m "feat(docs-app): parse directory hash fragments with trailing slash"
```

---

### Task 2: Collect directory paths from manifest

**Files:**

- Create: `web/docs/src/lib/manifestDirs.ts`
- Create: `web/docs/src/lib/manifestDirs.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { collectDirPaths } from "./manifestDirs";
import type { ManifestNode } from "virtual:fullsend-docs";

describe("collectDirPaths", () => {
  it("collects nested dir paths with posix segments", () => {
    const tree: ManifestNode[] = [
      {
        type: "dir",
        name: "guides",
        children: [
          {
            type: "dir",
            name: "admin",
            children: [
              { type: "file", name: "installation", routeKey: "guides/admin/installation", title: "Install" },
            ],
          },
        ],
      },
    ];
    expect(collectDirPaths(tree)).toEqual(new Set(["guides", "guides/admin"]));
  });
});
```

- [ ] **Step 2: Run test — FAIL**

Run: `cd web && npx vitest run docs/src/lib/manifestDirs.test.ts`

- [ ] **Step 3: Implement `collectDirPaths`**

Walk `ManifestNode[]`; for each `dir` with `parentPath`, push `${parent}/${name}` or `name` at root; recurse into `children`.

- [ ] **Step 4: PASS and commit**

```bash
git add web/docs/src/lib/manifestDirs.ts web/docs/src/lib/manifestDirs.test.ts
git commit -m "feat(docs-app): collect manifest directory paths for hash validation"
```

---

### Task 3: Manifest sort — directories before files

**Files:**

- Modify: `web/docs/build/vitePluginDocs.ts`

- [ ] **Step 1: In `toManifest`, partition children**

After building `nodes` from `dir.children`, split into `dirNodes` and `fileNodes` (by presence of `routeKey`), sort each by `name` / `localeCompare`, concatenate `[...dirNodes, ...fileNodes]`.

- [ ] **Step 2: Sanity check**

Run: `cd web && npm run build` (or `npx vite build` from `web/`) and confirm build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/docs/build/vitePluginDocs.ts
git commit -m "feat(docs-app): sort manifest tree dirs before files"
```

---

### Task 4: Markdown links to directories

**Files:**

- Modify: `web/docs/build/markdown.ts`
- Modify: `web/docs/build/markdown.test.ts` (or add cases if missing)

- [ ] **Step 1: Add filesystem check**

In the remark plugin context, after resolving `resolvedPosix` relative to `docs/` root:

- If the target is a **file** (existing `.md` mapping), keep current behavior.
- If the target path (without extension) corresponds to a **directory** under `docs/` that contains markdown or subdirs — simplest approach: `fs.existsSync` + `fs.statSync` on `docs/<path>` and require `stat.isDirectory()`. If the link path resolves to a directory, set `node.url = formatDocDirHash(dirRouteKey)` where `dirRouteKey` is the posix path relative to `docs/` without trailing slash.

**Edge case:** Link to `foo.md` vs `foo/` — only treat as directory when the resolved path is an actual directory on disk.

Import `formatDocDirHash` from a shared module: **avoid importing from `src/` in build** — duplicate small helper in `web/docs/build/hashFormat.ts` (new) exporting `formatDocDirHash` only, or implement inline in `markdown.ts` to match `hashRoute.ts` (document “must match client” in a one-line comment).

- [ ] **Step 2: Tests**

Add a test that runs the remark pipeline with a temp structure or mocked paths if the harness allows; if not, extract `resolvedPathToUrl` (new small pure function) and unit-test directory vs file. Prefer a real test under `web/docs/build/` consistent with existing `markdown.test.ts` style.

- [ ] **Step 3: Commit**

```bash
git add web/docs/build/markdown.ts web/docs/build/markdown.test.ts web/docs/build/hashFormat.ts
git commit -m "feat(docs-app): rewrite markdown links to directories as trailing-slash hashes"
```

---

### Task 5: Routing helpers and last-document persistence

**Files:**

- Modify: `web/docs/src/lib/routing.ts`
- Optional: small tests if you export pure functions

- [ ] **Step 1: Add `LAST_DOC_ROUTE_KEY = "fullsend-docs-last-doc-route"` (sessionStorage)**

Export a function `persistLastDocRouteKey(routeKey: string)` and `readLastDocRouteKey(): string | null`.

- [ ] **Step 2: `getParsedHashFromWindow()`**

Re-export or add wrapper returning `parseDocHash(location.hash)` with the new union type.

- [ ] **Step 3: Navigation helper for programmatic directory focus**

```ts
export function navigateToDirPath(dirPath: string): void {
  location.hash = formatDocDirHash(dirPath);
}
```

- [ ] **Step 4: Commit**

```bash
git add web/docs/src/lib/routing.ts
git commit -m "feat(docs-app): last-doc session storage and directory hash navigation helper"
```

---

### Task 6: `App.svelte` — routing state and shell layout

**Files:**

- Modify: `web/docs/src/App.svelte`

- [ ] **Step 1: Introduce `pageRouteKey` state**

Replace single `routeKey` used for `loadPage` with `pageRouteKey` updated only when:

- Hash is **file** and valid → `pageRouteKey = routeKey`, call `persistLastDocRouteKey`.
- Hash is **dir** and valid → `pageRouteKey = readLastDocRouteKey() ?? defaultRouteKeyFromKeys(...)`.
- Hash invalid / default → existing defaulting; update `pageRouteKey` and persist when landing on a file.

Keep a derived `dirFocusPath: string | null` from current hash when `kind === "dir"` and path is in `collectDirPaths(manifest)`.

- [ ] **Step 2: Invalid directory**

If hash says dir but `dirPath` not in `collectDirPaths(manifest)`, treat like invalid file: `replace` to default file hash.

- [ ] **Step 3: Restructure DOM**

Wrap `docs-topbar` + `docs-main` in a container, e.g.:

```svelte
<div class="docs-shell-inner">
  <aside class="docs-sidebar" ...>...</aside>
  <div class="docs-content-column">
    <header class="docs-topbar">...</header>
    <div class="docs-main-wrap">
      <main class="docs-main">...</main>
    </div>
  </div>
</div>
```

Remove the old “topbar above full width” pattern. Sidebar remains first in DOM for LTR.

- [ ] **Step 4: Effects**

When `dirFocusPath` changes (and on mount): `persistNavCollapsed(false)` / `mobileNavOpen = true` on mobile if needed; set `sessionStorage` tree expand keys for ancestors (or pass `expandFocusPath` into `DocTreeNav` and adjust `isExpanded` to treat `descendantMatchesActive(dirPath, expandFocusPath)`); `tick()` then `document.querySelector(\`[data-doc-tree-dir="${CSS.escape(dirFocusPath)}"]\`)?.scrollIntoView({ block: "nearest" })`.

- [ ] **Step 5: Wire `DocTreeNav`**

Pass `expandFocusPath={dirFocusPath}` and `activeRouteKey={pageRouteKey}`.

- [ ] **Step 6: Manual smoke + commit**

Run `cd web && npm run dev`, verify file nav, dir hash, cold load. Then:

```bash
git add web/docs/src/App.svelte
git commit -m "feat(docs-app): full-height sidebar column and directory hash routing state"
```

---

### Task 7: Resize handle and width persistence

**Files:**

- Modify: `web/docs/src/App.svelte`
- Modify: `web/docs/src/app.css`

- [ ] **Step 1: Constants**

`const WIDTH_STORAGE_KEY = "fullsend-docs-sidebar-width-px"`; `MIN = 15 * 16` (15rem in px at default root) or use `getComputedStyle` for rem; simpler: store **rem** as number `15` min or store px from `getBoundingClientRect`.

Recommended: store **pixels**; on load `clamp(width, 15rem_in_px, maxPx)`.

Default when missing: `Math.max(window.innerWidth * 0.2, remToPx(15))`.

- [ ] **Step 2: Pointer handlers**

On `mousedown` on `.docs-sidebar-resize-handle`, set capturing listener for `mousemove` / `mouseup` to adjust `--docs-sidebar-width` on `document.documentElement` or `.docs-shell`, persist on `mouseup`.

- [ ] **Step 3: CSS**

Add narrow handle between aside and content; `user-select: none` while dragging. When `nav-collapsed`, hide handle or width 0.

- [ ] **Step 4: Commit**

```bash
git add web/docs/src/App.svelte web/docs/src/app.css
git commit -m "feat(docs-app): drag-to-resize sidebar with persisted width"
```

---

### Task 8: Tree row alignment and folder data attribute

**Files:**

- Modify: `web/docs/src/lib/DocTreeNav.svelte`
- Modify: `web/docs/src/app.css`

- [ ] **Step 1: Props**

Add `expandFocusPath?: string | null` (default `null`). Update `isExpanded` fallback when no session override:

`return descendantMatchesActive(dirPath, activeRouteKey) || descendantMatchesActive(dirPath, expandFocusPath ?? "")`.

- [ ] **Step 2: Row DOM**

For folders: `data-doc-tree-dir={dirPath}` on the row wrapper (e.g. outer `div.doc-tree-folder`).

For files: add empty `span.doc-tree-chevron-slot` (same dimensions as `.doc-tree-chevron`) before doc glyph.

For folders: keep chevron in `.doc-tree-chevron-slot` or first grid column.

Use **CSS grid** on `.doc-tree-folder-toggle` and `.doc-tree-link`: e.g. `grid-template-columns: 1.25rem 1.25rem 1fr; align-items: center;` with chevron column 1, icon column 2, text column 3.

- [ ] **Step 3: Remove duplicate sort** if manifest already dirs-first (no extra sort in Svelte).

- [ ] **Step 4: Commit**

```bash
git add web/docs/src/lib/DocTreeNav.svelte web/docs/src/app.css
git commit -m "feat(docs-app): align tree icons and expand for directory hash focus"
```

---

### Task 9: Verification

- [ ] **Step 1: Unit tests**

Run: `cd web && npx vitest run`

- [ ] **Step 2: Lint**

Run: `make lint` from repo root.

- [ ] **Step 3: Commit** (if only fixes)

```bash
git commit -m "fix(docs-app): address lint/test for nav layout follow-up"
```

---

## Plan self-review (spec coverage)

| Spec item | Task |
|-----------|------|
| Icon alignment + child indentation | Task 8 |
| Full-height sidebar; top bar on content column | Task 6 |
| Resizable separator + persistence + min/default width | Task 7 |
| Dirs before files | Task 3 |
| Directory hash + option C article behavior | Tasks 1, 2, 5, 6 |
| Expand/scroll/open outline | Task 6 |
| Markdown directory links | Task 4 |
| Tests | Tasks 1–4, 9 |

**Cold load directory hash:** Covered in Task 6 (`readLastDocRouteKey() ?? default`).

**Mobile resize omitted:** Task 7 notes; optional to skip drag on `max-width: 768px`.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-docs-nav-layout-directory-hash.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline execution** — run tasks in this session with executing-plans checkpoints.

**Which approach do you want?**
