import OpenAI from 'openai';

import { stageTimeoutMs, type LlmCallOptions, type LlmClient } from './contracts';
import {
  InvalidModelOutputError,
  ModelOutputTruncatedError,
  ProviderUnavailableError,
} from './errors';
import { withTimeout } from './with-timeout';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  temperature?: number;
  /** OpenAI-compatible provider extension used by Z.AI GLM models. */
  thinkingMode?: 'enabled' | 'disabled';
  /** Bound structured output so reasoning-capable models cannot consume an unbounded budget. */
  maxOutputTokens?: number;
}

/**
 * OpenAI-compatible chat client. Requests a JSON object, returns the parsed
 * (still unvalidated) payload; schema enforcement happens in the generator.
 */
export class OpenAiCompatibleLlm implements LlmClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly temperature: number;
  private readonly thinkingMode: OpenAiCompatibleOptions['thinkingMode'];
  private readonly maxOutputTokens: number | undefined;

  constructor(options: OpenAiCompatibleOptions) {
    // The adapter owns the single bounded transport retry via withTimeout;
    // disable the SDK's hidden retry loop to avoid compounded latency.
    this.client = new OpenAI({ baseURL: options.baseUrl, apiKey: options.apiKey, maxRetries: 0 });
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.temperature = options.temperature ?? 0.1;
    this.thinkingMode = options.thinkingMode;
    this.maxOutputTokens = options.maxOutputTokens;
  }

  async generateStructured<T>(input: {
    system: string;
    user: string;
    schemaName: string;
  }, options: LlmCallOptions = {}): Promise<T> {
    // No per-attempt cap: a slow generation is not helped by cutting it short
    // and retrying. The retry is only useful after a fast transient failure.
    const completion = await withTimeout(async (signal) => {
      const request = {
        model: this.model,
        temperature: this.temperature,
        response_format: { type: 'json_object' } as const,
        messages: [
          { role: 'system' as const, content: input.system },
          { role: 'user' as const, content: input.user },
        ],
        ...(this.maxOutputTokens === undefined ? {} : { max_tokens: this.maxOutputTokens }),
        ...(this.thinkingMode === undefined
          ? {}
          : { thinking: { type: this.thinkingMode } }),
      };
      const response = await this.client.chat.completions.create(request, { signal });
      const choice = response.choices[0];
      return {
        content: choice?.message?.content ?? '',
        finishReason: choice?.finish_reason ?? null,
        completionTokens: response.usage?.completion_tokens ?? null,
      };
    }, { timeoutMs: stageTimeoutMs(this.timeoutMs, options), signal: options.signal });

    options.onUsage?.({
      finishReason: completion.finishReason,
      completionTokens: completion.completionTokens,
    });

    const { content } = completion;
    if (completion.finishReason === 'length') {
      // Only a complete JSON object is usable; a cut-off payload is reported as
      // truncation rather than as a schema error or an empty response.
      try {
        return JSON.parse(extractJson(content)) as T;
      } catch {
        throw new ModelOutputTruncatedError(
          `Model output for ${input.schemaName} reached the output-token limit`,
        );
      }
    }
    if (!content.trim()) {
      throw new ProviderUnavailableError('Model returned an empty response');
    }
    try {
      return JSON.parse(extractJson(content)) as T;
    } catch {
      throw new InvalidModelOutputError(`Model did not return valid JSON for ${input.schemaName}`);
    }
  }
}

/** Tolerate models that wrap JSON in prose or ```json fences. */
function extractJson(content: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  const candidate = fenced ? fenced[1] : content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return candidate.slice(start, end + 1);
  }
  return candidate.trim();
}
