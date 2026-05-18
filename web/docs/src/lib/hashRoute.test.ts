import { describe, expect, it } from "vitest";
import {
  formatDocDirHash,
  formatDocHash,
  parseDocHash,
} from "./hashRoute";

describe("parseDocHash", () => {
  it("parses file route only", () => {
    expect(parseDocHash("#/guides/admin/installation")).toEqual({
      kind: "file",
      routeKey: "guides/admin/installation",
    });
  });

  it("parses directory route with trailing slash", () => {
    expect(parseDocHash("#/guides/admin/")).toEqual({
      kind: "dir",
      dirPath: "guides/admin",
    });
  });

  it("parses file route and slug on first :: only", () => {
    expect(parseDocHash("#/a/b::my-slug")).toEqual({
      kind: "file",
      routeKey: "a/b",
      slug: "my-slug",
    });
  });

  it("rejects :: when route segment looks like a directory URL", () => {
    expect(parseDocHash("#/a/b/::my-slug")).toBeNull();
  });

  it("returns null for default", () => {
    expect(parseDocHash("")).toBeNull();
    expect(parseDocHash("#/")).toBeNull();
  });

  it("returns null for empty directory path", () => {
    expect(parseDocHash("#//")).toBeNull();
  });
});

describe("formatDocDirHash", () => {
  it("formats directory hash with single trailing slash", () => {
    expect(formatDocDirHash("problems/applied")).toBe("#/problems/applied/");
    expect(formatDocDirHash("/problems/applied/")).toBe("#/problems/applied/");
  });
});

describe("formatDocHash", () => {
  it("round-trips file routes", () => {
    const k = "guides/admin/installation";
    expect(parseDocHash(formatDocHash(k))).toEqual({
      kind: "file",
      routeKey: k,
    });
    expect(parseDocHash(formatDocHash(k, "x"))).toEqual({
      kind: "file",
      routeKey: k,
      slug: "x",
    });
  });
});
