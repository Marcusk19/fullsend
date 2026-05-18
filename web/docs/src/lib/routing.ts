import { formatDocHash, parseDocHash, type ParsedDocHash } from "./hashRoute";

const LAST_DOC_ROUTE_KEY = "fullsend-docs-last-doc-route";

export function getParsedDocHashFromWindow(): ParsedDocHash | null {
  return parseDocHash(window.location.hash);
}

/** @deprecated Prefer {@link getParsedDocHashFromWindow}. */
export function getDocRouteFromWindow(): ParsedDocHash | null {
  return getParsedDocHashFromWindow();
}

export function persistLastDocRouteKey(routeKey: string): void {
  try {
    sessionStorage.setItem(LAST_DOC_ROUTE_KEY, routeKey);
  } catch {
    /* quota or private mode */
  }
}

export function readLastDocRouteKey(): string | null {
  try {
    return sessionStorage.getItem(LAST_DOC_ROUTE_KEY);
  } catch {
    return null;
  }
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
