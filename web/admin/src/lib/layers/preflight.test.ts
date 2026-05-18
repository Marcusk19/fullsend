import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import {
  clearOAuthScopeHeaderCache,
  computePreflight,
  parseXOauthScopesHeader,
  preflightOk,
  readTokenScopesHeaderCached,
} from "./preflight";

describe("parseXOauthScopesHeader", () => {
  it("returns null for empty or missing", () => {
    expect(parseXOauthScopesHeader(undefined)).toBeNull();
    expect(parseXOauthScopesHeader("")).toBeNull();
    expect(parseXOauthScopesHeader("   ")).toBeNull();
  });

  it("splits comma-separated scopes", () => {
    expect(parseXOauthScopesHeader("repo, workflow")).toEqual(["repo", "workflow"]);
  });
});

describe("computePreflight", () => {
  it("marks skipped when granted unknown", () => {
    const r = computePreflight(["repo", "admin:org"], null);
    expect(r.skipped).toBe(true);
    expect(r.missing).toEqual([]);
    expect(preflightOk(r)).toBe(true);
  });

  it("lists missing scopes", () => {
    const r = computePreflight(["repo", "workflow"], ["repo"]);
    expect(r.skipped).toBe(false);
    expect(r.missing).toEqual(["workflow"]);
    expect(preflightOk(r)).toBe(false);
  });

  it("ok when all present", () => {
    const r = computePreflight(["repo"], ["repo", "read:org"]);
    expect(preflightOk(r)).toBe(true);
  });
});

describe("readTokenScopesHeaderCached", () => {
  it("issues one HEAD /user per access token until cache clear", async () => {
    clearOAuthScopeHeaderCache();
    const request = vi.fn().mockResolvedValue({
      headers: { "x-oauth-scopes": "repo, workflow" },
    });
    const octokit = { request } as unknown as Octokit;

    await expect(readTokenScopesHeaderCached(octokit, "tok-a")).resolves.toEqual([
      "repo",
      "workflow",
    ]);
    await readTokenScopesHeaderCached(octokit, "tok-a");
    expect(request).toHaveBeenCalledTimes(1);

    await readTokenScopesHeaderCached(octokit, "tok-b");
    expect(request).toHaveBeenCalledTimes(2);

    clearOAuthScopeHeaderCache();
    await readTokenScopesHeaderCached(octokit, "tok-a");
    expect(request).toHaveBeenCalledTimes(3);
  });
});
