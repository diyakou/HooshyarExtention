import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOriginalContent, hasFileBackup } from "../out/writeBackup.js";

describe("writeBackup original content tracking", () => {
  it("returns null when no backup exists", () => {
    assert.equal(getOriginalContent("non_existent_file.ts"), null);
    assert.equal(hasFileBackup("non_existent_file.ts"), false);
  });
});
