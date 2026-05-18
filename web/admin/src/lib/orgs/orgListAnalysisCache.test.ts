import { describe, expect, it } from "vitest";
import type { OrgListAnalysisOk } from "./orgListRow";
import {
  clearOrgListAnalysisCache,
  getOrgListAnalysisCached,
  hasOrgListAnalysisCacheEntry,
  invalidateOrgListAnalysisCacheEntry,
  setOrgListAnalysisCached,
} from "./orgListAnalysisCache";

const sampleOk = (): OrgListAnalysisOk => ({
  kind: "ok",
  rollup: "not_installed",
  reports: [],
});

describe("orgListAnalysisCache", () => {
  it("normalises org keys", () => {
    clearOrgListAnalysisCache();
    setOrgListAnalysisCached("Acme", sampleOk());
    expect(hasOrgListAnalysisCacheEntry("acme")).toBe(true);
    expect(getOrgListAnalysisCached("ACME")?.kind).toBe("ok");
    invalidateOrgListAnalysisCacheEntry("acme");
    expect(hasOrgListAnalysisCacheEntry("acme")).toBe(false);
  });

  it("clear removes all entries", () => {
    clearOrgListAnalysisCache();
    setOrgListAnalysisCached("a", sampleOk());
    setOrgListAnalysisCached("b", sampleOk());
    clearOrgListAnalysisCache();
    expect(hasOrgListAnalysisCacheEntry("a")).toBe(false);
    expect(hasOrgListAnalysisCacheEntry("b")).toBe(false);
  });
});
