import { Dispatcher, ProxyAgent } from "undici";

let cachedUrl = "";
let cachedAgent: ProxyAgent | undefined;

/** Returns a reusable dispatcher for Figma requests, or undefined when proxying is off. */
export function getFigmaProxyDispatcher(enabled: boolean, rawUrl: string): Dispatcher | undefined {
  if (!enabled) return undefined;
  const value = rawUrl.trim();
  if (!value) throw new Error("آدرس پروکسی Figma وارد نشده است.");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("آدرس پروکسی Figma معتبر نیست.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("پروکسی Figma باید با http:// یا https:// شروع شود.");
  }

  if (!cachedAgent || cachedUrl !== parsed.toString()) {
    void cachedAgent?.close();
    cachedUrl = parsed.toString();
    cachedAgent = new ProxyAgent(cachedUrl);
  }
  return cachedAgent;
}

