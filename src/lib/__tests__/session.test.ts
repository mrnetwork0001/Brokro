import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionPolicy,
  evaluatePaymentAgainstSession,
  PaymentNonceReplayGuard,
  reserveSessionSpend,
} from "../kite/session";

describe("Kite Passport Session Policy Engine", () => {
  it("admits valid x402 payment within per-tx and total session bounds", () => {
    const s = createSessionPolicy({
      taskSummary: "Unit test mandate",
      ownerAddress: "0x1111111111111111111111111111111111111111",
      agentAddress: "0x2222222222222222222222222222222222222222",
      network: "testnet",
      maxAmountPerTxUsd: 0.015,
      maxTotalAmountUsd: 0.035,
      ttlMinutes: 30,
      allowedHosts: ["localhost:3000"],
    });

    const evalRes = evaluatePaymentAgainstSession(s, {
      endpointUrl: "http://localhost:3000/api/x402/vendors/registry-audit",
      amountUsd: 0.006,
      caip2Network: "eip155:2368",
      assetAddress: "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A",
      payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    });

    assert.equal(evalRes.allowed, true);
  });

  it("blocks bait-and-switch 402 price spikes with session_rule_exceeded", () => {
    const s = createSessionPolicy({
      taskSummary: "Spike defense test",
      ownerAddress: "0x1111111111111111111111111111111111111111",
      agentAddress: "0x2222222222222222222222222222222222222222",
      network: "testnet",
      maxAmountPerTxUsd: 0.015,
      maxTotalAmountUsd: 0.05,
      ttlMinutes: 30,
      allowedHosts: ["localhost:3000"],
    });

    const evalRes = evaluatePaymentAgainstSession(s, {
      endpointUrl: "http://localhost:3000/api/x402/vendors/flash-chain-intel",
      amountUsd: 0.085,
      caip2Network: "eip155:2368",
      assetAddress: "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A",
      payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    });

    assert.equal(evalRes.allowed, false);
    assert.equal(evalRes.errorCode, "session_rule_exceeded");
  });

  it("enforces host scope, burn-payee rejection, asset lock, and TTL expiry", () => {
    const s = createSessionPolicy({
      taskSummary: "Scope checks",
      ownerAddress: "0x1111111111111111111111111111111111111111",
      agentAddress: "0x2222222222222222222222222222222222222222",
      network: "mainnet",
      maxAmountPerTxUsd: 0.02,
      maxTotalAmountUsd: 0.05,
      ttlMinutes: 10,
      allowedHosts: ["trybrokr.vercel.app"],
    });

    // Wrong host
    const wrongHost = evaluatePaymentAgainstSession(s, {
      endpointUrl: "https://evil.example.com/api/x402",
      amountUsd: 0.005,
      caip2Network: "eip155:2366",
      assetAddress: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
      payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    });
    assert.equal(wrongHost.errorCode, "session_endpoint_forbidden");

    // Burn payee
    const burnPayee = evaluatePaymentAgainstSession(s, {
      endpointUrl: "https://trybrokr.vercel.app/api/x402/vendors/rogue",
      amountUsd: 0.005,
      caip2Network: "eip155:2366",
      assetAddress: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
      payTo: "0x000000000000000000000000000000000000dEaD",
    });
    assert.equal(burnPayee.errorCode, "payment_target_forbidden");

    // Wrong token
    const wrongAsset = evaluatePaymentAgainstSession(s, {
      endpointUrl: "https://trybrokr.vercel.app/api/x402/vendors/ok",
      amountUsd: 0.005,
      caip2Network: "eip155:2368",
      assetAddress: "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A",
      payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    });
    assert.equal(wrongAsset.errorCode, "session_asset_forbidden");

    // Expired TTL
    const expired = evaluatePaymentAgainstSession(s, {
      endpointUrl: "https://trybrokr.vercel.app/api/x402/vendors/ok",
      amountUsd: 0.005,
      caip2Network: "eip155:2366",
      assetAddress: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
      payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      nowMs: Date.now() + 60 * 60 * 1000,
    });
    assert.equal(expired.errorCode, "session_expired");
  });

  it("prevents concurrent spend reservations from racing past maxTotalAmountUsd", () => {
    const s = createSessionPolicy({
      taskSummary: "5-way concurrency race",
      ownerAddress: "0x1111111111111111111111111111111111111111",
      agentAddress: "0x2222222222222222222222222222222222222222",
      network: "testnet",
      maxAmountPerTxUsd: 0.01,
      maxTotalAmountUsd: 0.025,
      ttlMinutes: 30,
      allowedHosts: ["localhost:3000"],
    });

    const attempts = Array.from({ length: 5 }, () =>
      reserveSessionSpend(s, {
        endpointUrl: "http://localhost:3000/api/x402/vendors/registry-audit",
        amountUsd: 0.01,
        caip2Network: "eip155:2368",
        assetAddress: "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A",
        payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      }),
    );

    const winners = attempts.filter((a) => a.ok);
    const losers = attempts.filter((a) => !a.ok);

    assert.equal(winners.length, 2, "Only 2 x $0.01 calls fit inside $0.025 total cap");
    assert.equal(losers.length, 3);
    for (const l of losers) {
      if (!l.ok) assert.equal(l.evaluation.errorCode, "session_total_exceeded");
    }

    for (const w of winners) {
      if (w.ok) w.lease.commit();
    }
    assert.equal(s.spentUsd, 0.02);
    assert.equal(s.txCount, 2);
  });

  it("detects and blocks EIP-3009 authorization nonce replays", () => {
    const guard = new PaymentNonceReplayGuard();
    const first = guard.reserve("0xAbCdEf0000000000000000000000000000000001", "0xdeadbeef01");
    assert.ok(first);
    first.commit();

    const replay = guard.reserve("0xabcdef0000000000000000000000000000000001", "0xDEADBEEF01");
    assert.equal(replay, null);
  });
});
