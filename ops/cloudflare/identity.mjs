import { isIP } from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";

// Reject lists, ports, zone IDs, whitespace and IPv4 alternative spellings.
export function canonicalIp(value) {
  if (typeof value !== "string" || value.includes("%") || !isIP(value))
    return null;
  if (isIP(value) === 4) return value;
  const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(ip);
  if (!mapped) return ip;
  const n =
    Number.parseInt(mapped[1], 16) * 65536 + Number.parseInt(mapped[2], 16);
  return [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join(".");
}

export function equalSecret(actual, expected) {
  return (
    typeof actual === "string" &&
    /^[a-f0-9]{64}$/.test(actual) &&
    /^[a-f0-9]{64}$/.test(expected) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

export function ipIdentity(ip, key, version) {
  const canonical = canonicalIp(ip);
  if (
    !canonical ||
    !/^[a-f0-9]{64}$/.test(key) ||
    !/^v[1-9][0-9]*$/.test(version)
  )
    throw new Error("Invalid IP identity configuration");
  return `${version}:${createHmac("sha256", Buffer.from(key, "hex"))
    .update(`yokkai:client-ip:${version}\0${canonical}`)
    .digest("hex")}`;
}

export const untrustedHeaders = [
  "forwarded",
  "x-forwarded-for",
  "x-real-ip",
  "true-client-ip",
  "client-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "x-original-forwarded-for",
  "x-auth-client-ip",
  "sb-forwarded-for",
  "x-auth-proxy-secret",
  "x-envoy-external-address",
  "x-envoy-internal",
  "cf-connecting-ipv6",
  "x-yokkai-client-ip",
  "x-yokkai-ip-hmac",
  "x-yokkai-edge-proof"
];
