/**
 * Kite Chain network descriptors, ERC-20 balance readers, and Pieverse
 * Facilitator health probes.
 *
 * Constants match `gokite-ai/kite-x402-services` and `BrKDDD/kite-x402-hono`:
 *   - Kite Mainnet (`eip155:2366`): Bridged USDC (`USDC.e`, 6 decimals, EIP-712 v2)
 *   - Kite Testnet (`eip155:2368`): `pieUSD` (18 decimals, EIP-712 v1)
 */

import { createPublicClient, defineChain, erc20Abi, formatUnits, http } from "viem";
import type { KiteNetworkId } from "../types";

export interface KiteNetworkConfig {
  id: KiteNetworkId;
  chainId: 2368 | 2366;
  caip2: "eip155:2368" | "eip155:2366";
  name: string;
  rpcUrl: string;
  explorerBaseUrl: string;
  faucetUrl?: string;
  asset: {
    address: `0x${string}`;
    symbol: "pieUSD" | "USDC.e";
    decimals: number;
    eip712Name: string;
    eip712Version: string;
  };
}

export const PIEVERSE_FACILITATOR_URL =
  process.env.FACILITATOR_URL || "https://facilitator.pieverse.io/v2";

export const KITE_NETWORKS: Record<KiteNetworkId, KiteNetworkConfig> = {
  testnet: {
    id: "testnet",
    chainId: 2368,
    caip2: "eip155:2368",
    name: "KiteAI Testnet",
    rpcUrl: process.env.KITE_TESTNET_RPC_URL || "https://rpc-testnet.gokite.ai/",
    explorerBaseUrl: "https://testnet.kitescan.ai",
    faucetUrl: "https://faucet.gokite.ai",
    asset: {
      address: "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A",
      symbol: "pieUSD",
      decimals: 18,
      eip712Name: "pieUSD",
      eip712Version: "1",
    },
  },
  mainnet: {
    id: "mainnet",
    chainId: 2366,
    caip2: "eip155:2366",
    name: "KiteAI Mainnet",
    rpcUrl: process.env.KITE_MAINNET_RPC_URL || "https://rpc.gokite.ai/",
    explorerBaseUrl: "https://kitescan.ai",
    asset: {
      address: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
      symbol: "USDC.e",
      decimals: 6,
      eip712Name: "Bridged USDC (Kite AI)",
      eip712Version: "2",
    },
  },
};

export function getActiveKiteNetwork(): KiteNetworkConfig {
  const raw = (process.env.KITE_NETWORK || "testnet").trim().toLowerCase();
  if (raw === "mainnet" || raw === "2366" || raw === "eip155:2366") {
    return KITE_NETWORKS.mainnet;
  }
  return KITE_NETWORKS.testnet;
}

export function resolveKiteNetwork(id?: string): KiteNetworkConfig {
  if (!id) return getActiveKiteNetwork();
  const norm = id.trim().toLowerCase();
  if (norm === "mainnet" || norm === "2366" || norm === "eip155:2366") {
    return KITE_NETWORKS.mainnet;
  }
  return KITE_NETWORKS.testnet;
}

export function buildViemKiteChain(net: KiteNetworkConfig) {
  return defineChain({
    id: net.chainId,
    name: net.name,
    nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
    rpcUrls: {
      default: { http: [net.rpcUrl] },
    },
    blockExplorers: {
      default: { name: "KiteScan", url: net.explorerBaseUrl },
    },
  });
}

/**
 * Converts a positive USD string or number (up to 6 decimal places) into exact
 * atomic integer units for the target Kite settlement token.
 */
export function usdToAtomicUnits(usd: number | string, decimals: number): string {
  const clean = (typeof usd === "number" ? usd.toFixed(6) : usd.trim().replace(/^\$/, ""))
    .replace(/\.?0+$/, "");
  const normalized = clean === "" ? "0" : clean;
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error(`Invalid USD price "${usd}": must be a positive decimal with <= 6 decimals`);
  }
  const [whole = "0", frac = ""] = normalized.split(".");
  const atomic = BigInt(whole + frac.padEnd(decimals, "0"));
  if (atomic <= 0n) {
    throw new Error(`USD price "${usd}" must be greater than zero`);
  }
  return atomic.toString();
}

export function atomicUnitsToUsd(atomic: string | bigint, decimals: number): number {
  const formatted = formatUnits(BigInt(atomic), decimals);
  return Math.round(Number(formatted) * 1_000_000) / 1_000_000;
}

export function explorerTxUrl(net: KiteNetworkConfig, txHash: string): string {
  return `${net.explorerBaseUrl}/tx/${txHash}`;
}

export function explorerAddressUrl(net: KiteNetworkConfig, address: string): string {
  return `${net.explorerBaseUrl}/address/${address}`;
}

export async function readKiteWalletBalances(
  address: `0x${string}`,
  net: KiteNetworkConfig = getActiveKiteNetwork(),
): Promise<{
  tokenRaw: string;
  tokenFormatted: string;
  tokenUsd: number;
  nativeKiteFormatted: string;
}> {
  const client = createPublicClient({
    chain: buildViemKiteChain(net),
    transport: http(net.rpcUrl, { timeout: 6_000 }),
  });

  const [tokenBal, nativeBal] = await Promise.all([
    client.readContract({
      address: net.asset.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
    client.getBalance({ address }),
  ]);

  const tokenFormatted = formatUnits(tokenBal, net.asset.decimals);
  return {
    tokenRaw: tokenBal.toString(),
    tokenFormatted,
    tokenUsd: Math.round(Number(tokenFormatted) * 1_000_000) / 1_000_000,
    nativeKiteFormatted: formatUnits(nativeBal, 18),
  };
}

export async function checkFacilitatorHealth(): Promise<{
  ok: boolean;
  facilitatorUrl: string;
  kiteTestnetSupported: boolean;
  kiteMainnetSupported: boolean;
  signers: string[];
  latencyMs: number;
}> {
  const start = Date.now();
  const url = `${PIEVERSE_FACILITATOR_URL.replace(/\/+$/, "")}/supported`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      return {
        ok: false,
        facilitatorUrl: PIEVERSE_FACILITATOR_URL,
        kiteTestnetSupported: false,
        kiteMainnetSupported: false,
        signers: [],
        latencyMs: Date.now() - start,
      };
    }
    const body = (await res.json()) as {
      kinds?: Array<{ network?: string; scheme?: string }>;
      signers?: Record<string, string[]>;
    };
    const networks = new Set((body.kinds ?? []).map((k) => k.network));
    return {
      ok: true,
      facilitatorUrl: PIEVERSE_FACILITATOR_URL,
      kiteTestnetSupported: networks.has("eip155:2368"),
      kiteMainnetSupported: networks.has("eip155:2366"),
      signers: body.signers?.["eip155:*"] ?? [],
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      ok: false,
      facilitatorUrl: PIEVERSE_FACILITATOR_URL,
      kiteTestnetSupported: false,
      kiteMainnetSupported: false,
      signers: [],
      latencyMs: Date.now() - start,
    };
  }
}
