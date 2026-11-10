/**
 * Multi-chain x402 settlement network registry.
 *
 * Brokro's own supply nodes settle on Kite Chain, but the real third-party
 * merchants it shops from (Otto AI, PrintMoneyLab, IP402 — all discovered via
 * Kite `ksearch`) price their HTTP 402 challenges in **USDC on Base**. A broker
 * that can only pay on its home chain cannot actually buy from the ecosystem,
 * so a Kite Agent Passport session here authorizes an explicit *set* of
 * (network, asset) pairs and refuses everything outside it.
 *
 * Addresses and EIP-712 domains below are taken from the live
 * `PAYMENT-REQUIRED` headers these merchants actually serve.
 */

import { createPublicClient, defineChain, erc20Abi, formatUnits, http } from "viem";
import { base, polygon } from "viem/chains";
import { KITE_NETWORKS } from "../kite/networks";

export interface SettlementAsset {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  eip712Name: string;
  eip712Version: string;
}

export interface SettlementNetwork {
  caip2: `${string}:${string}`;
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerBaseUrl: string;
  asset: SettlementAsset;
  /** True for networks where a payment moves real, non-test value. */
  realValue: boolean;
}

export const SETTLEMENT_NETWORKS: Record<string, SettlementNetwork> = {
  "eip155:2368": {
    caip2: "eip155:2368",
    chainId: 2368,
    name: "Kite Testnet",
    rpcUrl: KITE_NETWORKS.testnet.rpcUrl,
    explorerBaseUrl: KITE_NETWORKS.testnet.explorerBaseUrl,
    asset: {
      address: KITE_NETWORKS.testnet.asset.address,
      symbol: "pieUSD",
      decimals: 18,
      eip712Name: "pieUSD",
      eip712Version: "1",
    },
    realValue: false,
  },
  "eip155:2366": {
    caip2: "eip155:2366",
    chainId: 2366,
    name: "Kite Mainnet",
    rpcUrl: KITE_NETWORKS.mainnet.rpcUrl,
    explorerBaseUrl: KITE_NETWORKS.mainnet.explorerBaseUrl,
    asset: {
      address: KITE_NETWORKS.mainnet.asset.address,
      symbol: "USDC.e",
      decimals: 6,
      eip712Name: "Bridged USDC (Kite AI)",
      eip712Version: "2",
    },
    realValue: true,
  },
  "eip155:8453": {
    caip2: "eip155:8453",
    chainId: 8453,
    name: "Base Mainnet",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    explorerBaseUrl: "https://basescan.org",
    asset: {
      // Circle-native USDC on Base, exactly as Otto AI & PrintMoneyLab demand it.
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      decimals: 6,
      eip712Name: "USD Coin",
      eip712Version: "2",
    },
    realValue: true,
  },
  "eip155:137": {
    caip2: "eip155:137",
    chainId: 137,
    name: "Polygon",
    rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
    explorerBaseUrl: "https://polygonscan.com",
    asset: {
      address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      symbol: "USDC",
      decimals: 6,
      eip712Name: "USD Coin",
      eip712Version: "2",
    },
    realValue: true,
  },
};

export function getSettlementNetwork(caip2: string): SettlementNetwork | undefined {
  return SETTLEMENT_NETWORKS[caip2.trim().toLowerCase()];
}

export function buildViemChain(net: SettlementNetwork) {
  if (net.chainId === 8453) return base;
  if (net.chainId === 137) return polygon;
  return defineChain({
    id: net.chainId,
    name: net.name,
    nativeCurrency:
      net.chainId === 2368 || net.chainId === 2366
        ? { name: "KITE", symbol: "KITE", decimals: 18 }
        : { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
    blockExplorers: { default: { name: net.name, url: net.explorerBaseUrl } },
  });
}

export function settlementExplorerTxUrl(net: SettlementNetwork, txHash: string): string {
  return `${net.explorerBaseUrl}/tx/${txHash}`;
}

/**
 * Reads the buyer's spendable balance of a settlement asset. Used to decide
 * whether an external purchase can actually settle, instead of assuming it can.
 */
export async function readSettlementBalance(
  net: SettlementNetwork,
  address: `0x${string}`,
): Promise<{ raw: string; formatted: string; usd: number; readable: boolean }> {
  try {
    const client = createPublicClient({
      chain: buildViemChain(net),
      transport: http(net.rpcUrl, { timeout: 6_000 }),
    });
    const bal = await client.readContract({
      address: net.asset.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    const formatted = formatUnits(bal, net.asset.decimals);
    return {
      raw: bal.toString(),
      formatted,
      usd: Math.round(Number(formatted) * 1_000_000) / 1_000_000,
      readable: true,
    };
  } catch {
    return { raw: "0", formatted: "0", usd: 0, readable: false };
  }
}
