# Docs browser SPA (`/docs/`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a **Vite + Svelte 5** docs browser under **`/docs/`** that renders the repository’s **`docs/**/*.md`** at build time (GFM + client Mermaid), with a **right-hand collapsible tree** and URLs mirroring file paths, sharing **one Vite dev server and one `vite build`** with the existing admin SPA.

**Architecture:** A **Node-side pipeline** (invoked from a **Vite plugin**) scans `docs/`, applies an **identity filter** (extension point for future deny rules), compiles Markdown to HTML with **remark/rehype + GFM**, rewrites **relative `.md` links** to **`/docs/...`**, and exposes a **virtual module** (`virtual:fullsend-docs`) exporting **`manifest`** (tree) and **`pages`** (route key → `{ title, html }`). The docs SPA uses **History API** routing (pathname under `/docs/`), a **main article pane** (`{@html}` with **rehype-sanitize**), and **mermaid** on **`.mermaid-doc`** blocks. Vite **`root`** becomes **`web/`**, **`base: '/'`**, **two HTML entries** (`admin/`, `docs/`), **dev middleware** for SPA fallbacks, **shared `dist/assets/`**. CI copies **`dist/assets`**, **`dist/admin`**, **`dist/docs`** into **`_bundle/public/`**.

**Tech Stack:** Svelte 5, Vite 6, Vitest, **unified + remark-parse + remark-gfm + remark-rehype + rehype-stringify + rehype-sanitize**, **unist-util-visit**, **mermaid** (browser), TypeScript. **No** SvelteKit.

**Spec:** [2026-05-04-docs-browser-design.md](../specs/2026-05-04-docs-browser-design.md)

**Branch:** Work on **`feat/docs-browser-spa-spec`** (or rebase from it) so the spec commit stays off `main` until merge.

**Implementation status:** Tasks **1–8** are implemented on `feat/docs-browser-spa-spec`. Step checkboxes below are marked complete except **Task 8 Step 2** (optional preview deep-link smoke test — same static SPA fallback as `/admin/` is assumed).

---

## File map

| File / directory | Responsibility |
|------------------|----------------|
| `package.json` | Add remark/rehype/unified deps + `mermaid`; ensure `build` still one command |
| `vite.config.ts` | `root: web`, `base: '/'`, multi-input HTML, SPA fallback middleware, `virtual:fullsend-docs` plugin, Vitest globs + `environmentMatchGlobs`, proxy `/api` unchanged |
| `web/admin/index.html` | `./src/main.ts` entry path |
| `web/admin/src/lib/auth/oauth.ts` | `adminAppBasePath()` returns fixed `/admin/` (no `import.meta.env.BASE`) |
| `web/admin/src/vite-env.d.ts` | Comment update for `base: '/'` |
| `web/docs/index.html` | Vite HTML entry for docs app |
| `web/docs/svelte.config.js` | Same `vitePreprocess` pattern as admin |
| `web/docs/tsconfig.json` | TS for docs app + virtual module types |
| `web/docs/src/vite-env.d.ts` | `virtual:fullsend-docs` module declaration |
| `web/docs/src/main.ts` | Mount shell Svelte app |
| `web/docs/src/app.css` | Doc typography, layout, sidebar |
| `web/docs/src/App.svelte` | Shell: main pane + right tree, routing, Mermaid after update |
| `web/docs/src/lib/docUrls.ts` | **Browser-only** `pathnameToRouteKey` / `routeKeyToUrl` (duplicate string logic from `build/paths.ts` — do **not** import `paths.ts` in client code; it pulls `node:fs`) |
| `web/docs/src/lib/routing.ts` | Sync route from `location`, `navigateToRouteKey`, default doc fallback |
| `web/docs/src/lib/tree.ts` | Build sidebar tree from manifest (pure) |
| `web/docs/build/paths.ts` | `listDocMarkdownFiles`, `fileToRouteKey`, `routeKeyToUrl`, filter hook export |
| `web/docs/build/paths.test.ts` | Vitest **node**: path ↔ URL, README.md, nested paths |
| `web/docs/build/markdown.ts` | `markdownToHtml`, remark pipeline, link rewrite, mermaid `<pre>` shaping |
| `web/docs/build/markdown.test.ts` | Vitest **node**: GFM table, internal link rewrite, mermaid fence |
| `web/docs/build/vitePluginDocs.ts` | `fullsendDocsPlugin()`, virtual module, watch `docs/**/*.md` in dev |
| `.github/workflows/site-build.yml` | Copy `web/dist/assets`, `web/dist/admin`, `web/dist/docs` into `_bundle/public/` |
| `docs/site-deployment.md` | Document new layout + local preview commands |
| `web/docs/README.md` | Dev URL, scope, link to spec |

---

### Task 1: Dependencies

**Files:**

- Modify: `package.json`

- [x] **Step 1: Add runtime + dev dependencies**

Run:

```bash
cd path/to/your/fullsend/clone
npm install unified remark-parse remark-gfm remark-rehype rehype-stringify rehype-sanitize unist-util-visit mermaid
npm install -D @types/mdast @types/hast
```

Expected: `package.json` and `package-lock.json` update with no peer conflicts (Node ≥22 per `engines`).

- [x] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(docs-app): add remark/rehype and mermaid dependencies"
```

---

### Task 2: Pure path + URL helpers (`web/docs/build/paths.ts`)

**Files:**

- Create: `web/docs/build/paths.ts`
- Create: `web/docs/build/paths.test.ts`

**Contract (v1):**

- **Route key:** POSIX-style path relative to `docs/` **without** leading `./`, **without** `.md` suffix (e.g. `guides/admin/installation`). For `docs/foo/README.md` the key is `foo/README` (keep literal `README` segment so URLs stay unambiguous).
- **URL:** `/docs/<routeKey>` with no trailing slash for document pages (match admin-style paths; be consistent in the tree `href`).

- [x] **Step 1: Write `web/docs/build/paths.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";

/** Repo-relative POSIX path using `/` (e.g. `docs/guides/x.md`). */
export type DocsFilePath = `docs/${string}`;

export type DocPathFilter = (repoRelativeMd: DocsFilePath) => boolean;

const defaultFilter: DocPathFilter = () => true;

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Lists `docs/**/*.md` from repo root. Applies `filter` after glob (v1: identity).
 * Future: swap `filter` for deny-glob or config-driven predicate without changing callers.
 */
export function listDocMarkdownFiles(
  repoRoot: string,
  filter: DocPathFilter = defaultFilter,
): DocsFilePath[] {
  const docsRoot = path.join(repoRoot, "docs");
  const out: DocsFilePath[] = [];

  function walk(dir: string) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name.endsWith(".md")) {
        const rel = toPosix(path.relative(repoRoot, abs));
        if (!rel.startsWith("docs/")) continue;
        if (filter(rel as DocsFilePath)) out.push(rel as DocsFilePath);
      }
    }
  }

  if (fs.existsSync(docsRoot)) walk(docsRoot);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/** `docs/guides/admin/installation.md` → `guides/admin/installation` */
export function filePathToRouteKey(repoRelativeMd: DocsFilePath): string {
  const withoutPrefix = repoRelativeMd.slice("docs/".length);
  if (!withoutPrefix.endsWith(".md")) {
    throw new Error(`Expected .md file, got: ${repoRelativeMd}`);
  }
  return withoutPrefix.slice(0, -".md".length);
}

/** `guides/admin/installation` → `/docs/guides/admin/installation` */
export function routeKeyToUrl(routeKey: string): string {
  const k = routeKey.replace(/^\/+/, "");
  return `/docs/${k}`;
}

/**
 * Strip `/docs` prefix from pathname; empty string means "root doc" (redirect to a default in UI).
 * `/docs/guides/x` → `guides/x`
 */
export function pathnameToRouteKey(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (!p.startsWith("/docs")) return "";
  const rest = p.slice("/docs".length).replace(/^\/+/, "");
  return rest;
}
```

- [x] **Step 2: Write failing tests `web/docs/build/paths.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import {
  filePathToRouteKey,
  listDocMarkdownFiles,
  pathnameToRouteKey,
  routeKeyToUrl,
} from "./paths";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("paths", () => {
  it("filePathToRouteKey strips docs/ and .md", () => {
    expect(filePathToRouteKey("docs/guides/admin/installation.md")).toBe(
      "guides/admin/installation",
    );
    expect(filePathToRouteKey("docs/README.md")).toBe("README");
  });

  it("routeKeyToUrl", () => {
    expect(routeKeyToUrl("guides/admin/installation")).toBe(
      "/docs/guides/admin/installation",
    );
  });

  it("pathnameToRouteKey", () => {
    expect(pathnameToRouteKey("/docs/guides/admin/installation")).toBe(
      "guides/admin/installation",
    );
    expect(pathnameToRouteKey("/docs/")).toBe("");
  });

  it("listDocMarkdownFiles respects filter", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fullsend-docs-"));
    fs.mkdirSync(path.join(tmp, "docs", "a"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "docs", "a", "x.md"), "# x\n");
    fs.writeFileSync(path.join(tmp, "docs", "skip.md"), "# s\n");

    const all = listDocMarkdownFiles(tmp);
    expect(all).toContain("docs/a/x.md");
    expect(all).toContain("docs/skip.md");

    const filtered = listDocMarkdownFiles(tmp, (p) => p !== "docs/skip.md");
    expect(filtered).toContain("docs/a/x.md");
    expect(filtered).not.toContain("docs/skip.md");
  });
});
```

- [x] **Step 3: Defer test run**

Run **`npm test`** only **after** Task 4 (Vitest `include` / `environmentMatchGlobs`) **and** Task 5 (admin entry fixes). Expected: **`docs/build/**/*.test.ts`** runs in the **`node`** environment and **PASS**s.

- [x] **Step 4: Commit** (optional: squash with Tasks 3–5)

```bash
git add web/docs/build/paths.ts web/docs/build/paths.test.ts
git commit -m "feat(docs-app): path helpers and listDocMarkdownFiles with filter hook"
```

---

### Task 3: Markdown pipeline (`web/docs/build/markdown.ts`)

**Files:**

- Create: `web/docs/build/markdown.ts`
- Create: `web/docs/build/markdown.test.ts`

- [x] **Step 1: Implement `web/docs/build/markdown.ts`**

```typescript
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { visit } from "unist-util-visit";
import path from "node:path";
import { toString } from "mdast-util-to-string";
import type { Root as MdastRoot } from "mdast";
import type { Element, Root as HastRoot } from "hast";
import { filePathToRouteKey, routeKeyToUrl, type DocsFilePath } from "./paths";

/** Derive display title: first heading text, else route last segment. */
export function extractTitle(mdast: MdastRoot, routeKey: string): string {
  let heading: string | null = null;
  visit(mdast, "heading", (node) => {
    if (heading === null && node.depth === 1) {
      heading = toString(node).trim();
    }
  });
  if (heading) return heading;
  const base = routeKey.split("/").pop() ?? routeKey;
  return base === "README" ? routeKey.split("/").slice(-2, -1)[0] ?? "README" : base;
}

function remarkRewriteMdLinks(sourceFile: DocsFilePath) {
  return (tree: MdastRoot) => {
    visit(tree, "link", (node) => {
      const url = node.url;
      if (!url || /^(https?:|mailto:|#)/i.test(url)) return;

      const [pathPart, frag] = url.split("#", 2);
      if (!pathPart.endsWith(".md") && !pathPart.endsWith(".markdown")) return;

      const dir = path.posix.dirname(filePathToRouteKey(sourceFile));
      const resolvedPosix = path.posix.normalize(
        path.posix.join(dir === "." ? "" : dir, pathPart),
      );
      const key = resolvedPosix.endsWith(".md")
        ? resolvedPosix.slice(0, -".md".length)
        : resolvedPosix.replace(/\.markdown$/, "");
      let href = routeKeyToUrl(key);
      if (frag) href += `#${frag}`;
      node.url = href;
    });
  };
}

/** After remark-rehype: turn `pre > code.language-mermaid` into Mermaid-friendly structure. */
function rehypeMermaidClass() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || !parent || typeof index !== "number") return;
      const child = node.children[0] as Element | undefined;
      if (!child || child.tagName !== "code") return;
      const cls = Array.isArray(child.properties.className)
        ? child.properties.className
        : [];
      const lang = cls.find((c) => String(c).startsWith("language-"));
      if (lang !== "language-mermaid") return;
      node.properties.className = ["mermaid-doc"];
      const text = child.children[0];
      if (text && text.type === "text" && typeof text.value === "string") {
        node.children = [{ type: "text", value: text.value }];
      }
    });
  };
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      "className",
      "class",
    ],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className", "class"],
    span: [...(defaultSchema.attributes?.span ?? []), "className", "class"],
  },
};

export async function markdownToHtml(
  markdown: string,
  sourceFile: DocsFilePath,
): Promise<{ title: string; html: string }> {
  const routeKey = filePathToRouteKey(sourceFile);
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRewriteMdLinks(sourceFile))
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeMermaidClass)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);

  const file = await processor.process(markdown);
  const html = String(file);
  const mdast = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MdastRoot;
  const title = extractTitle(mdast, routeKey);
  return { title, html };
}
```

- [x] **Step 2: Add dependency for title extraction**

Run:

```bash
npm install mdast-util-to-string
```

- [x] **Step 3: Write `web/docs/build/markdown.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./markdown";

describe("markdownToHtml", () => {
  it("renders GFM table", async () => {
    const md = "|a|b|\n|-|-|\n|1|2|\n";
    const { html } = await markdownToHtml(md, "docs/test.md");
    expect(html).toContain("<table");
    expect(html).toContain("1");
  });

  it("rewrites relative md link to /docs/ URL", async () => {
    const md = "[x](./other.md)";
    const { html } = await markdownToHtml(md, "docs/guides/admin/installation.md");
    expect(html).toContain('href="/docs/guides/admin/other"');
  });

  it("marks mermaid fence for client render", async () => {
    const md = "```mermaid\nflowchart LR\n  A-->B\n```\n";
    const { html } = await markdownToHtml(md, "docs/a.md");
    expect(html).toContain('class="mermaid-doc"');
    expect(html).toContain("flowchart");
  });
});
```

- [x] **Step 4: Defer test run** — same as Task 2: run **`npm test`** after Tasks 4–5.

- [x] **Step 5: Commit**

```bash
git add web/docs/build/markdown.ts web/docs/build/markdown.test.ts package.json package-lock.json
git commit -m "feat(docs-app): remark/rehype markdown pipeline with GFM, links, mermaid pre"
```

---

### Task 4: Vite plugin + `vite.config.ts` restructuring

**Files:**

- Create: `web/docs/build/vitePluginDocs.ts`
- Modify: `vite.config.ts`

- [x] **Step 1: Write `web/docs/build/vitePluginDocs.ts`**

```typescript
import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listDocMarkdownFiles, filePathToRouteKey } from "./paths";
import { markdownToHtml } from "./markdown";
import type { DocsFilePath } from "./paths";

const VIRTUAL_ID = "\0virtual:fullsend-docs";
const RESOLVED_VIRTUAL = "virtual:fullsend-docs";

export type ManifestNode =
  | { type: "dir"; name: string; children: ManifestNode[] }
  | { type: "file"; name: string; routeKey: string; title: string };

function buildTree(
  paths: { routeKey: string; title: string; segments: string[] }[],
): ManifestNode[] {
  type Dir = { type: "dir"; name: string; children: Map<string, Dir | ManifestNode> };
  const root: Dir = { type: "dir", name: "", children: new Map() };

  function ensureDir(d: Dir, name: string): Dir {
    let next = d.children.get(name) as Dir | undefined;
    if (!next) {
      next = { type: "dir", name, children: new Map() };
      d.children.set(name, next);
    }
    if (next.type !== "dir") throw new Error(`not a dir: ${name}`);
    return next;
  }

  for (const p of paths) {
    let d = root;
    const segs = p.segments;
    for (let i = 0; i < segs.length - 1; i++) {
      d = ensureDir(d, segs[i]!);
    }
    const leafName = segs[segs.length - 1]!;
    d.children.set(leafName, {
      type: "file",
      name: leafName,
      routeKey: p.routeKey,
      title: p.title,
    });
  }

  function toManifest(dir: Dir): ManifestNode[] {
    const nodes: ManifestNode[] = [];
    for (const [name, ch] of [...dir.children.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if ("children" in ch && ch.type === "dir") {
        nodes.push({
          type: "dir",
          name,
          children: toManifest(ch),
        });
      } else {
        nodes.push(ch as ManifestNode);
      }
    }
    return nodes;
  }

  return toManifest(root);
}

export function fullsendDocsPlugin(repoRoot: string): Plugin {
  return {
    name: "fullsend-docs",
    resolveId(id) {
      if (id === RESOLVED_VIRTUAL) return VIRTUAL_ID;
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null;
      return loadVirtualModule(repoRoot);
    },
    configureServer(server) {
      const docsGlob = path.join(repoRoot, "docs");
      server.watcher.add(path.join(docsGlob, "**/*.md"));
    },
  };
}

async function loadVirtualModule(repoRoot: string): Promise<string> {
  const files = listDocMarkdownFiles(repoRoot);
  const pages: Record<string, { title: string; html: string }> = {};
  const meta: { routeKey: string; title: string; segments: string[] }[] = [];

  for (const f of files) {
    const abs = path.join(repoRoot, f);
    const md = fs.readFileSync(abs, "utf8");
    const { title, html } = await markdownToHtml(md, f as DocsFilePath);
    const routeKey = filePathToRouteKey(f as DocsFilePath);
    pages[routeKey] = { title, html };
    meta.push({
      routeKey,
      title,
      segments: routeKey.split("/").filter(Boolean),
    });
  }

  meta.sort((a, b) => a.routeKey.localeCompare(b.routeKey));
  const manifest = buildTree(meta);

  return `export const manifest = ${JSON.stringify(manifest)};\nexport const pages = ${JSON.stringify(pages)};\n`;
}
```

- [x] **Step 2: Replace `vite.config.ts` with multi-app config**

Use this structure (merge existing admin debug plugins as needed):

```typescript
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProxyOptions } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { fullsendDocsPlugin } from "./web/docs/build/vitePluginDocs";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(repoRoot, "web");

const debugProxy = process.env.ADMIN_DEBUG_PROXY === "1";

function spaFallbackPlugin(): Plugin {
  return {
    name: "fullsend-spa-fallback",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url.startsWith("/admin/") && !path.extname(url)) {
          req.url = "/admin/index.html";
        } else if (url.startsWith("/docs/") && !path.extname(url)) {
          req.url = "/docs/index.html";
        }
        next();
      });
    },
  };
}

function adminDevEnvLogPlugin(): Plugin {
  return {
    name: "admin-dev-env-log",
    configResolved(config) {
      if (config.command !== "serve" || process.env.VITEST) return;
      if (debugProxy) {
        console.info(
          "\n[fullsend] ADMIN_DEBUG_PROXY=1 — logging Vite requests and /api → Worker proxy traffic.\n",
        );
      }
    },
  };
}

function adminRequestLogPlugin(): Plugin {
  return {
    name: "admin-request-log",
    configureServer(server) {
      if (!debugProxy) return;
      server.middlewares.use((req, _res, next) => {
        console.info("[vite] request", req.method, req.url);
        next();
      });
    },
  };
}

function apiProxy(): ProxyOptions {
  const base: ProxyOptions = {
    target: "http://127.0.0.1:8787",
    changeOrigin: true,
  };
  if (!debugProxy) return base;
  return {
    ...base,
    configure(proxy) {
      proxy.on("error", (err, req) => {
        console.error("[vite-proxy] error", req?.url, err.message);
      });
      proxy.on("proxyReq", (_proxyReq, req) => {
        console.info("[vite-proxy] → Worker", req.method, req.url);
      });
      proxy.on("proxyRes", (proxyRes, req) => {
        console.info(
          "[vite-proxy] ← Worker",
          proxyRes.statusCode,
          req.url,
        );
      });
    },
  };
}

export default defineConfig(() => ({
  root: webRoot,
  base: "/",
  publicDir: false,
  plugins: [
    svelte(),
    fullsendDocsPlugin(repoRoot),
    spaFallbackPlugin(),
    adminDevEnvLogPlugin(),
    adminRequestLogPlugin(),
  ],
  build: {
    rollupOptions: {
      input: {
        admin: path.join(webRoot, "admin/index.html"),
        docs: path.join(webRoot, "docs/index.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": apiProxy(),
    },
  },
  test: {
    environment: "jsdom",
    environmentMatchGlobs: [["docs/build/**/*.test.ts", "node"]],
    include: ["admin/src/**/*.test.ts", "docs/build/**/*.test.ts"],
    passWithNoTests: true,
  },
}));
```

**Note:** Setting `publicDir: false` avoids Vite serving a non-existent `web/public` as static; the site’s static root **`web/public/index.html`** is still copied by CI separately (unchanged). If you need a shared static dir under `web/`, set `publicDir: path.join(webRoot, 'static')` and move files — **YAGNI:** keep CI copy of `web/public/index.html` as today.

- [x] **Step 3: Run admin unit tests**

```bash
npm test
```

Expected: all Vitest suites **PASS** (admin + docs build tests).

- [x] **Step 4: Commit**

```bash
git add vite.config.ts web/docs/build/vitePluginDocs.ts
git commit -m "feat(docs-app): Vite multi-entry root web/ + fullsend-docs virtual module"
```

---

### Task 5: Minimal admin adjustments

**Files:**

- Modify: `web/admin/index.html`
- Modify: `web/admin/src/lib/auth/oauth.ts`
- Modify: `web/admin/src/vite-env.d.ts`

- [x] **Step 1: `web/admin/index.html` script src**

```html
<script type="module" src="./src/main.ts"></script>
```

- [x] **Step 2: `adminAppBasePath()` — always `/admin/`**

Replace the body of `adminAppBasePath` with:

```typescript
function adminAppBasePath(): string {
  return DEFAULT_ADMIN_BASE;
}
```

Remove or shorten the `import.meta.env.BASE` comment block above it; keep `DEFAULT_ADMIN_BASE` as the single source of truth.

- [x] **Step 3: Update `web/admin/src/vite-env.d.ts` comment**

State that production assets use **`base: '/'`** at the Vite project level and the admin app’s **public path** remains **`/admin/`** for OAuth and routing.

- [x] **Step 4: Run tests and `npm run build`**

```bash
npm test
npm run build
```

Expected: **PASS**; `web/dist/admin/index.html` and `web/dist/docs/index.html` exist; `web/dist/assets/` contains hashed chunks.

- [x] **Step 5: Commit**

```bash
git add web/admin/index.html web/admin/src/lib/auth/oauth.ts web/admin/src/vite-env.d.ts
git commit -m "fix(admin): adapt to Vite root web/ and base / for shared build"
```

---

### Task 6: Docs Svelte app (shell, routing, Mermaid)

**Files:**

- Create: `web/docs/index.html`
- Create: `web/docs/svelte.config.js`
- Create: `web/docs/tsconfig.json`
- Create: `web/docs/src/vite-env.d.ts`
- Create: `web/docs/src/main.ts`
- Create: `web/docs/src/app.css`
- Create: `web/docs/src/App.svelte`
- Create: `web/docs/src/lib/docUrls.ts`
- Create: `web/docs/src/lib/routing.ts`
- Create: `web/docs/src/lib/tree.ts`

- [x] **Step 1: `web/docs/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fullsend docs</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

- [x] **Step 2: `web/docs/svelte.config.js`** (copy pattern from admin)

```javascript
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default { preprocess: vitePreprocess() };
```

- [x] **Step 3: `web/docs/tsconfig.json`**

```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.svelte"]
}
```

- [x] **Step 4: `web/docs/src/vite-env.d.ts`**

```typescript
/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module "virtual:fullsend-docs" {
  export type ManifestNode =
    | { type: "dir"; name: string; children: ManifestNode[] }
    | {
        type: "file";
        name: string;
        routeKey: string;
        title: string;
      };

  export const manifest: ManifestNode[];
  export const pages: Record<string, { title: string; html: string }>;
}
```

- [x] **Step 5: `web/docs/src/lib/docUrls.ts`** (browser-safe; mirrors `build/paths.ts` string helpers only)

```typescript
/** Same rules as `web/docs/build/paths.ts` — duplicated to avoid bundling `node:fs` in the client. */

export function pathnameToRouteKey(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (!p.startsWith("/docs")) return "";
  const rest = p.slice("/docs".length).replace(/^\/+/, "");
  return rest;
}

export function routeKeyToUrl(routeKey: string): string {
  const k = routeKey.replace(/^\/+/, "");
  return `/docs/${k}`;
}
```

- [x] **Step 6: `web/docs/src/lib/routing.ts`**

```typescript
import { pathnameToRouteKey, routeKeyToUrl } from "./docUrls";

export function getRouteKeyFromLocation(): string {
  return pathnameToRouteKey(window.location.pathname);
}

export function navigateToRouteKey(key: string): void {
  const url = key === "" ? "/docs/" : routeKeyToUrl(key);
  if (url !== window.location.pathname) {
    history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

export function defaultRouteKey(
  pages: Record<string, unknown>,
): string | null {
  const keys = Object.keys(pages).sort((a, b) => a.localeCompare(b));
  const vision = keys.find((k) => k === "vision");
  if (vision) return vision;
  return keys[0] ?? null;
}
```

- [x] **Step 7: `web/docs/src/lib/tree.ts`** — optional helpers to flatten manifest for active highlight (implement as needed).

- [x] **Step 8: `web/docs/src/main.ts`**

```typescript
import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

mount(App, { target: document.getElementById("app")! });
```

- [x] **Step 9: `web/docs/src/App.svelte`** (minimal working shell)

Use Svelte 5 runes:

- `import { manifest, pages } from 'virtual:fullsend-docs'`
- State: `routeKey` synced from `getRouteKeyFromLocation()` on load + `popstate`
- If `routeKey` missing in `pages`, redirect to `defaultRouteKey(pages)` via `replaceState`
- Main column: `{@html pages[routeKey].html}` inside a `<article class="doc-body">` **after** trusting sanitize — document that content is build-time only
- `onMount` + `$effect` or `tick` + `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })` then `await mermaid.run({ querySelector: '.doc-body pre.mermaid-doc' })` (selector must match `rehypeMermaidClass`: **`pre.mermaid-doc`**)
- Right sidebar: recursive `{#each}` over `manifest`; file nodes call `navigateToRouteKey`
- Collapse: `localStorage` key e.g. `fullsend-docs-nav-collapsed` boolean
- Narrow viewport: toggle button to show/hide sidebar (CSS `@media`)

- [x] **Step 10: `web/docs/src/app.css`** — flex row (main | aside), readable max-width, `pre` overflow

- [x] **Step 11: `package.json` `check` script** — extend to run `svelte-check` for **`web/docs/tsconfig.json`** as well as admin (or add `check:docs`), so CI-style typing catches docs Svelte errors.

- [x] **Step 12: Manual dev check**

```bash
npm run dev
```

Open `http://127.0.0.1:5173/docs/` and `http://127.0.0.1:5173/admin/` — both should load; follow an internal doc link; confirm Mermaid renders on a page under `docs/ADRs/`.

- [x] **Step 13: Commit**

```bash
git add web/docs/ package.json
git commit -m "feat(docs-app): Svelte shell, tree nav, mermaid, virtual docs data"
```

---

### Task 7: CI bundle + deployment docs

**Files:**

- Modify: `.github/workflows/site-build.yml`
- Modify: `docs/site-deployment.md`

- [x] **Step 1: Update `site-build.yml` “Prepare deploy bundle”**

After `npm run build`, replace the copy block with:

```yaml
      - name: Prepare deploy bundle
        run: |
          set -euo pipefail
          mkdir -p _bundle/public
          cp web/public/index.html _bundle/public/index.html
          mkdir -p _bundle/public/assets
          cp -a web/dist/assets/. _bundle/public/assets/
          mkdir -p _bundle/public/admin
          cp -a web/dist/admin/. _bundle/public/admin/
          mkdir -p _bundle/public/docs
          cp -a web/dist/docs/. _bundle/public/docs/
          mkdir -p _bundle/worker
          cp -a cloudflare_site/worker/. _bundle/worker/
```

- [x] **Step 2: Update `docs/site-deployment.md`** — document **`_bundle/public/assets/`**, **`/docs/`** app, and local preview commands mirroring CI (copy `web/dist/*` into `cloudflare_site/public/` including **`assets`**, **`admin`**, **`docs`**).

- [x] **Step 3: `make lint`**

```bash
make lint
```

Expected: **PASS**.

- [x] **Step 4: Commit**

```bash
git add .github/workflows/site-build.yml docs/site-deployment.md
git commit -m "ci(site): bundle shared Vite assets plus admin and docs SPAs"
```

---

### Task 8: Docs app README + Worker smoke note

**Files:**

- Create: `web/docs/README.md`

- [x] **Step 1: Write `web/docs/README.md`** — link to design spec, `npm run dev` URLs, note **`/api`** is irrelevant here.

- [ ] **Step 2: Worker verification** — load a preview deployment `/docs/guides/...` deep link; if static asset routing fails, add a one-line note to `docs/site-deployment.md` or `cloudflare_site/wrangler.toml` comment (no Worker code required for v1 per spec).

- [x] **Step 3: Commit**

```bash
git add web/docs/README.md
git commit -m "docs(web): README for docs browser app"
```

---

## Plan self-review (spec coverage)

| Spec section | Tasks |
|--------------|-------|
| Single Vite, `root: web`, `base: '/'`, two HTML entries, SPA fallback | Task 4 |
| Shared `/assets/` + CI copy | Task 7 |
| Admin minimal changes | Task 5 |
| Build-time GFM + Mermaid client | Tasks 1–3, 6 |
| Manifest tree + full docs tree + filter hook | Tasks 2–3 (`listDocMarkdownFiles`), plugin |
| Routing `/docs/<routeKey>` | Tasks 2, 6 |
| Right collapsible nav + main pane | Task 6 |
| Link rewriting to `/docs/` | Task 3 |
| Testing (paths, markdown) | Tasks 2–3 |
| Deploy + site-deployment doc | Task 7 |
| Worker: no new API | (verify only) Task 8 |

**Placeholder scan:** None intentional; follow-up fixes belong in implementation if `rehype-sanitize` strips needed GFM nodes (extend schema) or Mermaid selector mismatches.

**Type consistency:** `ManifestNode` duplicated in plugin and `vite-env.d.ts` — keep shapes identical or import a shared `types.ts` in a small follow-up if drift appears.

---

**Plan saved to `docs/superpowers/plans/2026-05-04-docs-browser-spa.md`.** Execution used **subagent-driven development** (tasks 1–8); optional **Task 8 Step 2** (preview Worker smoke) remains open if you want an explicit production/preview check.
