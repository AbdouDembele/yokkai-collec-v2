import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalIp,
  equalSecret,
  ipIdentity,
  untrustedHeaders
} from "../ops/cloudflare/identity.mjs";
import {
  renderFirewall,
  renderMiddleware,
  validateRanges
} from "../ops/cloudflare/render.mjs";

const ipv4 = Array.from({ length: 10 }, (_, i) => `10.${i}.0.0/16`);
const ipv6 = Array.from({ length: 5 }, (_, i) => `2001:${i}::/32`);
const key = "a".repeat(64);
test("canonical IPv4/IPv6 cannot be chosen through lists, ports or zones", () => {
  assert.equal(canonicalIp("2001:0DB8:0:0:0:0:0:1"), "2001:db8::1");
  assert.equal(canonicalIp("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(canonicalIp("::FFFF:c000:0201"), "192.0.2.1");
  assert.equal(canonicalIp("192.0.2.1"), "192.0.2.1");
  for (const ip of [
    "192.0.2.1, 1.1.1.1",
    " 1.1.1.1",
    "1.1.1.1 ",
    "[::1]",
    "fe80::1%eth0",
    "1.1.1.1:80",
    "010.0.0.1",
    "2130706433",
    "",
    null,
    ["1.1.1.1"]
  ])
    assert.equal(canonicalIp(ip), null);
});
test("identities are keyed, versioned, canonical, and reveal no raw address", () => {
  const id = ipIdentity("192.0.2.1", key, "v1");
  assert.match(id, /^v1:[a-f0-9]{64}$/);
  assert.equal(id, ipIdentity("::ffff:c000:201", key, "v1"));
  assert.notEqual(id, ipIdentity("192.0.2.1", "b".repeat(64), "v1"));
  assert.notEqual(id, ipIdentity("192.0.2.1", key, "v2"));
  assert.throws(() => ipIdentity("1.1.1.1", "short", "v1"));
  assert.equal(equalSecret(key, key), true);
  assert.equal(equalSecret("b".repeat(64), key), false);
  assert.equal(equalSecret(undefined, key), false);
});
test("proxy checks actual peer before scrubbing and deriving identity", () => {
  const m = renderMiddleware(ipv4, ipv6, key).http.middlewares;
  assert.deepEqual(m["yokkai-edge"].chain.middlewares, [
    "yokkai-cf-only",
    "yokkai-ip-scrub",
    "yokkai-ip-verify",
    "yokkai-proof-strip"
  ]);
  assert.equal(m["yokkai-cf-only"].ipAllowList.ipStrategy, undefined);
  assert.equal(m["yokkai-cf-only"].ipAllowList.sourceRange.length, 15);
  const scrub = m["yokkai-ip-scrub"].headers.customRequestHeaders;
  for (const name of untrustedHeaders)
    assert.equal(scrub[name], name === "x-yokkai-edge-proof" ? key : "");
  assert.equal(scrub["x-yokkai-edge-proof"], key);
  assert.equal(m["yokkai-ip-verify"].forwardAuth.trustForwardHeader, false);
  assert.deepEqual(m["yokkai-ip-verify"].forwardAuth.authRequestHeaders, [
    "CF-Connecting-IP",
    "X-Yokkai-Edge-Proof"
  ]);
  assert.equal(
    m["yokkai-proof-strip"].headers.customRequestHeaders["X-Yokkai-Edge-Proof"],
    ""
  );
  assert.equal(
    m["yokkai-proof-strip"].headers.customResponseHeaders["x-yokkai-ip-hmac"],
    ""
  );
});
test("firewall covers IPv6, Docker DNAT, UDP and keeps SSH; fails closed on malformed lists", () => {
  const rules = renderFirewall(ipv4, ipv6);
  assert.match(rules, /hook prerouting priority -110/);
  assert.match(rules, /ip6 saddr @cf6/);
  assert.match(rules, /udp dport 443 counter drop/);
  assert.match(rules, /tcp dport 1022 return/);
  assert.match(rules, /meta l4proto \{ tcp, udp \} counter drop/);
  assert.doesNotMatch(rules, /flush ruleset/);
  assert.throws(() => validateRanges(["0.0.0.0/0"], 4));
  assert.throws(() => validateRanges([...ipv4.slice(1), "0.0.0.0/0"], 4));
  assert.throws(() => renderFirewall(ipv4, ipv6, 'eth0";'));
});
