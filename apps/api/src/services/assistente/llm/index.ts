import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import { getLlmConfig, isAssistenteEnabled, LlmProvider } from "./types";

export {
  getLlmConfig,
  isAssistenteEnabled,
  type ChatMessage,
  type LlmProvider,
  type LlmRoundResult,
  type LlmToolDef,
} from "./types";

export function getLlmProvider(): LlmProvider {
  const { provider } = getLlmConfig();
  if (provider === "anthropic") return createAnthropicProvider();
  return createOpenAiProvider();
}
