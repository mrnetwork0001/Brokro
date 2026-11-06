/**
 * Dolphin Decentralized Open-Source Model Adapter (`https://lighthouse.dphn.ai/run/text-v/v1`).
 *
 * Powers Brokr's live `osint-brief` upstream x402 supplier node using open-weight
 * `deepseek-ai/DeepSeek-V4.1-Flash` when `DOLPHIN_API_KEY` is configured, turning
 * decentralized open-source inference into a revenue-generating x402 supply node.
 */

const DOLPHIN_BASE_URL =
  process.env.DOLPHIN_BASE_URL || "https://lighthouse.dphn.ai/run/text-v/v1";
const DOLPHIN_MODEL =
  process.env.DOLPHIN_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash";

export function isDolphinConfigured(): boolean {
  return Boolean(process.env.DOLPHIN_API_KEY && process.env.DOLPHIN_API_KEY.trim().length > 0);
}

export async function summarizeOsintWithDolphin(input: {
  entity: string;
  githubFacts: Record<string, unknown>;
}): Promise<{
  usedDolphin: boolean;
  model: string;
  summary: string;
  flags: string[];
}> {
  const apiKey = process.env.DOLPHIN_API_KEY?.trim();
  if (!apiKey) {
    const repoCount = Number(input.githubFacts.publicRepos ?? 0);
    const flags: string[] = [];
    if (repoCount === 0) flags.push("no_public_repos_found");
    if (input.githubFacts.archived === true) flags.push("archived_repository");
    return {
      usedDolphin: false,
      model: "deterministic-github-sensor",
      summary: `Live GitHub telemetry resolved for ${input.entity}: ${repoCount} public repositories, latest push ${String(input.githubFacts.pushedAt || "n/a")}.`,
      flags,
    };
  }

  try {
    const res = await fetch(`${DOLPHIN_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DOLPHIN_MODEL,
        temperature: 0.1,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content:
              'You are a concise open-source intelligence analyst. Return strict JSON: {"summary": string, "flags": string[]}. Base every statement solely on the supplied telemetry.',
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
      }),
      signal: AbortSignal.timeout(7_000),
    });

    if (!res.ok) {
      return {
        usedDolphin: false,
        model: `dolphin-http-${res.status}-fallback`,
        summary: `GitHub sensor fallback (${res.status === 402 ? "Dolphin 402 credit top-up needed" : `HTTP ${res.status}`}): ${Number(input.githubFacts.publicRepos ?? 0)} public repos observed.`,
        flags: res.status === 402 ? ["dolphin_credits_exhausted"] : [],
      };
    }

    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) {
      const parsed = JSON.parse(raw.slice(first, last + 1)) as {
        summary?: string;
        flags?: string[];
      };
      return {
        usedDolphin: true,
        model: data.model || DOLPHIN_MODEL,
        summary: parsed.summary || raw.slice(0, 220),
        flags: Array.isArray(parsed.flags) ? parsed.flags.map(String) : [],
      };
    }

    return {
      usedDolphin: true,
      model: data.model || DOLPHIN_MODEL,
      summary: raw.slice(0, 240).trim(),
      flags: [],
    };
  } catch {
    return {
      usedDolphin: false,
      model: "deterministic-github-sensor",
      summary: `Live GitHub sensor resolved ${Number(input.githubFacts.publicRepos ?? 0)} public repositories for ${input.entity}.`,
      flags: [],
    };
  }
}
