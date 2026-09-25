import * as crypto from "crypto";
import * as http from "http";
import { URL } from "url";
import * as vscode from "vscode";
import { logError, logInfo, logWarn } from "./logger";

export interface FigmaTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  scope?: string;
  tokenType?: string;
  user?: {
    id?: string;
    email?: string;
    handle?: string;
    imgUrl?: string;
  };
  clientId?: string;
  clientSecret?: string;
}

export interface FigmaAuthStatus {
  authenticated: boolean;
  expiresAt?: number;
  user?: {
    email?: string;
    handle?: string;
  };
  scope?: string;
  error?: string;
}

export interface SimpleSecretStorage {
  get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
  store(key: string, value: string): Thenable<void> | Promise<void>;
  delete(key: string): Thenable<void> | Promise<void>;
}

interface PendingOAuthFlow {
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  createdAt: number;
  resolve: (res: { success: boolean; message: string; tokens?: FigmaTokens }) => void;
}

export const FIGMA_REMOTE_MCP_URL = "https://mcp.figma.com/mcp";
export const FIGMA_DESKTOP_MCP_URL = "http://127.0.0.1:3845/mcp";
export const FIGMA_REGISTRATION_ENDPOINT = "https://api.figma.com/v1/oauth/mcp/register";
export const FIGMA_AUTHORIZATION_ENDPOINT = "https://www.figma.com/oauth/mcp";
export const FIGMA_TOKEN_ENDPOINT = "https://api.figma.com/v1/oauth/token";
export const FIGMA_ALLOWLISTED_CLIENT_NAME = "Codex";

const SECRET_KEY = "hooshyar.figma_oauth_tokens";
const DEFAULT_PORTS = [19876, 19877, 19878, 0];

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const verifierBytes = crypto.randomBytes(32);
  const codeVerifier = verifierBytes
    .toString("base64url")
    .replace(/[^a-zA-Z0-9\-._~]/g, "");

  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  const codeChallenge = hash.toString("base64url");

  return { codeVerifier, codeChallenge };
}

export function buildFigmaAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string
): string {
  const url = new URL(FIGMA_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.href;
}

export class FigmaAuthManager {
  private activeServer: http.Server | null = null;
  private activePort: number | null = null;
  private pendingFlows = new Map<string, PendingOAuthFlow>();
  private cachedTokens: FigmaTokens | null = null;

  constructor(private readonly secretStorage: SimpleSecretStorage) {}

  public async getTokens(): Promise<FigmaTokens | null> {
    if (this.cachedTokens) {
      return this.cachedTokens;
    }
    try {
      const raw = await this.secretStorage.get(SECRET_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as FigmaTokens;
      this.cachedTokens = parsed;
      return parsed;
    } catch (err) {
      logError(`Failed to load Figma tokens from SecretStorage: ${err}`);
      return null;
    }
  }

  public async getAuthStatus(): Promise<FigmaAuthStatus> {
    const tokens = await this.getTokens();
    if (!tokens || !tokens.accessToken) {
      return { authenticated: false };
    }
    const isExpired = tokens.expiresAt ? Date.now() > tokens.expiresAt : false;
    if (isExpired && !tokens.refreshToken) {
      return { authenticated: false, error: "توکن منقضی شده است و رفرش توکن یافت نشد." };
    }
    return {
      authenticated: true,
      expiresAt: tokens.expiresAt,
      user: tokens.user,
      scope: tokens.scope
    };
  }

  public async getValidAccessToken(): Promise<string | null> {
    const tokens = await this.getTokens();
    if (!tokens || !tokens.accessToken) return null;

    // Check if token is expired or expiring within 60 seconds
    const isExpiringSoon = tokens.expiresAt ? Date.now() > tokens.expiresAt - 60_000 : false;
    if (isExpiringSoon && tokens.refreshToken) {
      logInfo("[FigmaAuth] Token expiring soon, attempting refresh...");
      const refreshed = await this.refreshTokens();
      if (refreshed) {
        return refreshed.accessToken;
      }
    }

    return tokens.accessToken;
  }

  public async refreshTokens(): Promise<FigmaTokens | null> {
    const current = await this.getTokens();
    if (!current?.refreshToken || !current?.clientId) {
      logWarn("[FigmaAuth] Cannot refresh tokens: missing refreshToken or clientId");
      return null;
    }

    try {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: current.clientId
      });
      if (current.clientSecret) {
        params.set("client_secret", current.clientSecret);
      }

      const res = await fetch(FIGMA_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });

      if (!res.ok) {
        const errorText = await res.text();
        logError(`[FigmaAuth] Refresh token failed HTTP ${res.status}: ${errorText}`);
        if (res.status === 400 || res.status === 401) {
          // Token invalid, clear it
          await this.logout();
        }
        return null;
      }

      const data = (await res.json()) as any;
      if (!data?.access_token) {
        logError("[FigmaAuth] Refresh token response missing access_token");
        return null;
      }

      const updated: FigmaTokens = {
        ...current,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || current.refreshToken,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : current.expiresAt,
        scope: data.scope || current.scope,
        tokenType: data.token_type || current.tokenType || "Bearer"
      };

      await this.saveTokens(updated);
      logInfo("[FigmaAuth] Successfully refreshed Figma OAuth token.");
      return updated;
    } catch (err) {
      logError(`[FigmaAuth] Error refreshing token: ${err}`);
      return null;
    }
  }

  public async saveTokens(tokens: FigmaTokens): Promise<void> {
    this.cachedTokens = tokens;
    await this.secretStorage.store(SECRET_KEY, JSON.stringify(tokens));
  }

  public async logout(): Promise<void> {
    this.cachedTokens = null;
    await this.secretStorage.delete(SECRET_KEY);
    this.cancelPendingOAuth();
    logInfo("[FigmaAuth] User logged out from Figma account.");
  }

  public cancelPendingOAuth(): void {
    if (this.activeServer) {
      try {
        this.activeServer.close();
      } catch {
        /* ignore */
      }
      this.activeServer = null;
      this.activePort = null;
    }
  }

  public async registerDynamicClient(redirectUri: string): Promise<{ clientId: string; clientSecret?: string }> {
    const payload = {
      redirect_uris: [redirectUri],
      client_name: FIGMA_ALLOWLISTED_CLIENT_NAME,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    };

    const res = await fetch(FIGMA_REGISTRATION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Client registration failed (HTTP ${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    if (!data.client_id) {
      throw new Error("Client registration response missing client_id");
    }

    return {
      clientId: data.client_id,
      clientSecret: data.client_secret
    };
  }

  public async startOAuthFlow(
    openBrowserFn?: (url: string) => Promise<boolean | void>
  ): Promise<{ success: boolean; message: string; tokens?: FigmaTokens }> {
    return new Promise(async (resolve) => {
      try {
        const { port } = await this.ensureCallbackServer();
        const redirectUri = `http://localhost:${port}/callback`;

        // Register client dynamically on Figma
        logInfo("[FigmaAuth] Registering dynamic OAuth client...");
        const client = await this.registerDynamicClient(redirectUri);

        // Generate PKCE & State
        const pkce = generatePKCE();
        const state = crypto.randomUUID();

        const flow: PendingOAuthFlow = {
          codeVerifier: pkce.codeVerifier,
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          redirectUri,
          createdAt: Date.now(),
          resolve
        };
        this.pendingFlows.set(state, flow);

        // Auto-expire individual state after 3 minutes if not claimed
        setTimeout(() => {
          if (this.pendingFlows.has(state)) {
            const expired = this.pendingFlows.get(state);
            this.pendingFlows.delete(state);
            if (expired) {
              expired.resolve({
                success: false,
                message: "زمان انتظار برای تایید ورود در فیگما به پایان رسید (۱۸۰ ثانیه)."
              });
            }
            if (this.pendingFlows.size === 0) {
              this.cancelPendingOAuth();
            }
          }
        }, 180_000);

        // Build authorization URL
        const authUrl = buildFigmaAuthorizationUrl(client.clientId, redirectUri, pkce.codeChallenge, state);
        logInfo(`[FigmaAuth] Opening browser for Figma authorization: ${authUrl}`);

        if (openBrowserFn) {
          await openBrowserFn(authUrl);
        } else {
          await vscode.env.openExternal(vscode.Uri.parse(authUrl));
        }
      } catch (err: any) {
        logError(`[FigmaAuth] Failed to initiate OAuth: ${err?.message ?? err}`);
        resolve({
          success: false,
          message: `خطا در باز کردن صفحه لاگین: ${err?.message ?? String(err)}`
        });
      }
    });
  }

  private async ensureCallbackServer(): Promise<{ server: http.Server; port: number }> {
    if (this.activeServer && this.activePort) {
      return { server: this.activeServer, port: this.activePort };
    }

    const { server, port } = await this.bindCallbackServer();
    this.activeServer = server;
    this.activePort = port;

    server.on("request", async (req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      try {
        const url = new URL(req.url, "http://localhost");
        const code = url.searchParams.get("code");
        const rawState = (url.searchParams.get("state") || "").trim();
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.renderErrorHtml(errorDescription || error));
          this.resolveAllPending({
            success: false,
            message: `ورود توسط فیگما لغو شد: ${errorDescription || error}`
          });
          this.cancelPendingOAuth();
          return;
        }

        // 1. Look for matching flow by state
        let matchingFlow = this.pendingFlows.get(rawState);

        // 2. Fallback: case-insensitive check
        if (!matchingFlow) {
          for (const [k, v] of this.pendingFlows.entries()) {
            if (k.toLowerCase() === rawState.toLowerCase()) {
              matchingFlow = v;
              break;
            }
          }
        }

        // 3. Fallback: if there are pending flows, take the most recent matching one
        if (!matchingFlow && this.pendingFlows.size > 0) {
          const flows = Array.from(this.pendingFlows.values());
          matchingFlow = flows[flows.length - 1];
        }

        // 4. Fallback: if already authenticated and user refreshed
        if (!matchingFlow && this.cachedTokens?.accessToken) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.renderSuccessHtml());
          return;
        }

        if (!matchingFlow) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.renderErrorHtml("جلسه ورود منقضی شده است. لطفاً به VS Code بازگردید و مجدداً روی دکمه ورود کلیک کنید."));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.renderErrorHtml("کد تایید ورود از فیگما دریافت نشد."));
          return;
        }

        // Exchange code for tokens
        logInfo("[FigmaAuth] Exchanging authorization code for tokens...");
        const tokenParams = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: matchingFlow.codeVerifier,
          client_id: matchingFlow.clientId,
          redirect_uri: matchingFlow.redirectUri
        });
        if (matchingFlow.clientSecret) {
          tokenParams.set("client_secret", matchingFlow.clientSecret);
        }

        const tokenRes = await fetch(FIGMA_TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: tokenParams.toString()
        });

        if (!tokenRes.ok) {
          const bodyText = await tokenRes.text();
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.renderErrorHtml(`خطا در تبادل کد با توکن (${tokenRes.status})`));
          this.resolveAllPending({
            success: false,
            message: `خطا در دریافت توکن از فیگما: ${bodyText}`
          });
          this.cancelPendingOAuth();
          return;
        }

        const tokenJson = (await tokenRes.json()) as any;
        if (!tokenJson.access_token) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.renderErrorHtml("پاسخ سرور فاقد access_token است."));
          return;
        }

        const tokens: FigmaTokens = {
          accessToken: tokenJson.access_token,
          refreshToken: tokenJson.refresh_token,
          expiresAt: tokenJson.expires_in ? Date.now() + tokenJson.expires_in * 1000 : undefined,
          scope: tokenJson.scope,
          tokenType: tokenJson.token_type || "Bearer",
          clientId: matchingFlow.clientId,
          clientSecret: matchingFlow.clientSecret
        };

        await this.saveTokens(tokens);

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(this.renderSuccessHtml());

        this.resolveAllPending({
          success: true,
          message: "با موفقیت به اکانت فیگما متصل شدید! سرور MCP فیگما آماده استفاده است.",
          tokens
        });
        this.cancelPendingOAuth();
      } catch (err: any) {
        logError(`[FigmaAuth] Error handling callback request: ${err}`);
        try {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.renderErrorHtml(String(err?.message ?? err)));
        } catch (_) {}
      }
    });

    return { server, port };
  }

  private resolveAllPending(result: { success: boolean; message: string; tokens?: FigmaTokens }): void {
    for (const flow of this.pendingFlows.values()) {
      try {
        flow.resolve(result);
      } catch (_) {}
    }
    this.pendingFlows.clear();
  }

  private async bindCallbackServer(): Promise<{ server: http.Server; port: number }> {
    for (const port of DEFAULT_PORTS) {
      try {
        const result = await new Promise<{ server: http.Server; port: number }>((resolve, reject) => {
          const srv = http.createServer();
          srv.once("error", (err: any) => reject(err));
          srv.listen(port, "127.0.0.1", () => {
            const addr = srv.address();
            const actualPort = typeof addr === "object" && addr ? addr.port : port;
            resolve({ server: srv, port: actualPort });
          });
        });
        return result;
      } catch (e: any) {
        if (e.code === "EADDRINUSE") {
          continue;
        }
        throw e;
      }
    }
    throw new Error("امکان باز کردن درگاه شبکه برای احراز هویت فراهم نشد.");
  }

  private renderSuccessHtml(): string {
    return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="utf-8">
  <title>اتصال به فیگما - هوشیار</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Vazirmatn", sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #0f172a;
      color: #f8fafc;
    }
    .card {
      text-align: center;
      padding: 2.5rem 2rem;
      background: #1e293b;
      border-radius: 16px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      border: 1px solid #334155;
      max-width: 440px;
      width: 90%;
    }
    .icon {
      width: 64px;
      height: 64px;
      line-height: 64px;
      font-size: 32px;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border-radius: 50%;
      margin: 0 auto 1.25rem auto;
      border: 2px solid #10b981;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 10px 0;
      color: #38bdf8;
    }
    p {
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.7;
      margin: 0 0 1rem 0;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: #0f172a;
      border-radius: 20px;
      font-size: 12px;
      color: #cbd5e1;
      border: 1px solid #334155;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>اتصال با موفقیت انجام شد!</h1>
    <p>اکانت فیگما شما با هوشیار همگام‌سازی شد. اکنون محدودیت‌های نرخ API برطرف شده و می‌توانید از قابلیت‌های MCP در هوشیار استفاده کنید.</p>
    <div class="badge">می‌توانید این برگه را ببندید و به محیط VS Code بازگردید.</div>
  </div>
</body>
</html>`;
  }

  private renderErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="utf-8">
  <title>خطا در اتصال به فیگما - هوشیار</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Vazirmatn", sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #0f172a;
      color: #f8fafc;
    }
    .card {
      text-align: center;
      padding: 2.5rem 2rem;
      background: #1e293b;
      border-radius: 16px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      border: 1px solid #ef4444;
      max-width: 440px;
      width: 90%;
    }
    .icon {
      width: 64px;
      height: 64px;
      line-height: 64px;
      font-size: 32px;
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
      border-radius: 50%;
      margin: 0 auto 1.25rem auto;
      border: 2px solid #ef4444;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 10px 0;
      color: #f87171;
    }
    p {
      font-size: 14px;
      color: #cbd5e1;
      line-height: 1.7;
      margin: 0;
    }
    .hint {
      margin-top: 14px;
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✕</div>
    <h1>خطا در احراز هویت فیگما</h1>
    <p>${message}</p>
    <div class="hint">لطفاً به محیط VS Code بازگردید و مجدداً روی دکمه ورود کلیک کنید.</div>
  </div>
</body>
</html>`;
  }
}
