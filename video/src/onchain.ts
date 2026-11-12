import onchain from "../data/onchain.json";

/**
 * The shape of `data/onchain.json`, which `scripts/onchain.mjs` writes by
 * reading every transaction in the film back off Base.
 *
 * The scenes used to cast the import to `any`, which meant a renamed field
 * would have reached the render as `undefined` on screen rather than as a
 * type error. Declaring it once here keeps the figures honest at build time.
 */
export interface OnchainTransfer {
  from: string;
  to: string;
  amount: string;
}

export interface OnchainTx {
  label: string;
  hash: string;
  block: number;
  status: string;
  utc: string;
  gasPaidBy: string;
  explorer: string;
  blockscout: string;
  transfers: OnchainTransfer[];
}

export interface OnchainWallet {
  address: string;
  usdc: string;
  eth: string;
}

export interface OnchainData {
  readAt: string;
  chain: string;
  chainId: number;
  asset: { address: string; symbol: string; decimals: number };
  txs: Record<"bridge" | "passport" | "otto1" | "otto2" | "pml", OnchainTx>;
  wallets: Record<"passportWallet" | "buyerSigner", OnchainWallet>;
}

export const ONCHAIN = onchain as unknown as OnchainData;
