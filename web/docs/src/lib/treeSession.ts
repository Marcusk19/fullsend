/** Keys match `DocTreeNav` (`fullsend-docs-tree:${dirPath}`). */
const TREE_KEY_PREFIX = "fullsend-docs-tree:";

/** Mark `dirPath` and every ancestor as expanded (`"1"`) so the tree can open once without forcing expansion on every render. */
export function persistExpandedPathInSession(dirPath: string): void {
  const segments = dirPath.split("/").filter(Boolean);
  let acc = "";
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg;
    try {
      sessionStorage.setItem(`${TREE_KEY_PREFIX}${acc}`, "1");
    } catch {
      /* quota / private mode */
    }
  }
}

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
