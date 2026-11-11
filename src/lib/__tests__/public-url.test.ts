import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { resolvePublicOrigin } from "../public-url";

const ENV_KEYS = [
  "BROKR_URL",
  "NEXT_PUBLIC_BROKR_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

describe("Public origin resolution", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("never advertises a wildcard bind address", () => {
    // The regression: `next dev` binds 0.0.0.0, so /.well-known/x402 was
    // publishing http://0.0.0.0:3099/api/x402/procure to external agents.
    const req = new Request("http://0.0.0.0:3099/.well-known/x402");
    const origin = resolvePublicOrigin(req);
    assert.ok(!origin.includes("0.0.0.0"), `leaked wildcard host: ${origin}`);
    assert.equal(origin, "http://127.0.0.1:3099");
  });

  it("prefers an explicitly configured public URL over the request", () => {
    process.env.BROKR_URL = "https://brokro.example.com";
    const req = new Request("http://0.0.0.0:3099/.well-known/x402");
    assert.equal(resolvePublicOrigin(req), "https://brokro.example.com");
  });

  it("strips trailing slashes and infers a scheme when missing", () => {
    process.env.BROKR_URL = "brokro.example.com/";
    assert.equal(resolvePublicOrigin(), "https://brokro.example.com");
  });

  it("ignores a configured URL that is itself a wildcard bind", () => {
    process.env.BROKR_URL = "http://0.0.0.0:3099";
    const req = new Request("https://real-host.example.com/x");
    assert.equal(resolvePublicOrigin(req), "https://real-host.example.com");
  });

  it("honours proxy forwarded headers ahead of the internal request host", () => {
    const req = new Request("http://10.0.0.7:3000/.well-known/x402", {
      headers: {
        "x-forwarded-host": "brokro.vercel.app",
        "x-forwarded-proto": "https",
      },
    });
    assert.equal(resolvePublicOrigin(req), "https://brokro.vercel.app");
  });

  it("takes the first entry of a comma-joined forwarded header chain", () => {
    const req = new Request("http://10.0.0.7:3000/x", {
      headers: {
        "x-forwarded-host": "brokro.vercel.app, internal.proxy",
        "x-forwarded-proto": "https, http",
      },
    });
    assert.equal(resolvePublicOrigin(req), "https://brokro.vercel.app");
  });

  it("keeps http for loopback hosts so local dev is not forced to https", () => {
    const req = new Request("http://127.0.0.1:3099/x", {
      headers: { host: "127.0.0.1:3099" },
    });
    assert.equal(resolvePublicOrigin(req), "http://127.0.0.1:3099");
  });

  it("falls back to the Vercel deployment host when no proxy header is present", () => {
    process.env.VERCEL_URL = "brokro-abc123.vercel.app";
    assert.equal(resolvePublicOrigin(), "https://brokro-abc123.vercel.app");
  });
});
