/**
 * Default model chains (comma-separated, tried in order). Verified 25 Sep 2026 against
 * the live model lists of both providers with tool-calling probes. Each model has its own
 * free-tier quota (Gemini: 20 requests/day/model; Groq: about 8k tokens/minute/model),
 * so a second model is a real fallback, not just a retry.
 */
export const DEFAULT_GEMINI_MODELS = "gemini-3.6-flash,gemini-3-flash-preview,gemini-3.5-flash-lite";
export const DEFAULT_GROQ_MODELS = "openai/gpt-oss-120b,qwen/qwen3.8-27b";
