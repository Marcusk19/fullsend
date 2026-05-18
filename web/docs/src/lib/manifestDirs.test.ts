import { describe, expect, it } from "vitest";
import { collectDirPaths } from "./manifestDirs";
import type { ManifestNode } from "virtual:fullsend-docs";

describe("collectDirPaths", () => {
  it("collects nested dir paths with posix segments", () => {
    const tree: ManifestNode[] = [
      {
        type: "dir",
        name: "guides",
        children: [
          {
            type: "dir",
            name: "admin",
            children: [
              {
                type: "file",
                name: "installation",
                routeKey: "guides/admin/installation",
                title: "Install",
              },
            ],
          },
        ],
      },
    ];
    expect(collectDirPaths(tree)).toEqual(new Set(["guides", "guides/admin"]));
  });
});
