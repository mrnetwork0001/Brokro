/**
 * Resolving Brokro's own public origin.
 *
 * Brokro advertises itself to other agents: `/.well-known/x402` publishes
 * absolute URLs that a stranger's buyer is expected to call back. Deriving
 * those from `req.url` alone is wrong in two common cases:
 *
 *   - `next dev` binds 0.0.0.0, so the manifest advertised
 *     `http://0.0.0.0:3099/api/x402/procure`. 0.0.0.0 is a bind address, not a
 *     destination — an external agent handed that URL fails outright.
 *   - behind a proxy (Vercel), `req.url` can carry the internal host rather
 *     than the hostname the caller actually reached.
 *
 * So prefer an explicitly configured public URL, then the proxy's forwarded
 * headers, and only then fall back to the request — repairing a wildcard bind
 * address if that is all we have.
 */

const WILDCARD_HOSTS = new Set(["0.0.0.0", "[::]", "::", "[::0]"]);

function normalize(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (WILDCARD_HOSTS.has(url.hostname) || WILDCARD_HOSTS.has(`[${url.hostname}]`)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The origin Brokro should publish for itself, given the incoming request.
 *
 * Pass the request so a deployment that sits on several hostnames still hands
 * each caller back the one it actually used.
 */
export function resolvePublicOrigin(req?: Request): string {
  // 1. Explicit configuration always wins — it is the only source that knows
  //    the public hostname when the server itself cannot observe it.
  for (const candidate of [
    process.env.BROKR_URL,
    process.env.NEXT_PUBLIC_BROKR_URL,
  ]) {
    if (candidate) {
      const resolved = normalize(candidate);
      if (resolved) return resolved;
    }
  }

  // 2. Proxy-forwarded headers: what the client actually asked for.
  if (req) {
    const forwardedHost =
      req.headers.get("x-forwarded-host") || req.headers.get("host");
    if (forwardedHost) {
      const proto =
        req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
        (forwardedHost.startsWith("localhost") || forwardedHost.startsWith("127.")
          ? "http"
          : "https");
      const resolved = normalize(`${proto}://${forwardedHost.split(",")[0].trim()}`);
      if (resolved) return resolved;
    }
  }

  // 3. Vercel supplies the deployment hostname without any proxy header.
  for (const candidate of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ]) {
    if (candidate) {
      const resolved = normalize(candidate);
      if (resolved) return resolved;
    }
  }

  // 4. Last resort: the request's own origin, with a wildcard bind repaired to
  //    loopback so the URL at least resolves on this machine.
  if (req) {
    try {
      const url = new URL(req.url);
      if (WILDCARD_HOSTS.has(url.hostname)) {
        url.hostname = "127.0.0.1";
      }
      return url.origin;
    } catch {
      /* fall through */
    }
  }

  return "http://127.0.0.1:3000";
}
