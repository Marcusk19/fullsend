/** Must match `web/docs/src/lib/hashRoute.ts` `formatDocDirHash`. */
export function formatDocDirHash(dirPath: string): string {
  const k = dirPath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .join("/");
  if (!k) return "#/";
  return `#/${k}/`;
}
