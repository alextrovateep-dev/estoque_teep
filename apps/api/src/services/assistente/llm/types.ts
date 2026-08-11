export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LlmToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LlmRoundResult = {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: { inputTokens?: number; outputTokens?: number };
};

export interface LlmProvider {
  name: string;
  chatWithTools(input: {
    system: string;
    messages: ChatMessage[];
    tools: LlmToolDef[];
    temperature: number;
    maxTokens: number;
  }): Promise<LlmRoundResult>;
}

export function isAssistenteEnabled(): boolean {
  return process.env.ASSISTENTE_LLM_ENABLED === "1";
}

export function getLlmConfig() {
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  const maxRounds = Math.min(
    8,
    Math.max(1, Number(process.env.LLM_MAX_TOOL_ROUNDS || 5))
  );
  const temperature = Number(process.env.LLM_TEMPERATURE || 0.45);
  const maxTokens = Number(process.env.LLM_MAX_TOKENS || 800);
  const model =
    process.env.LLM_MODEL ||
    (provider === "anthropic"
      ? "claude-haiku-4-5-20251001"
      : "gpt-4o-mini");
  return { provider, maxRounds, temperature, maxTokens, model };
}
