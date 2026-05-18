import { describe, expect, it } from "vitest";
import type { LayerGithub } from "./githubClient";
import { analyzeConfigRepoLayer } from "./configRepo";
import type { LayerReport } from "../status/types";

const validYaml = `version: "1"
dispatch:
  platform: github-actions
defaults:
  roles: [fullsend]
  max_implementation_retries: 2
  auto_merge: false
agents: []
repos: {}
`;

function mockGh(overrides: Partial<LayerGithub>): LayerGithub {
  const base: LayerGithub = {
    getRepoExists: async () => false,
    getRepoFileUtf8: async () => null,
    repoSecretExists: async () => false,
    repoVariableExists: async () => false,
    orgSecretExists: async () => ({ kind: "ok", exists: false }),
  };
  return { ...base, ...overrides };
}

type Want = Pick<LayerReport, "status" | "wouldInstall" | "wouldFix"> & {
  details?: string[];
  detailIncludes?: string;
};

describe("analyzeConfigRepoLayer", () => {
  const cases: { name: string; gh: LayerGithub; want: Want }[] = [
    {
      name: "no repo",
      gh: mockGh({ getRepoExists: async () => false }),
      want: {
        status: "not_installed",
        details: [],
        wouldInstall: ["create .fullsend repository", "write config.yaml"],
        wouldFix: [],
      },
    },
    {
      name: "repo exists, config missing",
      gh: mockGh({
        getRepoExists: async () => true,
        getRepoFileUtf8: async () => null,
      }),
      want: {
        status: "degraded",
        details: ["repo exists but config.yaml is missing"],
        wouldFix: ["write config.yaml"],
        wouldInstall: [],
      },
    },
    {
      name: "config exists and is valid",
      gh: mockGh({
        getRepoExists: async () => true,
        getRepoFileUtf8: async () => validYaml,
      }),
      want: {
        status: "installed",
        details: ["config.yaml exists and is valid"],
        wouldInstall: [],
        wouldFix: [],
      },
    },
    {
      name: "config exists but YAML parse fails",
      gh: mockGh({
        getRepoExists: async () => true,
        getRepoFileUtf8: async () => "{\nnot yaml",
      }),
      want: {
        status: "degraded",
        wouldFix: ["rewrite config.yaml"],
        wouldInstall: [],
        detailIncludes: "config.yaml exists but is invalid",
      },
    },
    {
      name: "config exists but validation fails",
      gh: mockGh({
        getRepoExists: async () => true,
        getRepoFileUtf8: async () =>
          "version: '2'\ndispatch:\n  platform: github-actions\ndefaults:\n  roles: []\n",
      }),
      want: {
        status: "degraded",
        wouldFix: ["rewrite config.yaml"],
        wouldInstall: [],
        detailIncludes: "unsupported version",
      },
    },
  ];

  it.each(cases)("$name", async ({ gh, want }) => {
    const got = await analyzeConfigRepoLayer("acme", gh);
    expect(got.name).toBe("config-repo");
    expect(got.status).toBe(want.status);
    expect(got.wouldInstall).toEqual(want.wouldInstall);
    expect(got.wouldFix).toEqual(want.wouldFix);
    if (want.details !== undefined) {
      expect(got.details).toEqual(want.details);
    }
    if (want.detailIncludes !== undefined) {
      expect(got.details.join("\n")).toContain(want.detailIncludes);
    }
  });
});
