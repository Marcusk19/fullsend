import { describe, expect, it } from "vitest";
import { buildEmptyInstallationsHint } from "./emptyOrgListHint";

describe("buildEmptyInstallationsHint", () => {
  it("returns non-empty guidance string", () => {
    const h = buildEmptyInstallationsHint();
    expect(h.length).toBeGreaterThan(40);
    expect(h.toLowerCase()).toContain("no github organisations");
    expect(h.toLowerCase()).toContain("fullsend");
    expect(h.toLowerCase()).toContain("add the app");
  });
});
