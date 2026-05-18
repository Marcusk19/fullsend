import { afterEach, describe, expect, it } from "vitest";
import {
  persistExpandedPathForRouteKey,
  persistExpandedPathInSession,
} from "./treeSession";

describe("persistExpandedPathInSession", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("sets expanded flag for each path prefix", () => {
    persistExpandedPathInSession("problems/applied");
    expect(sessionStorage.getItem("fullsend-docs-tree:problems")).toBe("1");
    expect(sessionStorage.getItem("fullsend-docs-tree:problems/applied")).toBe(
      "1",
    );
  });
});

describe("persistExpandedPathForRouteKey", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("expands ancestor dirs for a nested file route key", () => {
    const dirPaths = new Set(["problems", "problems/applied"]);
    persistExpandedPathForRouteKey("problems/applied/foo", dirPaths);
    expect(sessionStorage.getItem("fullsend-docs-tree:problems")).toBe("1");
    expect(sessionStorage.getItem("fullsend-docs-tree:problems/applied")).toBe(
      "1",
    );
  });

  it("no-ops for single-segment route keys", () => {
    persistExpandedPathForRouteKey("vision", new Set(["vision"]));
    expect(sessionStorage.getItem("fullsend-docs-tree:vision")).toBeNull();
  });
});
