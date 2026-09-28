import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getFigmaProxyDispatcher } from "../out/figmaProxy.js";

describe("Figma proxy settings", () => {
  it("stays disabled without validating an empty URL", () => {
    assert.equal(getFigmaProxyDispatcher(false, ""), undefined);
  });

  it("accepts HTTP and HTTPS proxy URLs and reuses the dispatcher", () => {
    const first = getFigmaProxyDispatcher(true, "http://127.0.0.1:10809");
    const second = getFigmaProxyDispatcher(true, "http://127.0.0.1:10809");
    assert.ok(first);
    assert.equal(first, second);
    assert.ok(getFigmaProxyDispatcher(true, "https://proxy.example.com:443"));
  });

  it("rejects empty, malformed, and unsupported proxy URLs", () => {
    assert.throws(() => getFigmaProxyDispatcher(true, ""), /آدرس پروکسی/);
    assert.throws(() => getFigmaProxyDispatcher(true, "not a url"), /معتبر نیست/);
    assert.throws(() => getFigmaProxyDispatcher(true, "socks5://127.0.0.1:1080"), /http:\/\//);
  });
});
