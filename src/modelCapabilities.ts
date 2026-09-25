import { ApiClientConfig } from "./apiConfig";

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  streaming: boolean;
  reasoning: boolean;
  promptCaching: boolean;
  maxContextTokens?: number;
}

export function detectModelCapabilities(
  config: Pick<ApiClientConfig, "apiFormat" | "model" | "toolProtocol" | "enablePromptCaching">,
  enableTools: boolean
): ModelCapabilities {
  const model = config.model.toLowerCase();
  return {
    tools: enableTools && config.toolProtocol !== "text",
    vision: /claude|gpt-4o|gpt-4\.1|gemini|vision/.test(model),
    streaming: true,
    reasoning: /reason|o1|o3|o4|opus|sonnet/.test(model),
    promptCaching: config.apiFormat === "anthropic" && config.enablePromptCaching !== false
  };
}
