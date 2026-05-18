import { describe, it, expect } from "vitest";
import {
  normalizeSlug,
  orgRowsAndSlugFromInstallations,
  slugFromInstallation,
} from "./installationOrgRows";

describe("normalizeSlug", () => {
  it("accepts alphanumeric and hyphens within length", () => {
    expect(normalizeSlug("my-app-1")).toBe("my-app-1");
  });

  it("rejects empty and whitespace-only", () => {
    expect(normalizeSlug("")).toBeNull();
    expect(normalizeSlug("   ")).toBeNull();
  });

  it("rejects slashes dots and spaces inside slug", () => {
    expect(normalizeSlug("bad/slug")).toBeNull();
    expect(normalizeSlug("a.b")).toBeNull();
    expect(normalizeSlug("bad slug")).toBeNull();
  });

  it("rejects over 99 chars", () => {
    expect(normalizeSlug("a".repeat(100))).toBeNull();
  });

  it("rejects non-ASCII", () => {
    expect(normalizeSlug("café-app")).toBeNull();
  });
});

describe("slugFromInstallation", () => {
  it("uses nested app.slug when app_slug is invalid", () => {
    expect(
      slugFromInstallation({
        app_slug: "bad slug",
        app: { slug: "good-slug" },
      }),
    ).toBe("good-slug");
  });
});

describe("orgRowsAndSlugFromInstallations", () => {
  it("returns empty orgs and null slug for empty input", () => {
    expect(orgRowsAndSlugFromInstallations([])).toEqual({
      orgs: [],
      appSlug: null,
    });
  });

  it("ignores installations with null account for rows but still reads slug", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      { account: null, app_slug: "only-slug" },
      { account: { login: "o", type: "Organization" } },
    ]);
    expect(orgs).toEqual([{ login: "o" }]);
    expect(appSlug).toBe("only-slug");
  });

  it("returns Organization accounts sorted by login and appSlug from app_slug", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      {
        account: { login: "zebra-org", type: "Organization" },
        app_slug: "my-github-app",
      },
      {
        account: { login: "alpha-org", type: "Organization" },
        app_slug: "my-github-app",
      },
    ]);
    expect(orgs.map((o) => o.login)).toEqual(["alpha-org", "zebra-org"]);
    expect(appSlug).toBe("my-github-app");
  });

  it("treats account type as organisation case-insensitively", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      {
        account: { login: "lower-org", type: "organization" },
        app_slug: "ci-app",
      },
    ]);
    expect(orgs).toEqual([{ login: "lower-org" }]);
    expect(appSlug).toBe("ci-app");
  });

  it("drops User installations", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      {
        account: { login: "alice", type: "User" },
        app_slug: "some-app",
      },
      {
        account: { login: "real-org", type: "Organization" },
        app_slug: "some-app",
      },
    ]);
    expect(orgs).toEqual([{ login: "real-org" }]);
    expect(appSlug).toBe("some-app");
  });

  it("dedupes the same org from two installation records", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      {
        account: { login: "dup-org", type: "Organization" },
        app_slug: "dedupe-app",
      },
      {
        account: { login: "dup-org", type: "Organization" },
        app_slug: "dedupe-app",
      },
    ]);
    expect(orgs).toEqual([{ login: "dup-org" }]);
    expect(appSlug).toBe("dedupe-app");
  });

  it("uses nested app.slug when app_slug is absent", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      {
        account: { login: "nested-org", type: "Organization" },
        app: { slug: "from-nested-slug" },
      },
    ]);
    expect(orgs).toEqual([{ login: "nested-org" }]);
    expect(appSlug).toBe("from-nested-slug");
  });
});
