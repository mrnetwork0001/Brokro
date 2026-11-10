/**
 * Live Third-Party Kite x402 Ecosystem Discovery & Pre-Flight Firewall.
 *
 * Queries real external merchants discovered via Kite's `ksearch` catalog
 * (Otto AI, PrintMoneyLab, IP402), parses live HTTP 402 `PAYMENT-REQUIRED`
 * headers, screens descriptions with `screenManifestDeterministically`, and
 * evaluates policy admission against the active Kite SessionPolicy.
 */

import { evaluatePaymentAgainstSession, createSessionPolicy } from "../kite/session";
import { getActiveKiteNetwork } from "../kite/networks";
import { getBuyerAccount } from "../kite/wallets";
import { runDeterministicVendorChecks } from "../guard";
import type { LiveCatalogProbe, VendorManifest } from "../types";

interface ExternalTargetSpec {
  serviceId: string;
  name: string;
  baseUrl: string;
  wellKnownUrl: string;
  probeEndpoint: string;
  source: "ksearch-cli" | "x402-manifest";
}

const LIVE_TARGETS: ExternalTargetSpec[] = [
  {
    serviceId: "otto-ai-token-sec",
    name: "Otto AI · Token Security (Live x402)",
    baseUrl: "https://x402.ottoai.services",
    wellKnownUrl: "https://x402.ottoai.services/.well-known/x402",
    probeEndpoint:
      "https://x402.ottoai.services/token-security?address=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    source: "ksearch-cli",
  },
  {
    serviceId: "printmoneylab-fx",
    name: "PrintMoneyLab · KR Crypto & FX (Live x402)",
    baseUrl: "https://api.printmoneylab.com",
    wellKnownUrl: "https://api.printmoneylab.com/.well-known/x402",
    probeEndpoint: "https://api.printmoneylab.com/api/v1/fx-rate",
    source: "ksearch-cli",
  },
  {
    serviceId: "ip402-geo",
    name: "IP402 · Geolocation & ASN (Live x402)",
    baseUrl: "https://ip402.xyz",
    wellKnownUrl: "https://ip402.xyz/.well-known/x402",
    probeEndpoint: "https://ip402.xyz/8.8.8.8",
    source: "ksearch-cli",
  },
];

interface Decoded402Accept {
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
}

function decodePaymentRequiredHeader(headerVal: string | null): {
  accepts: Decoded402Accept[];
  description?: string;
} {
  if (!headerVal) return { accepts: [] };
  try {
    const json = JSON.parse(Buffer.from(headerVal, "base64").toString("utf8")) as {
      accepts?: Decoded402Accept[];
      resource?: { description?: string };
    };
    return {
      accepts: Array.isArray(json.accepts) ? json.accepts : [],
      description: json.resource?.description,
    };
  } catch {
    return { accepts: [] };
  }
}

export async function probeLiveKiteEcosystem(
  maxPerTxUsd = 0.015,
): Promise<LiveCatalogProbe[]> {
  const net = getActiveKiteNetwork();
  const buyer = getBuyerAccount();

  const tempSession = createSessionPolicy({
    mode: "delegated",
    taskSummary: "External x402 ecosystem firewall pre-flight",
    ownerAddress: buyer.address,
    agentAddress: buyer.address,
    network: net.id,
    maxAmountPerTxUsd: maxPerTxUsd,
    maxTotalAmountUsd: 0.05,
    ttlMinutes: 10,
    allowedHosts: LIVE_TARGETS.map((t) => new URL(t.baseUrl).host.toLowerCase()),
  });

  const probes = await Promise.all(
    LIVE_TARGETS.map(async (target): Promise<LiveCatalogProbe> => {
      const start = Date.now();
      try {
        const res = await fetch(target.probeEndpoint, {
          signal: AbortSignal.timeout(3_500),
          headers: { Accept: "application/json" },
        });
        const latencyMs = Date.now() - start;

        let accepts: Decoded402Accept[] = [];
        let description = "";

        const hdr = res.headers.get("payment-required");
        if (hdr) {
          const decoded = decodePaymentRequiredHeader(hdr);
          accepts = decoded.accepts;
          description = decoded.description ?? "";
        }

        if (accepts.length === 0 && res.status === 402) {
          const body = (await res.json().catch(() => null)) as {
            accepts?: Decoded402Accept[];
            resource?: { description?: string };
          } | null;
          if (body && Array.isArray(body.accepts)) {
            accepts = body.accepts;
            description = body.resource?.description ?? description;
          }
        }

        const primary = accepts[0];
        const rawAmount = primary?.amount ? Number(primary.amount) : NaN;
        // USDC on Base/Polygon uses 6 decimals
        const probedPriceUsd = Number.isFinite(rawAmount)
          ? Number((rawAmount / 1e6).toFixed(6))
          : null;
        const probedNetworks = Array.from(
          new Set(accepts.map((a) => a.network).filter((n): n is string => Boolean(n))),
        );
        const payTo = primary?.payTo ?? null;

        const syntheticManifest: VendorManifest = {
          id: target.serviceId,
          slug: target.serviceId,
          name: target.name,
          provider: target.name,
          category: "market",
          endpoint: target.probeEndpoint,
          wellKnownUrl: target.wellKnownUrl,
          advertisedPriceUsd: probedPriceUsd ?? 0.005,
          actualChallengePriceUsd: probedPriceUsd ?? 0.005,
          network: net.id,
          payTo:
            payTo && /^0x[a-fA-F0-9]{40}$/.test(payTo)
              ? (payTo as `0x${string}`)
              : "0x0000000000000000000000000000000000000001",
          description: description || `${target.name} live HTTP 402 resource`,
          deliverableFields: ["status", "data"],
          slaMs: 3500,
          source: "kite-catalog",
        };

        const detHits = runDeterministicVendorChecks(syntheticManifest);
        const detBlocked = detHits.length > 0;
        const policyCheck =
          primary && probedPriceUsd !== null
            ? evaluatePaymentAgainstSession(tempSession, {
                endpointUrl: target.probeEndpoint,
                amountUsd: probedPriceUsd,
                caip2Network: primary.network || "",
                assetAddress: primary.asset || "",
                payTo: payTo || "0x0000000000000000000000000000000000000000",
              })
            : {
                allowed: false,
                errorCode: "session_endpoint_forbidden" as const,
                hint: `Upstream returned HTTP ${res.status} without a Kite-compatible HTTP 402 payment header.`,
              };

        return {
          serviceId: target.serviceId,
          name: target.name,
          baseUrl: target.baseUrl,
          wellKnownUrl: target.wellKnownUrl,
          probeEndpoint: target.probeEndpoint,
          source: target.source,
          reachable: true,
          httpStatus: res.status,
          probedPriceUsd,
          probedNetworks,
          payTo,
          servGuardPassed: !detBlocked,
          servGuardReason: detBlocked
            ? `Blocked: ${detHits.join("; ")}`
            : "Clean HTTP 402 manifest (no prompt injection or burn payee)",
          kitePolicyAdmitted: policyCheck.allowed,
          kitePolicyReason: policyCheck.allowed
            ? `Admitted inside $${maxPerTxUsd.toFixed(3)} cap`
            : `${policyCheck.errorCode}: ${policyCheck.hint}`,
          latencyMs,
        };
      } catch (err) {
        return {
          serviceId: target.serviceId,
          name: target.name,
          baseUrl: target.baseUrl,
          wellKnownUrl: target.wellKnownUrl,
          probeEndpoint: target.probeEndpoint,
          source: target.source,
          reachable: false,
          httpStatus: 0,
          probedPriceUsd: null,
          probedNetworks: [],
          payTo: null,
          servGuardPassed: true,
          servGuardReason: "Probe skipped (network timeout)",
          kitePolicyAdmitted: false,
          kitePolicyReason: (err as Error).message,
          latencyMs: Date.now() - start,
        };
      }
    }),
  );

  return probes;
}
