/**
 * Reads every transaction the film shows back from Base mainnet.
 *
 * Nothing in the script is typed by hand: the hashes, blocks, UTC times,
 * decoded transfers and gas payers all come from here, so a figure on screen
 * can always be traced to a chain read rather than to a draft.
 */
import { createPublicClient, http, erc20Abi, formatUnits, decodeEventLog } from "viem";
import { base } from "viem/chains";
import { writeFileSync } from "node:fs";

const c = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const SHOTS = [
  { key: "bridge",   hash: "0x61298b6612cdb30c9a23d84541da7e93635746fa3ad904364dcabdd3774b10f8", label: "Otto AI DEX Price, paid through the Passport bridge from the deployed site" },
  { key: "passport", hash: "0xb5563b5e338ab94750134d18252c96aadfe9cdf4909ddad828961f31419dd35b", label: "Otto AI Token Security, first payment through the Kite Passport allowance" },
  { key: "otto1",    hash: "0x6b5f2f808e0a3db1996a2368e3bdff943e5158c3b543e1d2bea49816dff8e1e4", label: "Otto AI Token Security, signer rail" },
  { key: "otto2",    hash: "0x530519ba8f100ee7e5b9f95ca16a17708ecafae5013cabdee7921aed76886a22", label: "Otto AI DEX Price, signer rail" },
  { key: "pml",      hash: "0x9ad6fe9eacfa4488172f25e32b53aaf40acc1ff7cea5dcae3bb9048aec92eb4b", label: "PrintMoneyLab Kimchi Premium, signer rail" },
];

const out = { readAt: new Date().toISOString(), chain: "base", chainId: 8453, asset: { address: USDC, symbol: "USDC", decimals: 6 }, txs: {} };

for (const shot of SHOTS) {
  const r = await c.getTransactionReceipt({ hash: shot.hash });
  const block = await c.getBlock({ blockNumber: r.blockNumber });
  const transfers = [];
  for (const log of r.logs) {
    if (log.address.toLowerCase() !== USDC.toLowerCase()) continue;
    try {
      const d = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      if (d.eventName === "Transfer") {
        transfers.push({ from: d.args.from, to: d.args.to, amount: formatUnits(d.args.value, 6) });
      }
    } catch {}
  }
  out.txs[shot.key] = {
    label: shot.label,
    hash: shot.hash,
    block: Number(r.blockNumber),
    status: r.status,
    utc: new Date(Number(block.timestamp) * 1000).toISOString(),
    gasPaidBy: r.from,
    explorer: `https://basescan.org/tx/${shot.hash}`,
    transfers,
  };
  console.log(`${shot.key.padEnd(9)} block ${r.blockNumber}  ${r.status}  ${transfers.map(t => t.amount + " USDC").join(", ")}`);
}

// Wallets the film names, read live so a balance on screen is never stale.
const WALLETS = {
  passportWallet: "0x86d97809E8f481B58CcbCe4f0d26C28F91413E2C",
  buyerSigner: "0xD57411EF1A903B1954D23A869CF7A7C3df847bCc",
};
out.wallets = {};
for (const [k, addr] of Object.entries(WALLETS)) {
  const [usdc, eth] = await Promise.all([
    c.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
    c.getBalance({ address: addr }),
  ]);
  out.wallets[k] = { address: addr, usdc: formatUnits(usdc, 6), eth: formatUnits(eth, 18) };
  console.log(`${k.padEnd(16)} ${formatUnits(usdc, 6)} USDC   ${formatUnits(eth, 18)} ETH`);
}

writeFileSync(new URL("../data/onchain.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("\nwrote data/onchain.json");
