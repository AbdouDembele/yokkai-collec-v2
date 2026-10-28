import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { PassThrough, Readable, pipeline } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const globalAddresses = new BlockList();
globalAddresses.addSubnet("0.0.0.0", 0);
globalAddresses.addSubnet("2000::", 3, "ipv6");
const reservedAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
])
  reservedAddresses.addSubnet(address, prefix);
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20]
]) {
  reservedAddresses.addSubnet(address, prefix, "ipv6");
}

function requirePublicAddress(address) {
  const family = isIP(address);
  const type = family === 6 ? "ipv6" : "ipv4";
  if (
    !family ||
    !globalAddresses.check(address, type) ||
    reservedAddresses.check(address, type)
  ) {
    throw Object.assign(new Error("The image must use a public IP address."), {
      code: "ERR_IMAGE_ADDRESS"
    });
  }
}

export function validateImageURL(input) {
  const url = new URL(input);
  if (url.protocol !== "https:") throw new Error("The image must use HTTPS.");
  if (url.username || url.password)
    throw new Error("Credentials in image URLs are not allowed.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) requirePublicAddress(hostname);
  return url;
}

// Validate the addresses returned to the actual TLS socket: no second DNS lookup.
// HTTPS does not follow redirects; certificate verification keeps the original hostname.
export async function publicImageFetch(input, init = {}, dependencies = {}) {
  const url = validateImageURL(input);
  const resolveHost = dependencies.lookup ?? lookup;
  const send = dependencies.request ?? request;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        headers: init.headers,
        signal: init.signal,
        agent: false,
        lookup(hostname, options, callback) {
          resolveHost(hostname, { all: true, verbatim: true })
            .then(addresses => {
              if (!addresses.length)
                throw Object.assign(
                  new Error("No public IP address for the image."),
                  { code: "ERR_IMAGE_ADDRESS" }
                );
              for (const { address } of addresses)
                requirePublicAddress(address);
              if (options.all) callback(null, addresses);
              else callback(null, addresses[0].address, addresses[0].family);
            })
            .catch(callback);
        }
      },
      incoming => {
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value !== undefined)
              headers.set(
                name,
                Array.isArray(value) ? value.join(", ") : value
              );
          }
          const status = incoming.statusCode;
          if ([204, 205, 304].includes(status)) {
            incoming.resume();
            resolve(new Response(null, { status, headers }));
            return;
          }
          const decompress = {
            gzip: createGunzip,
            deflate: createInflate,
            br: createBrotliDecompress
          }[headers.get("content-encoding")?.toLowerCase()];
          let body = incoming;
          if (decompress) {
            body = new PassThrough();
            pipeline(incoming, decompress(), body, error => {
              if (error) body.destroy(error);
            });
            headers.delete("content-encoding");
            headers.delete("content-length");
          }
          resolve(new Response(Readable.toWeb(body), { status, headers }));
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      }
    );
    req.on("error", error =>
      reject(
        error.code === "ERR_IMAGE_ADDRESS" || error.name === "AbortError"
          ? error
          : new TypeError(error.message, { cause: error })
      )
    );
    req.end();
  });
}
