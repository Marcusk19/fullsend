import type { ModuleNode, Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root as MdastRoot, List, ListItem, Link, Text } from "mdast";
import {
  listDocMarkdownFiles,
  filePathToRouteKey,
  type DocsFilePath,
} from "./paths";
import { markdownToHtml } from "./markdown";

const VIRTUAL_BOOTSTRAP = "\0virtual:fullsend-docs";
const VIRTUAL_BOOTSTRAP_PUBLIC = "virtual:fullsend-docs";
const PAGE_PREFIX = "virtual:fullsend-docs/page/";
const PAGE_INTERNAL_PREFIX = "\0fullsend-docs-page:";
const SIDEBAR_PATH = "docs/sidebar.md" as const;

export type ManifestNode =
  | { type: "dir"; name: string; children: ManifestNode[] }
  | { type: "file"; name: string; routeKey: string; title: string };

/**
 * Parse docs/sidebar.md into a ManifestNode tree.
 * Each list item is either:
 *   - a link → file node (url is the docs-relative path, e.g. "guides/README.md")
 *   - plain text + nested list → dir node
 * Throws if the markdown structure is unexpected.
 */
function parseSidebarMarkdown(sidebarMd: string): ManifestNode[] {
  const mdast = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(sidebarMd) as MdastRoot;

  const topList = mdast.children.find((n) => n.type === "list") as
    | List
    | undefined;
  if (!topList) {
    throw new Error("sidebar.md: expected a top-level list");
  }

  function processItem(item: ListItem): ManifestNode {
    const para = item.children.find((c) => c.type === "paragraph");
    const nestedList = item.children.find((c) => c.type === "list") as
      | List
      | undefined;

    if (!para) {
      throw new Error("sidebar.md: list item has no paragraph");
    }

    const firstChild = (para as unknown as { children: { type: string }[] })
      .children[0];

    if (firstChild?.type === "link") {
      const link = firstChild as unknown as Link;
      const url = link.url;
      if (!url.endsWith(".md")) {
        throw new Error(`sidebar.md: link url must end with .md, got: ${url}`);
      }
      const routeKey = url.slice(0, -".md".length);
      const namePart = routeKey.split("/").at(-1)!;
      const linkText = link.children
        .filter((c) => c.type === "text")
        .map((c) => (c as unknown as Text).value)
        .join("");
      const title = linkText || namePart;
      return { type: "file", name: namePart, routeKey, title };
    }

    if (firstChild?.type === "text") {
      const name = (firstChild as unknown as Text).value.trim();
      if (!nestedList) {
        throw new Error(
          `sidebar.md: dir entry "${name}" has no nested list — did you mean to add a link?`,
        );
      }
      const children = nestedList.children.map(processItem);
      return { type: "dir", name, children };
    }

    throw new Error(
      `sidebar.md: unexpected list item content type: ${firstChild?.type ?? "none"}`,
    );
  }

  return topList.children.map(processItem);
}

/** Collect all file routeKeys from a ManifestNode tree. */
function collectRouteKeys(nodes: ManifestNode[]): string[] {
  const keys: string[] = [];
  for (const n of nodes) {
    if (n.type === "file") {
      keys.push(n.routeKey);
    } else {
      keys.push(...collectRouteKeys(n.children));
    }
  }
  return keys;
}

function isRepoDocMarkdownFile(repoRoot: string, filePath: string): boolean {
  const docsDir = path.join(repoRoot, "docs");
  const normalized = path.normalize(filePath);
  const prefix = path.normalize(`${docsDir}${path.sep}`);
  if (!normalized.startsWith(prefix)) return false;
  const ext = path.extname(normalized);
  return ext === ".md" || ext === ".markdown";
}

function generateLoadPageSource(sortedRouteKeys: string[]): string {
  const cases = sortedRouteKeys
    .map((k) => {
      // Each import() must use a string literal so Vite/Rollup can analyze it
      // (see dynamic-import-vars limitations).
      const specifier = PAGE_PREFIX + encodeURIComponent(k);
      return `    case ${JSON.stringify(k)}:\n      return (await import(${JSON.stringify(specifier)})).default;`;
    })
    .join("\n");

  return `export async function loadPage(routeKey) {
  switch (routeKey) {
${cases}
    default:
      throw new Error("Unknown doc route: " + routeKey);
  }
}
`;
}

async function loadBootstrapModule(repoRoot: string): Promise<string> {
  const sidebarAbs = path.join(repoRoot, SIDEBAR_PATH);
  if (!fs.existsSync(sidebarAbs)) {
    throw new Error(
      `docs/sidebar.md not found. Create it to define the sidebar order.`,
    );
  }

  // Read all markdown files, excluding sidebar.md itself.
  const allFiles = listDocMarkdownFiles(repoRoot).filter(
    (f) => f !== SIDEBAR_PATH,
  );

  const sidebarMd = fs.readFileSync(sidebarAbs, "utf8");
  const manifest = parseSidebarMarkdown(sidebarMd);

  // Verify every file on disk is listed in sidebar.md.
  const listedKeys = new Set(collectRouteKeys(manifest));
  const allKeys = allFiles.map((f) => filePathToRouteKey(f));
  const unlisted = allKeys.filter((k) => !listedKeys.has(k));
  if (unlisted.length > 0) {
    throw new Error(
      `sidebar.md is missing the following files:\n${unlisted.map((k) => `  docs/${k}.md`).join("\n")}`,
    );
  }

  const sortedKeys = [...listedKeys].sort((a, b) => a.localeCompare(b));

  return `export const manifest = ${JSON.stringify(manifest)};
${generateLoadPageSource(sortedKeys)}
`;
}

export function fullsendDocsPlugin(repoRoot: string): Plugin {
  return {
    name: "fullsend-docs",
    resolveId(id) {
      if (id === VIRTUAL_BOOTSTRAP_PUBLIC) return VIRTUAL_BOOTSTRAP;
      if (id.startsWith(PAGE_PREFIX)) {
        const encoded = id.slice(PAGE_PREFIX.length);
        let routeKey: string;
        try {
          routeKey = decodeURIComponent(encoded);
        } catch {
          return undefined;
        }
        return `${PAGE_INTERNAL_PREFIX}${routeKey}`;
      }
      return undefined;
    },
    async load(id) {
      if (id === VIRTUAL_BOOTSTRAP) {
        return loadBootstrapModule(repoRoot);
      }
      if (id.startsWith(PAGE_INTERNAL_PREFIX)) {
        const routeKey = id.slice(PAGE_INTERNAL_PREFIX.length);
        const rel = `docs/${routeKey}.md` as DocsFilePath;
        const abs = path.join(repoRoot, rel);
        if (!fs.existsSync(abs)) {
          return null;
        }
        const md = fs.readFileSync(abs, "utf8");
        const { title, html, frontmatter } = await markdownToHtml(
          md,
          rel,
          repoRoot,
        );
        const payload = { title, html, frontmatter };
        return `export default ${JSON.stringify(payload)};\n`;
      }
      return undefined;
    },
    configureServer(server) {
      const docsDir = path.join(repoRoot, "docs");
      if (fs.existsSync(docsDir)) {
        server.watcher.add(docsDir);
      }
    },
    handleHotUpdate({ file, server }) {
      if (!isRepoDocMarkdownFile(repoRoot, file)) return;

      const graph = server.moduleGraph;
      const hmrMods: ModuleNode[] = [];

      const bootstrap = graph.getModuleById(VIRTUAL_BOOTSTRAP);
      if (bootstrap) {
        graph.invalidateModule(bootstrap, undefined, undefined, true);
        hmrMods.push(bootstrap);
      }

      const pageIds = [...graph.idToModuleMap.keys()].filter((id) =>
        id.startsWith(PAGE_INTERNAL_PREFIX),
      );
      for (const id of pageIds) {
        const mod = graph.getModuleById(id);
        if (mod) {
          graph.invalidateModule(mod, undefined, undefined, true);
          hmrMods.push(mod);
        }
      }

      return hmrMods;
    },
  };
}
