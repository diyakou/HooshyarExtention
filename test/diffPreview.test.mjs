import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInlineDiffPreview } from "../out/inlineDiff.js";

describe("buildInlineDiffPreview", () => {
  it("shows new file preview", () => {
    const preview = buildInlineDiffPreview("README.md", "", "# Title\nHello");
    assert.match(preview, /New file/);
    assert.match(preview, /\+ # Title/);
  });

  it("shows changed lines", () => {
    const preview = buildInlineDiffPreview("a.ts", "foo\nbar", "foo\nbaz");
    assert.match(preview, /- bar/);
    assert.match(preview, /\+ baz/);
  });
});
