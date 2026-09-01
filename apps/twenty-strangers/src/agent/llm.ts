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

export function makeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 3 })
}

/** Rough running total so the UI can show spend rather than hide it. */
export class TokenMeter {
  inputTokens = 0
  outputTokens = 0

  add(usage: { input_tokens?: number; output_tokens?: number } | undefined): void {
    if (!usage) return
    this.inputTokens += usage.input_tokens ?? 0
    this.outputTokens += usage.output_tokens ?? 0
  }

  /** Haiku 4.5 list pricing, per million tokens. */
  estimateUsd(inPerM = 1.0, outPerM = 5.0): number {
    return (this.inputTokens / 1e6) * inPerM + (this.outputTokens / 1e6) * outPerM
  }
}
