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
