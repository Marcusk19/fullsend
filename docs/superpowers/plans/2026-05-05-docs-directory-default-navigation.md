# Directory default navigation (BFS) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement [2026-05-05-docs-directory-default-navigation-design.md](../specs/2026-05-05-docs-directory-default-navigation-design.md): directory URLs and in-doc `#/<dir>/` links resolve to a BFS default file, normalize the hash to that file (replace on cold resolve), sync the outline (expand ancestors, scroll active doc row, reveal sidebar only when navigation originated from a directory target), while sidebar folder rows stay expand/collapse only.

**Architecture:** Add a small pure helper for BFS default route selection over the manifest tree; extend `treeSession` to expand ancestor dirs for a file `routeKey`; add a `data-doc-tree-route` anchor on file rows for scrolling; centralize outline sync in `App.svelte` with a `revealChrome` flag set only when transitioning from directory resolution or in-doc directory link handling; replace the current “option C” directory branch (keep last article, `dirFocusPath`) with immediate navigation to the resolved file hash.

**Tech stack:** Svelte 5, TypeScript, Vite, Vitest, existing `virtual:fullsend-docs` manifest types.

---

## File map

| File | Responsibility |
|------|----------------|
| `web/docs/src/lib/manifestBfsDefault.ts` (create) | Locate directory node by POSIX path; BFS queue over children in manifest order; return first file `routeKey` or `null`. |
| `web/docs/src/lib/manifestBfsDefault.test.ts` (create) | Vitest coverage for BFS vs shallow file, nested-only file, unknown dir. |
| `web/docs/src/lib/treeSession.ts` (modify) | Add `persistExpandedPathForRouteKey(routeKey, dirPaths)` using existing `persistExpandedPathInSession`. |
| `web/docs/src/lib/treeSession.test.ts` (modify) | Tests for route-key expansion (parent chain in `sessionStorage`). |
| `web/docs/src/lib/DocTreeNav.svelte` (modify) | Add `data-doc-tree-route={node.routeKey}` on file row container for scroll targeting. |
| `web/docs/src/App.svelte` (modify) | Directory hash handling → BFS + `navigateToRouteKey(..., { replace: true })`; remove `dirFocusPath` / `focusDirectoryInOutline` for directory hashes; `onDocMainClick` navigates to BFS target with push and forces outline sync when hash unchanged; optional `$effect` or shared helper for outline sync after `pageRouteKey` updates with `revealChrome` only from directory flows. |
| `web/docs/src/lib/routing.ts` (optional) | Remove or keep `navigateToDirPath` if unused after `App.svelte` changes. |
| `docs/superpowers/specs/2026-05-05-docs-nav-layout-and-directory-hash-design.md` (optional) | One-line pointer at top that article behavior for directory hashes is superseded by the BFS spec (avoids readers following stale “option C”). |

---

### Task 1: BFS default route helper

**Files:**

- Create: `web/docs/src/lib/manifestBfsDefault.ts`
- Create: `web/docs/src/lib/manifestBfsDefault.test.ts`
- Test: `npm test` (repo root) — Vitest picks up `*.test.ts` via `vite.config.ts`

- [ ] **Step 1: Add failing tests**

```typescript
import { describe, expect, it } from "vitest";
import type { ManifestNode } from "virtual:fullsend-docs";
import { bfsFirstRouteKeyUnderDir } from "./manifestBfsDefault";

describe("bfsFirstRouteKeyUnderDir", () => {
  it("prefers a shallow file over a file nested under an earlier subdir (BFS not DFS)", () => {
    const tree: ManifestNode[] = [
      {
        type: "dir",
        name: "root",
        children: [
          {
            type: "dir",
            name: "sub",
            children: [
              {
                type: "file",
                name: "deep.md",
                routeKey: "root/sub/deep",
                title: "Deep",
              },
            ],
          },
          {
            type: "file",
            name: "shallow.md",
            routeKey: "root/shallow",
            title: "Shallow",
          },
        ],
      },
    ];
    expect(bfsFirstRouteKeyUnderDir(tree, "root")).toBe("root/shallow");
  });

  it("returns nested file when no sibling file at shallower depth", () => {
    const tree: ManifestNode[] = [
      {
        type: "dir",
        name: "root",
        children: [
          {
            type: "dir",
            name: "sub",
            children: [
              {
                type: "file",
                name: "only.md",
                routeKey: "root/sub/only",
                title: "Only",
              },
            ],
          },
        ],
      },
    ];
    expect(bfsFirstRouteKeyUnderDir(tree, "root")).toBe("root/sub/only");
  });

  it("returns null for unknown directory path", () => {
    const tree: ManifestNode[] = [
      {
        type: "dir",
        name: "root",
        children: [],
      },
    ];
    expect(bfsFirstRouteKeyUnderDir(tree, "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `npm test -- --run web/docs/src/lib/manifestBfsDefault.test.ts`
Expected: FAIL (module or function missing).

- [ ] **Step 3: Implement helper**

```typescript
import type { ManifestNode } from "virtual:fullsend-docs";

function findDirNode(
  nodes: ManifestNode[],
  dirPath: string,
): Extract<ManifestNode, { type: "dir" }> | null {
  const segments = dirPath.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  let level: ManifestNode[] = nodes;
  let current: ManifestNode | null = null;
  for (const name of segments) {
    const next = level.find(
      (n): n is Extract<ManifestNode, { type: "dir" }> =>
        n.type === "dir" && n.name === name,
    );
    if (!next) return null;
    current = next;
    level = next.children;
  }
  return current?.type === "dir" ? current : null;
}

/** First file routeKey under `dirPath` using BFS (manifest child order = nav order). */
export function bfsFirstRouteKeyUnderDir(
  roots: ManifestNode[],
  dirPath: string,
): string | null {
  const dir = findDirNode(roots, dirPath);
  if (!dir) return null;
  const queue = [...dir.children];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.type === "file") return node.routeKey;
    queue.push(...node.children);
  }
  return null;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- --run web/docs/src/lib/manifestBfsDefault.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/docs/src/lib/manifestBfsDefault.ts web/docs/src/lib/manifestBfsDefault.test.ts
git commit -m "feat(docs): BFS default route helper for directory targets"
```

---

### Task 2: Expand tree ancestors for a file route key

**Files:**

- Modify: `web/docs/src/lib/treeSession.ts`
- Modify: `web/docs/src/lib/treeSession.test.ts`

- [ ] **Step 1: Add failing test**

Append to `web/docs/src/lib/treeSession.test.ts`:

```typescript
import { persistExpandedPathForRouteKey } from "./treeSession";

describe("persistExpandedPathForRouteKey", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("expands ancestor dirs for a nested file route key", () => {
    const dirPaths = new Set(["problems", "problems/applied"]);
    persistExpandedPathForRouteKey("problems/applied/foo", dirPaths);
    expect(sessionStorage.getItem("fullsend-docs-tree:problems")).toBe("1");
    expect(sessionStorage.getItem("fullsend-docs-tree:problems/applied")).toBe(
      "1",
    );
  });

  it("no-ops for single-segment route keys", () => {
    persistExpandedPathForRouteKey("vision", new Set(["vision"]));
    expect(sessionStorage.getItem("fullsend-docs-tree:vision")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test -- --run web/docs/src/lib/treeSession.test.ts`
Expected: FAIL (`persistExpandedPathForRouteKey` not exported or missing).

- [ ] **Step 3: Implement**

Add to `treeSession.ts` after imports / alongside `persistExpandedPathInSession`:

```typescript
/** Expand every manifest directory prefix of `routeKey` (parent path of the file). */
export function persistExpandedPathForRouteKey(
  routeKey: string,
  dirPaths: Set<string>,
): void {
  const segments = routeKey.split("/").filter(Boolean);
  if (segments.length < 2) return;
  const parentDir = segments.slice(0, -1).join("/");
  if (dirPaths.has(parentDir)) {
    persistExpandedPathInSession(parentDir);
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- --run web/docs/src/lib/treeSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/docs/src/lib/treeSession.ts web/docs/src/lib/treeSession.test.ts
git commit -m "feat(docs): expand outline ancestors for active file route"
```

---

### Task 3: Scroll target on file rows

**Files:**

- Modify: `web/docs/src/lib/DocTreeNav.svelte`

- [ ] **Step 1: Add `data-doc-tree-route` on the file row**

On the file branch `<button>` (class `doc-tree-link`), add:

```svelte
data-doc-tree-route={node.routeKey}
```

so the selector `[data-doc-tree-route="..."]` matches the clickable row.

- [ ] **Step 2: Commit**

```bash
git add web/docs/src/lib/DocTreeNav.svelte
git commit -m "feat(docs): data attribute on tree file rows for outline scroll"
```

---

### Task 4: App routing and outline sync

**Files:**

- Modify: `web/docs/src/App.svelte`

**Behavior to implement:**

1. **Replace directory hash handling:** On `parsed.kind === "dir"` and `dirPaths.has(parsed.dirPath)`, compute `targetKey = bfsFirstRouteKeyUnderDir(manifest, parsed.dirPath) ?? defaultRouteKeyFromKeys([...routeKeys])`. If `targetKey` null/invalid, fall back like unknown file. Otherwise call `navigateToRouteKey(targetKey, { replace: true })`, **do not** keep `pageRouteKey` from `readLastDocRouteKey()`. Remove `dirFocusPath` state, the `$effect` that calls `focusDirectoryInOutline` on `dirFocusPath`, and `focusDirectoryInOutline` if nothing else uses it (or keep for reuse inside a new helper).

2. **Outline sync helper** (same file or extracted): `syncOutlineForActiveRoute(routeKey: string, revealChrome: boolean)`:
   - `persistExpandedPathForRouteKey(routeKey, dirPaths)`
   - `outlineSessionEpoch++`
   - If `revealChrome`: `persistNavCollapsed(false)` and, when `narrowViewport`, set `mobileNavOpen = true`
   - `void tick().then(() => requestAnimationFrame(() => { document.querySelector(`[data-doc-tree-route="${CSS.escape(routeKey)}"]`)?.scrollIntoView({ block: "nearest" }); }))` (second `rAF` retry optional, mirror folder scroll robustness)

3. **Directory-origin flag:** Before `navigateToRouteKey` from the **`syncRouteFromLocation` directory branch**, set `let directoryOutlineReveal = true` (Svelte `$state`). At the end of the **file** branch of `syncRouteFromLocation` (when `pageRouteKey` is set to a valid key), if `directoryOutlineReveal` then call `syncOutlineForActiveRoute(pageRouteKey, true)` and set flag false; otherwise call `syncOutlineForActiveRoute(pageRouteKey, false)` or skip chrome reveal — per spec, only directory flows force the sidebar open.

   **Important:** Avoid double `syncOutline` on the same tick: the directory branch should only `navigateToRouteKey` + return; the subsequent hashchange runs the file branch which clears the flag and syncs once.

4. **`onDocMainClick`:** For directory links in the article: `preventDefault`; compute same `targetKey`; compare to current file hash (`parseDocHash(window.location.hash)` kind `file` and `routeKey`). If already on `targetKey`, call `syncOutlineForActiveRoute(targetKey, true)` immediately (hash may not change). Else `navigateToRouteKey(targetKey)` (push, not replace — normal link follow). On push, hashchange runs file branch with `directoryOutlineReveal` false — user expectation: still reveal chrome for in-doc directory link. So **also set `directoryOutlineReveal = true` in `onDocMainClick` before `navigateToRouteKey`** when the link is a directory link, and let the file branch consume it, **or** call `syncOutlineForActiveRoute(targetKey, true)` after navigation in the click handler when you did not use replace. Simplest: set the same `directoryOutlineReveal` flag to `true` in `onDocMainClick` before calling `navigateToRouteKey(targetKey)` without replace; file branch on hashchange runs with flag true and syncs with reveal. For the idempotent branch (already on target), call `syncOutlineForActiveRoute(targetKey, true)` directly and do not toggle the flag.

5. **Imports:** `bfsFirstRouteKeyUnderDir` from `./lib/manifestBfsDefault`; `persistExpandedPathForRouteKey` from `./lib/treeSession`.

6. **Cleanup:** Remove unused `dirFocusPath`-related code; grep for `focusDirectoryInOutline` and `formatDocDirHash` usage — keep `formatDocDirHash` if still used in click handler (it may not be needed if you navigate straight to file).

- [ ] **Step 1: Implement `App.svelte` changes and verify manually** (`npm run dev:vite`, click directory link, cold `#/dir/`, collapse sidebar + directory link).

- [ ] **Step 2: Run automated checks**

Run: `npm test`
Run: `npm run check`
Run: `make lint` (repo root)

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add web/docs/src/App.svelte
git commit -m "feat(docs): resolve directory hashes to BFS default page and sync outline"
```

---

### Task 5: Optional doc pointer in older spec

**Files:**

- Modify: `docs/superpowers/specs/2026-05-05-docs-nav-layout-and-directory-hash-design.md`

- [ ] **Step 1:** After the title block, add one sentence: directory **article** behavior (“option C”) is superseded by this plan.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-05-docs-nav-layout-and-directory-hash-design.md
git commit -m "docs: point directory article behavior to BFS spec"
```

---

## Self-review (spec coverage)

| Spec section | Task(s) |
|--------------|---------|
| BFS default | Task 1 |
| URL replace on cold `#/dir/` | Task 4 (`replace: true` in `syncRouteFromLocation` dir branch) |
| In-doc `#/dir/` push + idempotent outline | Task 4 (`onDocMainClick`) |
| Outline expand + scroll + reveal chrome for directory flows | Task 2, 3, 4 |
| Sidebar folders expand-only | Task 3–4 (no changes to folder `onclick`) |
| Invalid dir → global default | Task 4 (fallback `defaultKey`) |
| No slug on directory URLs | Existing `hashRoute` / unchanged |

**Placeholder scan:** None intentional. **Types:** `ManifestNode` from `virtual:fullsend-docs` only in new helper/tests.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-docs-directory-default-navigation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach do you want?
