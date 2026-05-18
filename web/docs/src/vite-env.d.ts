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

  export type DocPagePayload = {
    title: string;
    html: string;
    frontmatter: Record<string, unknown>;
  };

  export const manifest: ManifestNode[];
  export function loadPage(routeKey: string): Promise<DocPagePayload>;
}
