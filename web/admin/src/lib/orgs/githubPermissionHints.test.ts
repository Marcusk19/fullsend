import { describe, expect, it } from "vitest";
import { RequestError } from "@octokit/request-error";
import {
  forbidden403HintsFromRequestError,
  humanLineFromAcceptedOAuthScopes,
  isLikelyGitHubRateLimit403,
  userGitHubRestRateLimitShortMessage,
} from "./githubPermissionHints";

describe("humanLineFromAcceptedOAuthScopes", () => {
  it("returns an actionable line when scopes are present", () => {
    const line = humanLineFromAcceptedOAuthScopes("repo, workflow");
    expect(line).toContain("repo, workflow");
    expect(line).toContain("OAuth scopes");
  });
});

describe("forbidden403HintsFromRequestError", () => {
  it("uses only browser-exposed OAuth scope headers, not GitHub-Permissions (invisible under CORS)", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: {
          "x-accepted-github-permissions": "secrets=read",
          "x-accepted-oauth-scopes": "repo",
        },
        data: { message: "Resource not accessible by integration" },
      },
    });
    expect(forbidden403HintsFromRequestError(err)).toEqual({
      missingPermissionLines: [
        "GitHub reports this API call would be allowed with these OAuth scopes: repo. Your account or token may need them, or an organisation owner may need to adjust app access.",
      ],
      githubApiMessage: "Resource not accessible by integration",
    });
  });

  it("returns empty lines when only GitHub-Permissions header is set (SPA cannot read it in real browsers)", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: {
          "x-accepted-github-permissions": "contents=read",
        },
        data: { message: "Not allowed" },
      },
    });
    expect(forbidden403HintsFromRequestError(err)).toEqual({
      missingPermissionLines: [],
      githubApiMessage: "Not allowed",
    });
  });
});

describe("isLikelyGitHubRateLimit403", () => {
  it("detects x-ratelimit-remaining: 0 when the JSON body is not a permission denial", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: { "x-ratelimit-remaining": "0" },
        data: {},
      },
    });
    expect(isLikelyGitHubRateLimit403(err)).toBe(true);
  });

  it("returns false for normal permission 403", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: { "x-ratelimit-remaining": "4999" },
        data: { message: "Resource not accessible by integration" },
      },
    });
    expect(isLikelyGitHubRateLimit403(err)).toBe(false);
  });

  it("does not treat exhausted quota + permission JSON message as rate limit", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: { "x-ratelimit-remaining": "0" },
        data: { message: "Resource not accessible by personal access token" },
      },
    });
    expect(isLikelyGitHubRateLimit403(err)).toBe(false);
  });

  it("detects primary rate limit from JSON message even when quota header is not zero", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: { "x-ratelimit-remaining": "1" },
        data: { message: "API rate limit exceeded for user ID 123" },
      },
    });
    expect(isLikelyGitHubRateLimit403(err)).toBe(true);
  });

  it("ignores Octokit error.message text (documentation_url) for heuristics", () => {
    const err = new RequestError(
      "Resource not accessible - https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api",
      403,
      {
        request: { method: "GET", url: "https://api.github.com/test", headers: {} },
        response: {
          status: 403,
          url: "https://api.github.com/test",
          headers: { "x-ratelimit-remaining": "4999" },
          data: { message: "Resource not accessible by personal access token" },
        },
      },
    );
    expect(isLikelyGitHubRateLimit403(err)).toBe(false);
  });
});

describe("userGitHubRestRateLimitShortMessage", () => {
  it("includes reset time and limit from GitHub headers", () => {
    const err = new RequestError("API rate limit exceeded", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1776944389",
          "x-ratelimit-resource": "core",
        },
        data: { message: "API rate limit exceeded for user ID 1" },
      },
    });
    const msg = userGitHubRestRateLimitShortMessage(err);
    expect(msg).toContain("5000");
    expect(msg).toContain("core");
    expect(msg).toContain("Thu, 23 Apr 2026 11:39:49 GMT");
  });

  it("falls back when reset header is missing", () => {
    const err = new RequestError("API rate limit exceeded", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: { "x-ratelimit-limit": "60" },
        data: { message: "API rate limit exceeded" },
      },
    });
    const msg = userGitHubRestRateLimitShortMessage(err);
    expect(msg).toContain("60");
    expect(msg).toContain("Wait up to an hour");
  });
});
