import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import { batchOrganizationsFullsendRepoExists } from "./batchOrganizationsFullsendRepoGraphql";

function mockOctokit(request: ReturnType<typeof vi.fn>): Octokit {
  return { request } as unknown as Octokit;
}

describe("batchOrganizationsFullsendRepoExists", () => {
  it("maps repository id to true and missing repo to false", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        data: {
          o0: { repository: { id: "R1" } },
          o1: { repository: null },
        },
      },
    });
    const map = await batchOrganizationsFullsendRepoExists(mockOctokit(request), [
      "Acme",
      "Beta-Org",
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(map.get("acme")).toBe(true);
    expect(map.get("beta-org")).toBe(false);
  });

  it("maps null organization to unknown (null)", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        data: {
          o0: null,
        },
      },
    });
    const map = await batchOrganizationsFullsendRepoExists(mockOctokit(request), ["ghost"]);
    expect(map.get("ghost")).toBeNull();
  });

  it("leaves hints null when GraphQL returns errors", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        data: {},
        errors: [{ message: "Something went wrong" }],
      },
    });
    const map = await batchOrganizationsFullsendRepoExists(mockOctokit(request), ["acme"]);
    expect(map.get("acme")).toBeNull();
  });

  it("chunks requests for many orgs", async () => {
    const request = vi.fn().mockImplementation(async () => ({
      data: {
        data: Object.fromEntries(
          Array.from({ length: 10 }, (_, j) => [`o${j}`, { repository: null }]),
        ),
      },
    }));
    const logins = Array.from({ length: 25 }, (_, i) => `org${i}`);
    await batchOrganizationsFullsendRepoExists(mockOctokit(request), logins);
    expect(request).toHaveBeenCalledTimes(3);
  });
});
