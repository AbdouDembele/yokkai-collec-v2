import { BlockList, isIP } from "node:net";
import { untrustedHeaders } from "./identity.mjs";

export function validateRanges(ranges, family) {
  if (
    !Array.isArray(ranges) ||
    ranges.length < (family === 4 ? 10 : 5) ||
    ranges.length > 100
  )
    throw new Error("Unexpected Cloudflare ranges");
  for (const value of ranges) {
    const [ip, prefix, extra] = value.split("/");
    if (
      extra ||
      isIP(ip) !== family ||
      !/^\d+$/.test(prefix) ||
      Number(prefix) < (family === 4 ? 8 : 16) ||
      Number(prefix) > (family === 4 ? 32 : 128)
    )
      throw new Error("Invalid Cloudflare CIDR");
    new BlockList().addSubnet(
      ip,
      Number(prefix),
      family === 4 ? "ipv4" : "ipv6"
    );
  }
  return [...new Set(ranges)];
}

export function renderMiddleware(ipv4, ipv6, proof) {
  if (!/^[a-f0-9]{64}$/.test(proof)) throw new Error("Invalid proxy proof");
  const ranges = [...validateRanges(ipv4, 4), ...validateRanges(ipv6, 6)];
  return {
    http: {
      middlewares: {
        "yokkai-edge": {
          chain: {
            middlewares: [
              "yokkai-cf-only",
              "yokkai-ip-scrub",
              "yokkai-ip-verify",
              "yokkai-proof-strip"
            ]
          }
        },
        // No ipStrategy.depth: evaluate the TCP peer, never an incoming XFF.
        "yokkai-cf-only": { ipAllowList: { sourceRange: ranges } },
        "yokkai-ip-scrub": {
          headers: {
            customRequestHeaders: {
              ...Object.fromEntries(untrustedHeaders.map(name => [name, ""])),
              "x-yokkai-edge-proof": proof
            }
          }
        },
        "yokkai-ip-verify": {
          forwardAuth: {
            address: "http://yokkai-edge-identity:9080/verify",
            trustForwardHeader: false,
            authRequestHeaders: ["CF-Connecting-IP", "X-Yokkai-Edge-Proof"],
            authResponseHeaders: [
              "X-Yokkai-Client-IP",
              "X-Yokkai-IP-HMAC",
              "CF-Connecting-IP",
              "X-Real-IP",
              "X-Forwarded-For"
            ]
          }
        },
        "yokkai-proof-strip": {
          headers: {
            customRequestHeaders: { "X-Yokkai-Edge-Proof": "" },
            customResponseHeaders: Object.fromEntries(
              [...untrustedHeaders, "cf-connecting-ip"].map(name => [name, ""])
            )
          }
        }
      }
    }
  };
}

export function renderFirewall(ipv4, ipv6, iface = "eth0", sshPort = 1022) {
  if (
    !/^[a-zA-Z0-9_.-]+$/.test(iface) ||
    !Number.isInteger(sshPort) ||
    sshPort < 1 ||
    sshPort > 65535
  )
    throw new Error("Invalid firewall configuration");
  const v4 = validateRanges(ipv4, 4).join(", ");
  const v6 = validateRanges(ipv6, 6).join(", ");
  // A dedicated table; never flush the host/Docker ruleset. Prerouting is before DNAT.
  return `table inet yokkai_cloudflare {
  set cf4 { type ipv4_addr; flags interval; elements = { ${v4} }; }
  set cf6 { type ipv6_addr; flags interval; elements = { ${v6} }; }
  chain ingress {
    type filter hook prerouting priority -110; policy accept;
    iifname != "${iface}" return
    tcp dport { 80, 443 } ip saddr @cf4 return
    tcp dport { 80, 443 } ip6 saddr @cf6 return
    tcp dport { 80, 443 } counter drop
    udp dport 443 ip saddr @cf4 return
    udp dport 443 ip6 saddr @cf6 return
    udp dport 443 counter drop
    ct state established,related return
    udp sport 67 udp dport 68 return
    ip6 saddr fe80::/10 udp sport 547 udp dport 546 return
    tcp dport ${sshPort} return
    meta l4proto { tcp, udp } counter drop
  }
}
`;
}
