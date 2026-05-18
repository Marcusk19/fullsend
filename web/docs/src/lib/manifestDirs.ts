import type { ManifestNode } from "virtual:fullsend-docs";

/** Every directory path under the docs manifest (e.g. `guides`, `guides/admin`). */
export function collectDirPaths(nodes: ManifestNode[]): Set<string> {
  const out = new Set<string>();

  function walk(list: ManifestNode[], parent: string): void {
    for (const node of list) {
      if (node.type !== "dir") continue;
      const path = parent ? `${parent}/${node.name}` : node.name;
      out.add(path);
      walk(node.children, path);
    }
  }

  walk(nodes, "");
  return out;
}
