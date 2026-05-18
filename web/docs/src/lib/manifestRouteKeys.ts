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
