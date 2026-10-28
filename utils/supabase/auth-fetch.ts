import "server-only";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export function serverAuthFetch(
  publicUrl: string,
  incomingHeaders?: Headers
): typeof fetch {
  const publicBase = new URL(publicUrl);
  const authPrefix = publicBase.pathname.replace(/\/$/, "") + "/auth/v1/";
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.origin !== publicBase.origin ||
      !url.pathname.startsWith(authPrefix)
    )
      return fetch(input, init);

    const request = new Request(input, init);
    // Never retain an IP or proof supplied through SDK options/a caller.
    const outgoing = new Headers(request.headers);
    for (const name of [
      "x-auth-client-ip",
      "sb-forwarded-for",
      "x-auth-proxy-secret",
      "cf-connecting-ip",
      "x-forwarded-for",
      "x-real-ip"
    ])
      outgoing.delete(name);
    const internalUrl = process.env.SUPABASE_AUTH_INTERNAL_URL;
    if (!internalUrl || process.env.AUTH_REAL_IP_ENABLED !== "true")
      return fetch(new Request(request, { headers: outgoing }));

    const secret = process.env.AUTH_PROXY_SECRET ?? "";
    if (!/^[a-f0-9]{64}$/.test(secret))
      throw new Error("Configuration Auth interne invalide.");
    const incoming = incomingHeaders ?? (await headers());
    const proof = incoming.get("x-auth-proxy-secret") ?? "";
    const ip = incoming.get("cf-connecting-ip") ?? "";
    if (
      !/^[a-f0-9]{64}$/.test(proof) ||
      !timingSafeEqual(Buffer.from(proof), Buffer.from(secret)) ||
      !isIP(ip)
    ) {
      throw new Error("Origine Auth sans preuve de confiance valide.");
    }
    let target: URL;
    try {
      target = new URL(internalUrl);
    } catch {
      throw new Error("Configuration Auth interne invalide.");
    }
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      target.pathname !== "/"
    )
      throw new Error("Configuration Auth interne invalide.");
    target.pathname = "/auth/v1/" + url.pathname.slice(authPrefix.length);
    target.search = url.search;
    outgoing.set("x-auth-client-ip", ip);
    outgoing.set("x-auth-proxy-secret", secret);
    outgoing.set("x-forwarded-host", publicBase.host);
    outgoing.set("x-forwarded-proto", publicBase.protocol.slice(0, -1));
    outgoing.set(
      "x-forwarded-port",
      publicBase.port || (publicBase.protocol === "https:" ? "443" : "80")
    );
    return fetch(
      new Request(
        target,
        new Request(request, { headers: outgoing, redirect: "error" })
      )
    );
  };
}
