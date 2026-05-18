import { describe, it, expect } from "vitest";
import { githubAppInstallationsNewUrl } from "./githubAppInstallLink";

describe("githubAppInstallationsNewUrl", () => {
  it("returns install URL for a valid slug", () => {
    expect(githubAppInstallationsNewUrl("my-app-1")).toBe(
      "https://github.com/apps/my-app-1/installations/new",
    );
  });

  it("trims whitespace before validating", () => {
    expect(githubAppInstallationsNewUrl("  valid-slug  ")).toBe(
      "https://github.com/apps/valid-slug/installations/new",
    );
  });

  it("returns null for empty and whitespace-only", () => {
    expect(githubAppInstallationsNewUrl("")).toBeNull();
    expect(githubAppInstallationsNewUrl("   ")).toBeNull();
  });

  it("returns null for invalid slug characters", () => {
    expect(githubAppInstallationsNewUrl("bad/slug")).toBeNull();
    expect(githubAppInstallationsNewUrl("a.b")).toBeNull();
    expect(githubAppInstallationsNewUrl("bad slug")).toBeNull();
  });

  it("returns null when slug exceeds max length", () => {
    expect(githubAppInstallationsNewUrl("a".repeat(100))).toBeNull();
  });

  it("returns null for non-ASCII", () => {
    expect(githubAppInstallationsNewUrl("café-app")).toBeNull();
  });
});
