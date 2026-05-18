import { describe, expect, it } from "vitest";
import type { ManifestNode } from "virtual:fullsend-docs";
import { bfsFirstRouteKeyUnderDir } from "./manifestBfsDefault";

describe("bfsFirstRouteKeyUnderDir", () => {
  it("prefers a shallow file over a file nested under an earlier subdir (BFS not DFS)", () => {
    const tree: ManifestNode[] = [
      {
        type: "dir",
        name: "root",
        children: [
          {
            type: "dir",
            name: "sub",
            children: [
              {
                type: "file",
                name: "deep.md",
                routeKey: "root/sub/deep",
                title: "Deep",
              },
            ],
          },
          {
            type: "file",
            name: "shallow.md",
            routeKey: "root/shallow",
            title: "Shallow",
          },
        ],
      },
    ];
    expect(bfsFirstRouteKeyUnderDir(tree, "root")).toBe("root/shallow");
  });

  it("returns nested file when no sibling file at shallower depth", () => {
    const tree: ManifestNode[] = [
      {
        type: "dir",
        name: "root",
        children: [
          {
            type: "dir",
            name: "sub",
            children: [
              {
                type: "file",
                name: "only.md",
                routeKey: "root/sub/only",
                title: "Only",
              },
            ],
          },
        ],
      },
    ];
    expect(bfsFirstRouteKeyUnderDir(tree, "root")).toBe("root/sub/only");
  });

  it("returns null for unknown directory path", () => {
    const tree: ManifestNode[] = [
      {
        type: "dir",
        name: "root",
        children: [],
      },
    ];
    expect(bfsFirstRouteKeyUnderDir(tree, "nope")).toBeNull();
  });
});
