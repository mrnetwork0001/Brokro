/**
 * Operator wallet & merchant payee configuration for Kite Chain.
 */

import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toClientEvmSigner, type ClientEvmSigner } from "@x402/evm";
import { buildViemKiteChain, getActiveKiteNetwork, type KiteNetworkConfig } from "./networks";

// Deterministic fallback key used ONLY in offline unit tests when .env is absent.
const TEST_ONLY_FALLBACK_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

export function getBuyerAccount() {
  const raw = process.env.BROKR_BUYER_PRIVATE_KEY?.trim();
  const pk = (raw && raw.startsWith("0x") ? raw : TEST_ONLY_FALLBACK_PK) as `0x${string}`;
  return privateKeyToAccount(pk);
}

export function getMerchantPayTo(): `0x${string}` {
  const configured = process.env.BROKR_MERCHANT_PAY_TO?.trim();
  if (configured && /^0x[a-fA-F0-9]{40}$/.test(configured)) {
    return configured as `0x${string}`;
  }
  // Default to a distinct deterministic merchant treasury address if unset
  return "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
}

export function isPaymentsEnabled(): boolean {
  return (process.env.BROKR_PAYMENTS || "on").trim().toLowerCase() !== "off";
}

export function isSignedSandboxFallbackAllowed(): boolean {
  return (process.env.BROKR_ALLOW_SIGNED_SANDBOX || "auto").trim().toLowerCase() !== "off";
}

export function createKiteX402Signer(
  net: KiteNetworkConfig = getActiveKiteNetwork(),
): ClientEvmSigner {
  const account = getBuyerAccount();
  const publicClient = createPublicClient({
    chain: buildViemKiteChain(net),
    transport: http(net.rpcUrl, { timeout: 8_000 }),
  });
  return toClientEvmSigner(account, publicClient);
}

/**
 * Builds an x402 signer for ANY authorized settlement chain, so the same agent
 * identity that shops on Kite can also pay a Base-priced external merchant
 * without ever leaving its mandate.
 */
export function createX402SignerForChain(params: {
  chain: Parameters<typeof createPublicClient>[0]["chain"];
  rpcUrl: string;
}): ClientEvmSigner {
  const account = getBuyerAccount();
  const publicClient = createPublicClient({
    chain: params.chain,
    transport: http(params.rpcUrl, { timeout: 8_000 }),
  });
  return toClientEvmSigner(account, publicClient);
}

/**
 * External-merchant settlement mode.
 *   - "off":      never touch third-party merchants
 *   - "preflight" (default): probe their real 402 headers and policy-check them,
 *                  but never sign — nothing of value moves
 *   - "on":       actually settle real USDC purchases from real merchants
 *
 * Defaults to "preflight" so cloning this repo can never spend real money by
 * accident. Real value only moves when an operator explicitly opts in.
 */
export type ExternalSettlementMode = "off" | "preflight" | "on";

export function getExternalSettlementMode(): ExternalSettlementMode {
  const raw = (process.env.BROKR_EXTERNAL_SETTLEMENT || "preflight").trim().toLowerCase();
  if (raw === "on" || raw === "live") return "on";
  if (raw === "off" || raw === "none") return "off";
  return "preflight";
}
