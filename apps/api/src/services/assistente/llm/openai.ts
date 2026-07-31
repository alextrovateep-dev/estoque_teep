import {
  ChatMessage,
  LlmProvider,
  LlmRoundResult,
  LlmToolDef,
  getLlmConfig,
} from "./types";

function toOpenAiTools(tools: LlmToolDef[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function toOpenAiMessages(system: string, messages: ChatMessage[]) {
  const out: Array<Record<string, unknown>> = [
    { role: "system", content: system },
  ];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
      continue;
    }
    if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function createOpenAiProvider(): LlmProvider {
  const { model } = getLlmConfig();
  const apiKey = process.env.OPENAI_API_KEY || "";

  return {
    name: "openai",
    async chatWithTools(input): Promise<LlmRoundResult> {
      if (!apiKey) throw new Error("OPENAI_API_KEY não configurada");

      const payload: Record<string, unknown> = {
        model,
        temperature: input.temperature,
        max_tokens: input.maxTokens,
        messages: toOpenAiMessages(input.system, input.messages),
      };
      if (input.tools.length > 0) {
        payload.tools = toOpenAiTools(input.tools);
        payload.tool_choice = "auto";
      }

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as {
        error?: { message?: string };
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      if (!res.ok) {
        throw new Error(body.error?.message || `OpenAI HTTP ${res.status}`);
      }

      const msg = body.choices?.[0]?.message;
      return {
        content: msg?.content ?? null,
        toolCalls: (msg?.tool_calls || []).map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments || "{}",
        })),
        usage: {
          inputTokens: body.usage?.prompt_tokens,
          outputTokens: body.usage?.completion_tokens,
        },
      };
    },
  };
}
