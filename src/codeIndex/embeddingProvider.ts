import { EmbeddingProvider } from "./types";

export class DisabledEmbeddingProvider implements EmbeddingProvider {
  readonly id = "disabled";
  readonly available = false;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly available = true;

  constructor(
    public readonly id: string,
    private readonly endpoint: string,
    private readonly model: string,
    private readonly headers: Record<string, string> = {}
  ) {}

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal
    });
    if (!response.ok) throw new Error(`Embedding request failed with HTTP ${response.status}.`);
    const body = await response.json() as { data?: Array<{ embedding?: number[]; index?: number }> };
    const data = Array.isArray(body.data) ? [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
    if (data.length !== texts.length || data.some((item) => !Array.isArray(item.embedding))) {
      throw new Error("Embedding provider returned an invalid response.");
    }
    return data.map((item) => item.embedding as number[]);
  }
}
