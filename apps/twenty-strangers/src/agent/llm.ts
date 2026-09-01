/**
 * Anthropic wrapper.
 *
 * Deliberately thin. The interesting cost decisions live in the loop (step
 * caps, text-only observations); this file just owns retries and the mock
 * seam that lets the whole app run with no keys and no spend.
 */

import Anthropic from "@anthropic-ai/sdk"

export interface LlmClient {
  messages: Anthropic["messages"]
}

/**
 * Identity-linked API keys reject every request without an
 * `anthropic-workspace-id` header, so it is applied whenever one is
 * configured. Ordinary keys ignore it.
 */
export function makeClient(apiKey: string, workspaceId?: string): Anthropic {
  return new Anthropic({
    apiKey,
    maxRetries: 3,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  })
}

/**
 * Running total so the UI can show spend rather than hide it.
 *
 * Cache tokens are counted separately because they are billed separately:
 * a cache WRITE costs 1.25x normal input and a cache READ costs 0.1x. They do
 * not appear in `input_tokens`, so ignoring them would silently understate the
 * bill — which for a tool that advertises its own cost would be the wrong kind
 * of wrong.
 */
export class TokenMeter {
  inputTokens = 0
  outputTokens = 0
  cacheWriteTokens = 0
  cacheReadTokens = 0

  add(
    usage:
      | {
          input_tokens?: number
          output_tokens?: number
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
        }
      | undefined,
  ): void {
    if (!usage) return
    this.inputTokens += usage.input_tokens ?? 0
    this.outputTokens += usage.output_tokens ?? 0
    this.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0
    this.cacheReadTokens += usage.cache_read_input_tokens ?? 0
  }

  /** Haiku 4.5 list pricing, per million tokens. */
  estimateUsd(inPerM = 1.0, outPerM = 5.0): number {
    return (
      (this.inputTokens / 1e6) * inPerM +
      (this.outputTokens / 1e6) * outPerM +
      (this.cacheWriteTokens / 1e6) * inPerM * 1.25 +
      (this.cacheReadTokens / 1e6) * inPerM * 0.1
    )
  }

  /** Share of prompt tokens served from cache — the caching win, measured. */
  get cacheHitRate(): number {
    const promptTokens = this.inputTokens + this.cacheWriteTokens + this.cacheReadTokens
    return promptTokens === 0 ? 0 : this.cacheReadTokens / promptTokens
  }
}
