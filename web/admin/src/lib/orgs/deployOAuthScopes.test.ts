import { describe, expect, it } from "vitest";
import { deployRequiredOAuthScopes } from "./deployOAuthScopes";

describe("deployRequiredOAuthScopes", () => {
  it("matches Go CollectRequiredScopes(OpInstall) dedupe", () => {
    expect([...deployRequiredOAuthScopes()]).toEqual(["repo", "workflow", "admin:org"]);
  });
});
