import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  bridgeSecretMatches,
  getBridgeAllowedHosts,
  getBridgeUrl,
  isHostPayable,
} from "../kite/passport-bridge";

/**
 * The Passport bridge spends from the owner's Kite allowance, so it is the
 * most dangerous surface in the app. These tests pin the two properties that
 * keep a leaked or absent secret from becoming a drained allowance.
 */
describe("Kite Passport bridge guards", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.BROKR_PASSPORT_BRIDGE_SECRET;
    delete process.env.BROKR_PASSPORT_BRIDGE_URL;
    delete process.env.BROKR_PASSPORT_BRIDGE_EXTRA_HOSTS;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("refuses every bearer when no secret is configured", () => {
    // An unconfigured bridge must be closed, not open. Defaulting to "no
    // secret means no check" would turn a forgotten env var into a public
    // endpoint that spends real money.
    assert.equal(bridgeSecretMatches("anything"), false);
    assert.equal(bridgeSecretMatches(""), false);
    assert.equal(bridgeSecretMatches(null), false);
  });

  it("accepts only the exact secret, and never a prefix or extension of it", () => {
    process.env.BROKR_PASSPORT_BRIDGE_SECRET = "s3cret-value";
    assert.equal(bridgeSecretMatches("s3cret-value"), true);
    assert.equal(bridgeSecretMatches("s3cret-valu"), false);
    assert.equal(bridgeSecretMatches("s3cret-value2"), false);
    assert.equal(bridgeSecretMatches("S3CRET-VALUE"), false);
    assert.equal(bridgeSecretMatches(" s3cret-value"), false);
  });

  it("pays only allow-listed merchant hosts, over TLS", () => {
    const allowed = ["x402.ottoai.services", "api.printmoneylab.com"];

    assert.equal(isHostPayable("https://x402.ottoai.services/token-price", allowed), true);
    assert.equal(isHostPayable("https://api.printmoneylab.com/api/v1/x", allowed), true);

    // A leaked secret must not be redirectable at an attacker's endpoint.
    assert.equal(isHostPayable("https://evil.example.com/drain", allowed), false);

    // Plain HTTP would let a downgrade leak the payment header.
    assert.equal(isHostPayable("http://x402.ottoai.services/token-price", allowed), false);

    // A look-alike host must not pass on a suffix match.
    assert.equal(isHostPayable("https://x402.ottoai.services.evil.com/x", allowed), false);
    assert.equal(isHostPayable("https://notx402.ottoai.services/x", allowed), false);

    assert.equal(isHostPayable("not a url", allowed), false);
  });

  it("treats an empty extra-hosts list as closed rather than open", () => {
    assert.deepEqual(getBridgeAllowedHosts(), []);
    process.env.BROKR_PASSPORT_BRIDGE_EXTRA_HOSTS = " , ,";
    assert.deepEqual(getBridgeAllowedHosts(), []);
    process.env.BROKR_PASSPORT_BRIDGE_EXTRA_HOSTS = "Supply.Internal:8443, other.host";
    assert.deepEqual(getBridgeAllowedHosts(), ["supply.internal:8443", "other.host"]);
  });

  it("normalises the bridge URL so a trailing slash cannot double up the path", () => {
    assert.equal(getBridgeUrl(), undefined);
    process.env.BROKR_PASSPORT_BRIDGE_URL = "https://vps.example.com///";
    assert.equal(getBridgeUrl(), "https://vps.example.com");
    process.env.BROKR_PASSPORT_BRIDGE_URL = "   ";
    assert.equal(getBridgeUrl(), undefined);
  });
});
