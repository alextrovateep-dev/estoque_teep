import {
  ChatMessage,
  LlmProvider,
  LlmRoundResult,
  LlmToolDef,
  getLlmConfig,
} from "./types";

function toAnthropicTools(tools: LlmToolDef[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/** Converte histórico interno → mensagens Anthropic (user/assistant alternados). */
function toAnthropicMessages(messages: ChatMessage[]) {
  const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];

  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.arguments || "{}");
        } catch {
          input = {};
        }
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input,
        });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }
    if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
      continue;
    }
    if (m.role === "tool") {
      const last = out[out.length - 1];
      const block = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      if (last?.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

export function createAnthropicProvider(): LlmProvider {
  const { model } = getLlmConfig();
  const apiKey = process.env.ANTHROPIC_API_KEY || "";

  return {
    name: "anthropic",
    async chatWithTools(input): Promise<LlmRoundResult> {
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada");

      const payload: Record<string, unknown> = {
        model,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        system: input.system,
        messages: toAnthropicMessages(input.messages),
      };
      if (input.tools.length > 0) {
        payload.tools = toAnthropicTools(input.tools);
      }

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as {
        error?: { message?: string };
        content?: Array<{
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
        }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      if (!res.ok) {
        throw new Error(body.error?.message || `Anthropic HTTP ${res.status}`);
      }

      const textParts: string[] = [];
      const toolCalls: LlmRoundResult["toolCalls"] = [];
      for (const block of body.content || []) {
        if (block.type === "text" && block.text) textParts.push(block.text);
        if (block.type === "tool_use" && block.id && block.name) {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          });
        }
      }

      return {
        content: textParts.join("\n") || null,
        toolCalls,
        usage: {
          inputTokens: body.usage?.input_tokens,
          outputTokens: body.usage?.output_tokens,
        },
      };
    },
  };
}
