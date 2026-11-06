/**
 * SERV Reasoning Engine client (`https://inference-api.openserv.ai/v1`).
 *
 * Upgraded for OpenServ Hackathon Edition 02:
 *   1. Strict JSON-Schema typed steps with local re-validation and bounded
 *      schema-error repair rounds.
 *   2. Native server-side SERV Tools (`serv_prompt_guard`, `serv_shadow_agent`)
 *      injected via the standard `tools` array and stripped server-side by SERV.
 *   3. `POST /v1/responses` support with reasoning summaries (`summary: "auto"`)
 *      so basket planning exposes auditable intermediate reasoning before spend.
 *   4. Exact per-step USD cost telemetry derived from OpenServ's published
 *      per-million-token catalog rates.
 */

import { validate, type JsonSchema } from "./graph/schema";

const DEFAULT_BASE_URL = "https://inference-api.openserv.ai/v1";
export const FAST_GUARD_MODEL = process.env.SERV_FAST_MODEL || "gpt-6-luna";
export const PLANNER_MODEL = process.env.SERV_PLANNER_MODEL || "gpt-5.4-mini";
export const ARBITER_MODEL = process.env.SERV_ARBITER_MODEL || "gpt-5.4-mini";

const MAX_REPAIRS = 2;
const MAX_TRANSPORT_RETRIES = 2;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Published OpenServ SERV Reasoning rates (USD per 1,000,000 tokens).
 * Source: https://docs.openserv.ai/serv-reasoning/models.md
 */
const MODEL_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-6-luna": { input: 0.13, output: 0.65 },
  "gpt-5.4-nano": { input: 0.25, output: 1.6 },
  "gpt-5.6-luna": { input: 0.25, output: 1.5 },
  "gpt-5.4-mini": { input: 1.0, output: 6.0 },
  "gpt-5.4": { input: 3.25, output: 20.0 },
  "gpt-6.1-sol": { input: 2.4, output: 12.0 },
  "claude-haiku-4.5": { input: 1.25, output: 6.5 },
  "claude-sonnet-5.5": { input: 2.4, output: 12.0 },
  "gemini-3.1-flash-lite": { input: 0.3, output: 1.8 },
  "gemini-3.8-flash": { input: 1.0, output: 4.5 },
};

export interface ServMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ServUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface ServToolOptions {
  promptGuard?: boolean;
  shadowAgent?: {
    maxIterations?: number;
    hint?: string;
  };
}

export interface TypedStepOptions {
  model?: string;
  schema: JsonSchema;
  schemaName: string;
  messages: ServMessage[];
  servTools?: ServToolOptions;
  temperature?: number;
  signal?: AbortSignal;
  onRepair?: (attempt: number, errors: string[]) => void;
}

export interface TypedStepResult<T> {
  value: T;
  model: string;
  usage: ServUsage;
  costUsd: number;
  repairs: number;
  servTools: string[];
  raw: string;
}

export interface ReasoningSummaryResult<T> extends TypedStepResult<T> {
  reasoningSummaries: string[];
}

export class ServError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ServError";
    this.status = status;
  }
}

export function isServConfigured(): boolean {
  return Boolean(process.env.SERV_API_KEY && process.env.SERV_API_KEY.trim().length > 0);
}

export function estimateServCostUsd(model: string, usage: ServUsage): number {
  const normalized = Object.keys(MODEL_PRICING_PER_1M).find((k) =>
    model.toLowerCase().startsWith(k.toLowerCase()),
  );
  const rate = normalized
    ? MODEL_PRICING_PER_1M[normalized]
    : MODEL_PRICING_PER_1M["gpt-5.4-mini"];
  const cost = (usage.prompt * rate.input + usage.completion * rate.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function buildServToolsArray(opts?: ServToolOptions): {
  tools: Record<string, unknown>[];
  names: string[];
} {
  const tools: Record<string, unknown>[] = [];
  const names: string[] = [];

  if (opts?.promptGuard) {
    names.push("serv_prompt_guard");
    tools.push({
      type: "function",
      function: {
        name: "serv_prompt_guard",
      },
    });
  }

  if (opts?.shadowAgent) {
    names.push("serv_shadow_agent");
    const properties: Record<string, unknown> = {
      max_iterations: {
        type: "integer",
        default: opts.shadowAgent.maxIterations ?? 3,
      },
    };
    if (opts.shadowAgent.hint) {
      properties.hint = {
        type: "string",
        default: opts.shadowAgent.hint,
      };
    }
    tools.push({
      type: "function",
      function: {
        name: "serv_shadow_agent",
        description: "Enable SERV shadow-agent iterative output validation.",
        parameters: {
          type: "object",
          properties,
        },
      },
    });
  }

  return { tools, names };
}

function getAuthConfig(): { baseUrl: string; apiKey: string } {
  const apiKey = process.env.SERV_API_KEY?.trim();
  if (!apiKey) {
    throw new ServError("SERV_API_KEY is not configured. Set it in .env.local to run SERV Reasoning.");
  }
  const baseUrl = (process.env.SERV_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { baseUrl, apiKey };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal });
      if (!RETRY_STATUSES.has(res.status) || attempt === MAX_TRANSPORT_RETRIES) {
        return res;
      }
      await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
    } catch (err) {
      lastError = err;
      if (signal?.aborted || attempt === MAX_TRANSPORT_RETRIES) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new ServError("SERV transport failed");
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new SyntaxError("Response did not contain a valid JSON object");
  }
}

/**
 * Executes a typed step on `POST /v1/chat/completions` with strict JSON schema
 * enforcement, optional `serv_*` server-side tools, and local validation + repair.
 */
export async function runTypedStep<T>(options: TypedStepOptions): Promise<TypedStepResult<T>> {
  const { baseUrl, apiKey } = getAuthConfig();
  const model = options.model || PLANNER_MODEL;
  const { tools, names } = buildServToolsArray(options.servTools);

  const history: ServMessage[] = [...options.messages];
  const totalUsage: ServUsage = { prompt: 0, completion: 0, total: 0 };
  let actualModel = model;

  for (let repair = 0; repair <= MAX_REPAIRS; repair++) {
    const body: Record<string, unknown> = {
      model,
      messages: history,
      max_completion_tokens: 4096,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: options.schemaName,
          strict: true,
          schema: options.schema,
        },
      },
    };
    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (tools.length > 0) {
      body.tools = tools;
    }

    const res = await fetchWithRetry(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      options.signal,
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new ServError(
        `SERV /chat/completions HTTP ${res.status}: ${errText.slice(0, 280)}`,
        res.status,
      );
    }

    const payload = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    if (payload.model) actualModel = payload.model;
    const pTokens = payload.usage?.prompt_tokens ?? 0;
    const cTokens = payload.usage?.completion_tokens ?? 0;
    totalUsage.prompt += pTokens;
    totalUsage.completion += cTokens;
    totalUsage.total += payload.usage?.total_tokens ?? pTokens + cTokens;

    const rawText = payload.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    let parseErrors: string[] = [];

    try {
      parsed = extractJsonObject(rawText);
      parseErrors = validate(options.schema, parsed);
    } catch (err) {
      parseErrors = [(err as Error).message];
    }

    if (parseErrors.length === 0) {
      return {
        value: parsed as T,
        model: actualModel,
        usage: totalUsage,
        costUsd: estimateServCostUsd(actualModel, totalUsage),
        repairs: repair,
        servTools: names,
        raw: rawText,
      };
    }

    if (repair === MAX_REPAIRS) {
      throw new ServError(
        `SERV step "${options.schemaName}" failed schema validation after ${MAX_REPAIRS + 1} attempts: ${parseErrors.join("; ")}`,
      );
    }

    options.onRepair?.(repair + 1, parseErrors);
    history.push(
      { role: "assistant", content: rawText || "{}" },
      {
        role: "user",
        content: `Your JSON output violated the required schema:\n- ${parseErrors.join("\n- ")}\nReturn ONLY the corrected JSON object matching ${options.schemaName}.`,
      },
    );
  }

  throw new ServError(`Unreachable exit in SERV step ${options.schemaName}`);
}

/**
 * Executes a planning step via `POST /v1/responses` (OpenAI Responses format on SERV)
 * to extract SERV's reasoning summary trace alongside a validated JSON plan.
 */
export async function runResponsesStep<T>(opts: {
  model?: string;
  instructions: string;
  input: string;
  schema: JsonSchema;
  schemaName: string;
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<ReasoningSummaryResult<T>> {
  const { baseUrl, apiKey } = getAuthConfig();
  const model = opts.model || PLANNER_MODEL;

  const res = await fetchWithRetry(
    `${baseUrl}/responses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: `${opts.instructions}\n\nYou MUST output a single valid JSON object conforming strictly to this JSON Schema (${opts.schemaName}):\n${JSON.stringify(opts.schema)}`,
        input: opts.input,
        reasoning: {
          effort: opts.effort || "low",
          summary: "auto",
        },
        text: {
          format: {
            type: "json_schema",
            name: opts.schemaName,
            strict: true,
            schema: opts.schema,
          },
        },
      }),
    },
    opts.signal,
  );

  if (!res.ok) {
    // Graceful fallback to /chat/completions if a non-OpenAI model was configured
    return {
      ...(await runTypedStep<T>({
        model,
        schema: opts.schema,
        schemaName: opts.schemaName,
        messages: [
          { role: "system", content: opts.instructions },
          { role: "user", content: opts.input },
        ],
        signal: opts.signal,
      })),
      reasoningSummaries: [],
    };
  }

  const data = (await res.json()) as {
    model?: string;
    output_text?: string;
    output?: Array<{
      type?: string;
      summary?: Array<{ type?: string; text?: string }>;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  };

  const summaries: string[] = [];
  let textOut = data.output_text ?? "";

  for (const item of data.output ?? []) {
    if (item.type === "reasoning" && Array.isArray(item.summary)) {
      for (const s of item.summary) {
        if (s.text && s.text.trim()) summaries.push(s.text.trim());
      }
    }
    if (!textOut && item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.text) textOut += c.text;
      }
    }
  }

  const usage: ServUsage = {
    prompt: data.usage?.input_tokens ?? 0,
    completion: data.usage?.output_tokens ?? 0,
    total:
      data.usage?.total_tokens ??
      (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
  };
  const actualModel = data.model || model;

  let parsed: unknown;
  let errs: string[] = [];
  try {
    parsed = extractJsonObject(textOut);
    errs = validate(opts.schema, parsed);
  } catch (err) {
    errs = [(err as Error).message];
  }

  if (errs.length > 0) {
    // Repair via /chat/completions while preserving the captured reasoning summary
    const repaired = await runTypedStep<T>({
      model,
      schema: opts.schema,
      schemaName: opts.schemaName,
      messages: [
        { role: "system", content: opts.instructions },
        {
          role: "user",
          content: `${opts.input}\n\nPrevious draft had schema errors (${errs.join("; ")}). Fix and return valid JSON.`,
        },
      ],
      signal: opts.signal,
    });
    return {
      ...repaired,
      usage: {
        prompt: usage.prompt + repaired.usage.prompt,
        completion: usage.completion + repaired.usage.completion,
        total: usage.total + repaired.usage.total,
      },
      costUsd:
        Math.round(
          (estimateServCostUsd(actualModel, usage) + repaired.costUsd) * 1_000_000,
        ) / 1_000_000,
      repairs: repaired.repairs + 1,
      reasoningSummaries: summaries,
    };
  }

  return {
    value: parsed as T,
    model: actualModel,
    usage,
    costUsd: estimateServCostUsd(actualModel, usage),
    repairs: 0,
    servTools: ["responses_reasoning_summary"],
    raw: textOut,
    reasoningSummaries: summaries,
  };
}
