/**
 * Kite Agent Passport CLI (`kpass` & `ksearch` v6.13+) JSON adapter.
 *
 * When `kpass` / `ksearch` binaries are installed on the host (e.g., `~/.kpass/bin`
 * on macOS or a Linux VPS), Brokr can discover live services from Kite's catalog,
 * inspect Passport status, and execute paid x402 calls directly through the user's
 * passkey-approved Passport session (`--output json --no-interactive`).
 *
 * In serverless environments where local CLI binaries are absent, functions
 * cleanly report `{ installed: false }` without throwing.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function resolveBinary(name: "kpass" | "ksearch"): string | null {
  const candidates = [
    process.env[`${name.toUpperCase()}_BIN`],
    join(homedir(), ".kpass", "bin", name),
    join(homedir(), ".local", "bin", name),
    `/usr/local/bin/${name}`,
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

export interface KsearchServiceItem {
  service_id: string;
  name: string;
  summary: string;
  base_url: string;
  categories: string[];
  tags: string[];
  payment_approach: string;
  assets: string[];
  starting_price?: {
    amount: string;
    asset: string;
    unit: string;
  };
}

export async function probeKpassEnvironment(): Promise<{
  installed: boolean;
  kpassVersion?: string;
  ksearchVersion?: string;
  catalogBackendOk?: boolean;
  passportBackendUrl?: string;
}> {
  const kpassBin = resolveBinary("kpass");
  const ksearchBin = resolveBinary("ksearch");
  if (!kpassBin && !ksearchBin) {
    return { installed: false };
  }

  try {
    const [verOut, healthOut] = await Promise.all([
      kpassBin
        ? execFileAsync(kpassBin, ["--version"], { timeout: 3_000 }).then((r) => r.stdout.trim())
        : Promise.resolve(undefined),
      ksearchBin
        ? execFileAsync(ksearchBin, ["health", "--output", "json"], { timeout: 4_000 })
            .then((r) => JSON.parse(r.stdout) as {
              agent?: { backend_url?: string };
              service?: { ok?: boolean };
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    return {
      installed: true,
      kpassVersion: verOut,
      ksearchVersion: verOut?.replace("kpass", "ksearch"),
      catalogBackendOk: Boolean(healthOut?.service?.ok),
      passportBackendUrl: healthOut?.agent?.backend_url,
    };
  } catch {
    return { installed: Boolean(kpassBin) };
  }
}

export async function searchKiteCatalogViaCli(
  query?: string,
  limit = 6,
): Promise<KsearchServiceItem[]> {
  const ksearchBin = resolveBinary("ksearch");
  if (!ksearchBin) return [];

  const args = ["service", "list", "--limit", String(limit), "--output", "json"];
  if (query && query.trim()) {
    args.push("--query", query.trim());
  }

  try {
    const { stdout } = await execFileAsync(ksearchBin, args, { timeout: 5_000 });
    const parsed = JSON.parse(stdout) as { services?: KsearchServiceItem[] };
    return Array.isArray(parsed.services) ? parsed.services : [];
  } catch {
    return [];
  }
}

export async function executePaidRequestViaKpass(params: {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}): Promise<{
  ok: boolean;
  status?: number;
  txHash?: string;
  data?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}> {
  const kpassBin = resolveBinary("kpass");
  if (!kpassBin) {
    return { ok: false, errorMessage: "kpass binary not installed on host" };
  }

  const args = [
    "agent:session",
    "execute",
    "--url",
    params.url,
    "--method",
    params.method || "GET",
    "--output",
    "json",
    "--no-interactive",
  ];
  if (params.headers) {
    args.push("--headers", JSON.stringify(params.headers));
  }
  if (params.body) {
    args.push("--body", params.body);
  }

  try {
    const { stdout } = await execFileAsync(kpassBin, args, { timeout: 25_000 });
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (parsed.status === "error" || parsed.error) {
      return {
        ok: false,
        errorCode: typeof parsed.code === "string" ? parsed.code : undefined,
        errorMessage: String(parsed.error || "kpass execution rejected"),
      };
    }
    return {
      ok: true,
      status: typeof parsed.http_status === "number" ? parsed.http_status : 200,
      txHash:
        (typeof parsed.tx_hash === "string" && parsed.tx_hash) ||
        (typeof parsed.transaction === "string" && parsed.transaction) ||
        undefined,
      data: parsed,
    };
  } catch (err) {
    return {
      ok: false,
      errorMessage: (err as Error).message,
    };
  }
}
