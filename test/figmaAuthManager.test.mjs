import assert from "node:assert/strict";
import { describe, it } from "node:test";
import crypto from "node:crypto";
import {
  FigmaAuthManager,
  FIGMA_SESSION_LIFETIME_MS,
  generatePKCE,
  buildFigmaAuthorizationUrl,
  FIGMA_REMOTE_MCP_URL,
  FIGMA_DESKTOP_MCP_URL
} from "../out/figmaAuthManager.js";
import { McpManager } from "../out/mcpManager.js";

class MockSecretStorage {
  constructor() {
    this.storage = new Map();
  }
  async get(key) {
    return this.storage.get(key);
  }
  async store(key, value) {
    this.storage.set(key, value);
  }
  async delete(key) {
    this.storage.delete(key);
  }
}

describe("Figma Auth Manager & MCP Integration Tests", () => {
  it("generates valid PKCE code_verifier and code_challenge", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    assert.ok(codeVerifier);
    assert.ok(codeChallenge);
    assert.ok(codeVerifier.length >= 43);

    // Verify SHA-256 relationship
    const expectedChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    assert.equal(codeChallenge, expectedChallenge);
  });

  it("builds correct Figma OAuth authorization URL", () => {
    const authUrl = buildFigmaAuthorizationUrl(
      "test_client_123",
      "http://localhost:19876/callback",
      "test_challenge",
      "test_state_xyz"
    );

    const url = new URL(authUrl);
    assert.equal(url.origin, "https://www.figma.com");
    assert.equal(url.pathname, "/oauth/mcp");
    assert.equal(url.searchParams.get("client_id"), "test_client_123");
    assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:19876/callback");
    assert.equal(url.searchParams.get("code_challenge"), "test_challenge");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("state"), "test_state_xyz");
    assert.equal(url.searchParams.get("response_type"), "code");
  });

  it("stores, retrieves, and checks status of Figma tokens", async () => {
    const storage = new MockSecretStorage();
    const authManager = new FigmaAuthManager(storage);

    // Initially unauthenticated
    const initialStatus = await authManager.getAuthStatus();
    assert.equal(initialStatus.authenticated, false);

    // Save tokens
    const tokens = {
      accessToken: "figma_test_access_token",
      refreshToken: "figma_test_refresh_token",
      expiresAt: Date.now() + 3600_000,
      scope: "mcp:connect",
      clientId: "test_client_id",
      clientSecret: "test_client_secret"
    };
    await authManager.saveTokens(tokens);

    // Check status
    const status = await authManager.getAuthStatus();
    assert.equal(status.authenticated, true);
    assert.equal(status.scope, "mcp:connect");
    assert.ok(status.expiresAt >= Date.now() + FIGMA_SESSION_LIFETIME_MS - 1000);

    // Get valid access token
    const token = await authManager.getValidAccessToken();
    assert.equal(token, "figma_test_access_token");

    // Logout
    await authManager.logout();
    const afterLogout = await authManager.getAuthStatus();
    assert.equal(afterLogout.authenticated, false);
    assert.equal(await authManager.getValidAccessToken(), null);
  });

  it("injects Authorization header for Figma MCP requests and handles 429 rate limit", async () => {
    const manager = new McpManager();
    let headerSent = "";

    // Set token provider
    manager.setFigmaTokenProvider(async () => "mock_oauth_bearer_token");

    // Mock global fetch for Figma remote endpoint to verify header injection
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        headerSent = options?.headers?.Authorization || "";
        // Simulate Figma rate limit (429)
        return {
          ok: false,
          status: 429,
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => "Rate limit exceeded"
        };
      };

      const testResult = await manager.testServer("figma", {
        url: FIGMA_REMOTE_MCP_URL
      });

      assert.equal(headerSent, "Bearer mock_oauth_bearer_token");
      assert.equal(testResult.ok, false);
      assert.match(testResult.message, /Figma MCP Rate Limit/);
      assert.match(testResult.message, /http:\/\/127\.0\.0\.1:3845\/mcp/);

      // Calling tool directly should throw
      await assert.rejects(
        async () => {
          await manager.callTool("mcp_figma_get_file", {}, {
            figma: { url: FIGMA_REMOTE_MCP_URL }
          });
        },
        (err) => {
          assert.match(err.message, /Figma MCP Rate Limit/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles 401 Unauthorized with token refresh and retry", async () => {
    const manager = new McpManager();
    let callCount = 0;
    let refreshCalled = false;
    let activeToken = "expired_token";

    manager.setFigmaTokenProvider(
      async () => activeToken,
      async () => {
        refreshCalled = true;
        activeToken = "new_refreshed_token";
        return activeToken;
      }
    );

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        callCount++;
        const auth = options?.headers?.Authorization;
        if (auth === "Bearer expired_token") {
          return {
            ok: false,
            status: 401,
            headers: new Headers({ "content-type": "application/json" }),
            text: async () => "Unauthorized"
          };
        }
        if (auth === "Bearer new_refreshed_token") {
          const payload = JSON.parse(options.body);
          if (payload.method === "notifications/initialized") {
            return {
              ok: true,
              status: 202,
              headers: new Headers()
            };
          }
          return {
            ok: true,
            status: 200,
            headers: new Headers({
              "content-type": "application/json",
              ...(payload.method === "initialize" ? { "mcp-session-id": "figma-session-1" } : {})
            }),
            json: async () => ({
              result: {
                ...(payload.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: {} } : {}),
                tools: [
                  {
                    name: "get_figma_data",
                    description: "Fetch Figma file or node data",
                    inputSchema: { type: "object" }
                  }
                ]
              }
            })
          };
        }
        return { ok: false, status: 500, text: async () => "Unknown" };
      };

      const tools = await manager.listTools({
        figma: { url: FIGMA_REMOTE_MCP_URL }
      });

      assert.equal(refreshCalled, true);
      assert.equal(callCount, 4);
      assert.equal(tools.length, 1);
      assert.equal(tools[0].name, "mcp_figma_get_figma_data");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("provides helpful message on 401 when no refresh token is available", async () => {
    const manager = new McpManager();
    manager.setFigmaTokenProvider(async () => null);

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => "Unauthorized"
      });

      const testResult = await manager.testServer("figma", {
        url: FIGMA_REMOTE_MCP_URL
      });

      assert.equal(testResult.ok, false);
      assert.match(testResult.message, /401: Unauthorized/);
      assert.match(testResult.message, /ورود با اکانت فیگما/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
