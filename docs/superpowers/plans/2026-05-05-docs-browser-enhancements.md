# Docs browser enhancements implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the shipped `/docs/` SPA in line with [2026-05-05-docs-browser-enhancements-design.md](../specs/2026-05-05-docs-browser-enhancements-design.md): **left** outline, **hash** routing (`#/<routeKey>` and `#/<routeKey>::<slug>`), **lazy per-page JS chunks**, **front matter** as data only, **lazy Mermaid**, **admin-aligned light chrome**, **collapsible tree with icons**, **independent scroll**, and **fixed internal links** pointing at hash URLs.

**Architecture:** The Vite docs plugin stops inlining all HTML in one virtual blob. It emits **`virtual:fullsend-docs`** exporting **`manifest`** plus a **`loadPage(routeKey)`** whose body is a **generated `switch` with one static `import()` per document** so Rollup emits one chunk per page. The Markdown pipeline gains **gray-matter** (or equivalent) for front matter, **rehype-slug** (or equivalent) for heading ids, a **rehype** pass that strips `::` from all **`id`** attributes, and a **remark** link rewriter that emits **`#/<routeKey>`** / **`#/<routeKey>::<slug>`**. The client reads **`location.hash`**, subscribes to **`hashchange`**, async-loads the page module, and scrolls to **`slug`** when present.

**Tech Stack:** Existing unified/remark/rehype chain plus **gray-matter**, **github-slugger**, **rehype-slug**; Svelte 5; Vitest. No Worker or CI layout changes required.

**Spec:** [2026-05-05-docs-browser-enhancements-design.md](../specs/2026-05-05-docs-browser-enhancements-design.md)

**Prior work:** [2026-05-04-docs-browser-spa.md](./2026-05-04-docs-browser-spa.md) (initial app — treat this plan as a **follow-on refactor**).

---

## File map (create / modify)

| Path | Role |
|------|------|
| `package.json` | Add `gray-matter`, `github-slugger`, `rehype-slug` (if not already present) |
| `vite.config.ts` | Extend `test.include` with `docs/src/**/*.test.ts` |
| `web/docs/build/markdown.ts` | Front matter strip; heading ids + `::` strip; hash link rewriter; export `frontmatter` from `markdownToHtml` |
| `web/docs/build/markdown.test.ts` | Assertions for hash `href`, front matter not in HTML, `::` stripped from ids |
| `web/docs/build/vitePluginDocs.ts` | Per-page virtual ids; bootstrap virtual exports `manifest` + `loadPage` |
| `web/docs/src/vite-env.d.ts` | Types for `loadPage`, page module default export, remove monolithic `pages` |
| `web/docs/src/lib/hashRoute.ts` | Parse/format `#/<routeKey>::<slug>` |
| `web/docs/src/lib/hashRoute.test.ts` | Unit tests (Vitest) |
| `web/docs/src/lib/routing.ts` | Hash-based `getRouteFromLocation`, `navigateToRouteKey`, optional pathname→hash redirect helper |
| `web/docs/src/lib/docUrls.ts` | Keep or narrow: pathname helpers only for legacy redirect; document hash is canonical |
| `web/docs/src/lib/manifestRouteKeys.ts` | Flatten `manifest` to `routeKey[]` / `Set` for default-doc and existence checks |
| `web/docs/src/lib/DocTreeNav.svelte` | Collapsible dirs, folder/doc glyphs, session expand state |
| `web/docs/src/App.svelte` | Left/right layout; hamburger + icon close; async `loadPage`; hash listeners; scroll-to-slug |
| `web/docs/src/app.css` | Left sidebar, scroll panes, light tokens aligned with admin (`#f4f4f4`, `#24292f`, `#0969da`, `#ccc` borders) |
| `web/docs/src/theme-admin-bridge.css` (optional) | Shared CSS variables imported from `app.css` if you want a clean split |

---

### Task 1: Hash fragment helpers

**Files:**

- Create: `web/docs/src/lib/hashRoute.ts`
- Create: `web/docs/src/lib/hashRoute.test.ts`
- Modify: `vite.config.ts` (add `docs/src/**/*.test.ts` to `test.include`)

- [ ] **Step 1: Add Vitest glob**

In `vite.config.ts`, merge into `test.include`:

```typescript
include: [
  "admin/src/**/*.test.ts",
  "docs/build/**/*.test.ts",
  "docs/src/**/*.test.ts",
],
```

- [ ] **Step 2: Implement `hashRoute.ts`**

```typescript
/** Parsed app fragment: `#/<routeKey>` or `#/<routeKey>::<slug>` (leading `#` optional when parsing). */
export type DocHashRoute = {
  routeKey: string;
  slug?: string;
};

/**
 * Empty hash or `#/` means “use default document” (caller resolves).
 */
export function parseDocHash(hash: string): DocHashRoute | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "" || raw === "/") return null;

  const withoutLead = raw.startsWith("/") ? raw.slice(1) : raw;
  const sep = withoutLead.indexOf("::");
  if (sep === -1) {
    return { routeKey: withoutLead };
  }
  return {
    routeKey: withoutLead.slice(0, sep),
    slug: withoutLead.slice(sep + 2),
  };
}

export function formatDocHash(routeKey: string, slug?: string): string {
  const k = routeKey.replace(/^\/+/, "");
  if (!k) return "#/";
  return slug !== undefined && slug !== ""
    ? `#/${k}::${slug}`
    : `#/${k}`;
}
```

- [ ] **Step 3: Write tests `hashRoute.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { formatDocHash, parseDocHash } from "./hashRoute";

describe("parseDocHash", () => {
  it("parses route only", () => {
    expect(parseDocHash("#/guides/admin/installation")).toEqual({
      routeKey: "guides/admin/installation",
    });
  });

  it("parses route and slug on first :: only", () => {
    expect(parseDocHash("#/a/b::my-slug")).toEqual({
      routeKey: "a/b",
      slug: "my-slug",
    });
  });

  it("returns null for default", () => {
    expect(parseDocHash("")).toBeNull();
    expect(parseDocHash("#/")).toBeNull();
  });
});

describe("formatDocHash", () => {
  it("round-trips", () => {
    const k = "guides/admin/installation";
    expect(parseDocHash(formatDocHash(k))).toEqual({ routeKey: k });
    expect(parseDocHash(formatDocHash(k, "x"))).toEqual({
      routeKey: k,
      slug: "x",
    });
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd path/to/your/fullsend/clone
npx vitest run web/docs/src/lib/hashRoute.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts web/docs/src/lib/hashRoute.ts web/docs/src/lib/hashRoute.test.ts
git commit -m "feat(docs-app): add hash route parse/format helpers and tests"
```

---

### Task 2: Markdown — front matter, ids, hash links

**Files:**

- Modify: `package.json` / `package-lock.json` (dependencies)
- Modify: `web/docs/build/markdown.ts`
- Modify: `web/docs/build/markdown.test.ts`

- [ ] **Step 1: Install deps**

```bash
cd path/to/your/fullsend/clone
npm install gray-matter github-slugger
npm install rehype-slug
```

- [ ] **Step 2: Change `markdownToHtml` contract**

Target signature:

```typescript
export async function markdownToHtml(
  markdown: string,
  sourceFile: DocsFilePath,
): Promise<{
  title: string;
  html: string;
  frontmatter: Record<string, unknown>;
}> {
```

Flow:

1. `const { data: frontmatter, content } = matter(markdown);` — run pipeline on **`content`** only.
2. After **rehype-slug**, add a tiny **rehype** transform that visits elements with **`id`** string properties and replaces **`::`** with **`""`** (or `"-"`) so slugs never contain the hash delimiter.
3. **Link rewriter** (remark): for relative links targeting repo docs, set `node.url` to **`#/<routeKey>`** or **`#/<routeKey>::<slugPart>`** where:
   - Resolve `pathPart` with existing `path.posix` logic from `sourceFile`’s route key dirname.
   - If URL has `#fragment`, map fragment to slug: if fragment looks like a **slug** (alphanumeric + hyphens), use as-is; else run **`slugger.slug(fragment)`** from `github-slugger` (same family as **rehype-slug**). Strip any `::` from the final slug segment.
   - Support **`.md`**, **`.markdown`**, and **extensionless** paths that resolve to an existing doc key (try **`${resolved}.md`** in the repo scan, or document that extensionless targets must match a built key — implement by normalizing to the same `filePathToRouteKey` rules as today).
4. External/http/mailto/absolute links: unchanged.

- [ ] **Step 3: Update tests in `markdown.test.ts`**

Replace the old expectation:

```typescript
expect(html).toContain('href="/docs/guides/admin/other"');
```

with hash form:

```typescript
expect(html).toContain('href="#/guides/admin/other"');
```

Add tests:

```typescript
it("strips front matter from HTML body", async () => {
  const md = `---\ntitle: Hello\n---\n\n# Body\n`;
  const { html, frontmatter } = await markdownToHtml(md, "docs/x.md");
  expect(frontmatter.title).toBe("Hello");
  expect(html).toContain("Body");
  expect(html).not.toContain("Hello"); // not as visible duplicate from yaml in body if structured right
});

it("rewrites link with heading fragment to :: slug form", async () => {
  const md = "[z](./other.md#Section-One)";
  const { html } = await markdownToHtml(
    md,
    "docs/guides/admin/installation.md",
  );
  expect(html).toMatch(/href="#\/guides\/admin\/other::section-one"/);
});
```

Adjust expected slug string to match **github-slugger** / **rehype-slug** output exactly (run test once and fix assertion).

- [ ] **Step 4: Run node tests**

```bash
npx vitest run web/docs/build/markdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json web/docs/build/markdown.ts web/docs/build/markdown.test.ts
git commit -m "feat(docs-app): front matter, hash links, slug ids without ::"
```

---

### Task 3: Vite plugin — lazy per-page virtual modules

**Files:**

- Modify: `web/docs/build/vitePluginDocs.ts`
- Modify: `web/docs/src/vite-env.d.ts`

- [ ] **Step 1: Virtual id conventions**

- Bootstrap: resolve **`virtual:fullsend-docs`** → `\0virtual:fullsend-docs`.
- Page chunk: resolve **`virtual:fullsend-docs/page/<encodedKey>`** where **`<encodedKey>`** is **`encodeURIComponent(routeKey)`** (slashes encoded so the public id is a single path segment).
- Internal resolved id: `\0fullsend-docs-page:${routeKey}` (raw routeKey, no encoding).

- [ ] **Step 2: Implement `load()` for `\0fullsend-docs-page:${routeKey}`**

- Map `routeKey` back to repo file `docs/${routeKey}.md` (same as today).
- Read file, call **`markdownToHtml`**, return ESM string:

```typescript
export default ${JSON.stringify({ title, html, frontmatter })};
```

Use **`JSON.stringify`** on an object — **escape** safely for embedding (or build object literal with JSON.stringify per field).

- [ ] **Step 3: Implement bootstrap `\0virtual:fullsend-docs`**

- Scan all markdown files, build **`manifest`** only (same **`buildTree`** as today).
- Build **`loadPage`** source:

```typescript
export const manifest = ${JSON.stringify(manifest)};

export async function loadPage(routeKey) {
  switch (routeKey) {
    case "guides/admin/installation":
      return (await import("virtual:fullsend-docs/page/guides%2Fadmin%2Finstallation")).default;
    // ... one case per file, keys sorted for stable output
    default:
      throw new Error("Unknown doc route: " + routeKey);
  }
}
```

Generate **`import()`** string argument with **`"virtual:fullsend-docs/page/" + encodeURIComponent(routeKey)`** exactly.

- [ ] **Step 4: Update `vite-env.d.ts`**

Remove **`pages`** from `virtual:fullsend-docs`. Add:

```typescript
export type DocPagePayload = {
  title: string;
  html: string;
  frontmatter: Record<string, unknown>;
};

export const manifest: ManifestNode[];
export function loadPage(routeKey: string): Promise<DocPagePayload>;
```

(Optional) declare wildcard module for page virtuals — not strictly required if `loadPage` is fully typed.

- [ ] **Step 5: Build to verify chunks**

```bash
cd path/to/your/fullsend/clone
npm run build
```

Expected: under `web/dist/assets/` you see **multiple** new hashed `.js` files (not only one docs entry). Open `web/dist/assets/*` listing mentally — count increases vs pre-change.

- [ ] **Step 6: Commit**

```bash
git add web/docs/build/vitePluginDocs.ts web/docs/src/vite-env.d.ts
git commit -m "feat(docs-app): code-split doc pages via virtual per-route modules"
```

---

### Task 4: Manifest route keys + routing module

**Files:**

- Create: `web/docs/src/lib/manifestRouteKeys.ts`
- Modify: `web/docs/src/lib/routing.ts`
- Modify: `web/docs/src/lib/docUrls.ts` (trim to legacy pathname redirect only, or delete unused exports)

- [ ] **Step 1: `manifestRouteKeys.ts`**

```typescript
import type { ManifestNode } from "virtual:fullsend-docs";

export function collectRouteKeys(nodes: ManifestNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.type === "file") out.push(n.routeKey);
    else out.push(...collectRouteKeys(n.children));
  }
  return out;
}

export function routeKeyExists(
  keys: Set<string>,
  routeKey: string,
): boolean {
  return keys.has(routeKey);
}
```

- [ ] **Step 2: Replace `routing.ts`**

Use **`parseDocHash`**, **`formatDocHash`**, **`loadPage`** type import only from virtual in App — routing stays pure:

```typescript
import { formatDocHash, parseDocHash, type DocHashRoute } from "./hashRoute";

export function getDocRouteFromWindow(): DocHashRoute | null {
  return parseDocHash(window.location.hash);
}

export function navigateToRouteKey(
  routeKey: string,
  options?: { replace?: boolean; slug?: string },
): void {
  const hash = formatDocHash(routeKey, options?.slug);
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (options?.replace) {
    location.replace(url);
  } else {
    location.hash = hash;
  }
}

export function defaultRouteKeyFromKeys(keys: string[]): string | null {
  const sorted = [...keys].sort((a, b) => a.localeCompare(b));
  const vision = sorted.find((k) => k === "vision");
  if (vision) return vision;
  return sorted[0] ?? null;
}

/** If pathname has /docs/<rest> with non-empty rest, return rest; else null. */
export function legacyPathnameDocRest(): string | null {
  const p = window.location.pathname.replace(/\/+$/, "") || "/";
  if (!p.startsWith("/docs")) return null;
  const rest = p.slice("/docs".length).replace(/^\/+/, "");
  return rest || null;
}
```

Note: **`history.pushState` does not fire `hashchange`** in common browsers. Use **`location.hash = …`** for normal navigations (history entry implied) and **`location.replace(url)`** when **`replace: true`** so **`hashchange`** listeners in **`App.svelte`** stay the single sync path.

- [ ] **Step 3: Commit**

```bash
git add web/docs/src/lib/manifestRouteKeys.ts web/docs/src/lib/routing.ts web/docs/src/lib/docUrls.ts
git commit -m "feat(docs-app): hash-based routing helpers"
```

---

### Task 5: `App.svelte` — load pages, layout chrome, Mermaid lazy

**Files:**

- Modify: `web/docs/src/App.svelte`

- [ ] **Step 1: Data flow**

- `import { manifest, loadPage } from "virtual:fullsend-docs";`
- `const routeKeys = new Set(collectRouteKeys(manifest));`
- On **`hashchange`**, **`popstate`**, and **`onMount`**: read **`getDocRouteFromWindow()`**; if null, **`replace`** hash to **`defaultRouteKeyFromKeys`** via **`navigateToRouteKey(..., { replace: true })`**.
- If **`legacyPathnameDocRest()`** non-null on boot, **`replaceState`** to **`/docs/`** (or keep pathname) + **`#/<rest>`** per spec optional nicety — implement **`replace` to `/docs/#/<rest>`** so old bookmarks work once.

- [ ] **Step 2: Async state**

- `$state` for **`routeKey`**, **`slug`**, **`page`** (`DocPagePayload | null`), **`loadError`**, **`loading`**.
- **`$effect`** or async function: when **`routeKey`** changes, **`await loadPage(routeKey)`**, catch unknown routes → reset to default.

- [ ] **Step 3: Scroll**

- After HTML paints (`tick()`), if **`slug`** set, **`document.getElementById(slug)`** inside **`.doc-body`** and **`scrollIntoView()`**; if missing, no-op.

- [ ] **Step 4: Mermaid**

Replace static import with:

```typescript
async function runMermaid(): Promise<void> {
  await tick();
  if (!document.querySelector(".doc-body pre.mermaid-doc")) return;
  const m = await import("mermaid");
  m.default.initialize({ startOnLoad: false, securityLevel: "strict" });
  await m.default.run({ querySelector: ".doc-body pre.mermaid-doc" });
}
```

Call after each successful page load.

- [ ] **Step 5: Article `data-frontmatter`**

Set on **`<article>`**:

```svelte
<article
  class="doc-body"
  data-frontmatter={JSON.stringify(page.frontmatter)}
>
```

(If JSON stringify in attribute is too heavy, use a single **`data-frontmatter`** base64 — YAGNI: stringify is fine for small YAML.)

- [ ] **Step 6: Manual smoke**

```bash
npm run dev
```

Open `http://127.0.0.1:<port>/docs/#/vision` (or your default), confirm content loads, network shows **lazy chunk** fetch on first navigation to another doc.

- [ ] **Step 7: Commit**

```bash
git add web/docs/src/App.svelte
git commit -m "feat(docs-app): hash navigation, lazy page load, lazy mermaid"
```

---

### Task 6: Sidebar tree — collapsible + icons + desktop hamburger

**Files:**

- Modify: `web/docs/src/lib/DocTreeNav.svelte`
- Modify: `web/docs/src/App.svelte` (top bar buttons)

- [ ] **Step 1: Collapse state**

- For each directory path string key, store **`expanded: boolean`** in **`sessionStorage`** (key e.g. **`fullsend-docs-tree:${path}`**) default **true** for ancestors of **`activeRouteKey`** on first render.

- [ ] **Step 2: Icons**

- Use **inline SVG** or **Unicode** (`📄`/`📁`) — prefer small inline SVG for crisp light UI. Toggle **folder-open** vs **folder-closed** when expanded.

- [ ] **Step 3: Navigation**

- File rows: call **`navigateToRouteKey(node.routeKey)`** (hash).

- [ ] **Step 4: Top bar**

- Always show **hamburger** button top-left on **all** breakpoints; toggles **`navCollapsed`** off (open) when closed.
- Sidebar header: **icon-only close** (✕ or SVG) with **`aria-label="Close outline"`**.

- [ ] **Step 5: Commit**

```bash
git add web/docs/src/lib/DocTreeNav.svelte web/docs/src/App.svelte
git commit -m "feat(docs-app): collapsible tree icons and sidebar chrome"
```

---

### Task 7: Styles — left column, scroll, admin-like palette

**Files:**

- Modify: `web/docs/src/app.css`

- [ ] **Step 1: Layout**

- **`docs-layout`:** `flex-direction: row` with **`<aside>` first** in DOM (or **`order: -1`** on sidebar) so outline is **left** without RTL surprises.
- **`docs-main`** and **`docs-sidebar` / `.docs-tree-wrap`:** both **`overflow-y: auto`**, parent **`min-height: 0`**, shell **`height: 100vh`** (or **`min-height: 100vh`** with flex fill).

- [ ] **Step 2: Palette**

Mirror admin header/buttons roughly:

```css
:root {
  --docs-border: #ccc;
  --docs-surface: #fff;
  --docs-muted-bg: #f4f4f4;
  --docs-text: #24292f;
  --docs-link: #0969da;
}
```

Apply to top bar, sidebar background, buttons.

- [ ] **Step 3: Commit**

```bash
git add web/docs/src/app.css
git commit -m "style(docs-app): left sidebar, split scroll, admin-like light theme"
```

---

### Task 8: Docs README + regression

**Files:**

- Modify: `web/docs/README.md`

- [ ] **Step 1: Document hash URLs**

State that shared links should look like **`/docs/#/<routeKey>`** and optional **`::slug`**.

- [ ] **Step 2: Full verification**

```bash
make lint
make go-test
npm run build
npx vitest run
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add web/docs/README.md
git commit -m "docs(docs-app): document hash URLs for deep linking"
```

---

## Plan self-review (spec coverage)

| Spec requirement | Task(s) |
|------------------|---------|
| Left outline, right article | Task 7 |
| Independent scroll | Task 7 |
| Icon close + hamburger (always reopen) | Task 6 |
| Collapsible tree + folder/doc icons | Task 6 |
| Admin-aligned light colors | Task 7 |
| Lazy Mermaid | Task 5 |
| Option 1 lazy chunks | Task 3 |
| Front matter not in HTML, stored as data | Task 2, Task 5 |
| Hash `#/<routeKey>::<slug>`, strip `::` from ids | Task 1, Task 2 |
| Relative / extensionless links → hash | Task 2 |
| Deep link / refresh without pathname SPA | Task 1, Task 4, Task 5 |
| Unit tests | Tasks 1–2, Task 8 |

No placeholder steps; unknown-doc and slug mismatch behaviors are defined (fallback to default doc; scroll no-op if id missing).

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-docs-browser-enhancements.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach do you want?
