import assert from "node:assert/strict";
import { test } from "node:test";
import { isServerOnlySpecifier } from "../../structural/api/barrel-purity.ts";

// `api/barrel-purity` matches an entry as itself or a subpath, so a project can fence
// `@tk/core/server` while leaving the client-safe package root open. Reverting to a
// package-name comparison would silently un-fence every subpath the moment the root is
// dropped from the list.
test("a client-safe package root does not grant access to its server subpaths", () => {
  const denied = ["@tk/core/server", "pg"];
  assert.equal(isServerOnlySpecifier("@tk/core", denied), false);
  assert.equal(isServerOnlySpecifier("@tk/core/server", denied), true);
  assert.equal(isServerOnlySpecifier("@tk/core/server/private", denied), true);
  assert.equal(isServerOnlySpecifier("pg/native", denied), true);
  assert.equal(isServerOnlySpecifier("pg-extra", denied), false);
});
