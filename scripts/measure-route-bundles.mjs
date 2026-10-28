import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

// Next 16.3.8 analyzer data: a big-endian JSON-header length, then the header.
// Deduplicate shared fragments across routes; keep distinct emitted copies.
if (process.argv[2] === "--analyzer") {
  const directory = path.resolve(process.argv[3]);
  const fragments = new Map();
  const routes = {};
  for (const file of readdirSync(directory, { recursive: true }).filter(
    file => file.endsWith("analyze.data") && !file.startsWith("design-system")
  )) {
    const bytes = readFileSync(path.join(directory, file));
    const data = JSON.parse(bytes.subarray(4, 4 + bytes.readUInt32BE(0)));
    function sourcePath(index) {
      const source = data.sources[index];
      return source
        ? sourcePath(source.parent_source_index) + "/" + source.path
        : "";
    }
    let raw = 0;
    for (const part of data.chunk_parts) {
      const output = data.output_files[part.output_file_index].filename;
      if (!output.includes("/static/") || !output.endsWith(".js")) continue;
      const source = sourcePath(part.source_index).replaceAll("//", "/");
      const key = JSON.stringify([
        source,
        output,
        part.size,
        part.compressed_size
      ]);
      fragments.set(key, { source, raw: part.size });
      raw += part.size;
    }
    const route =
      "/" + file.replaceAll("\\", "/").replace(/\/?analyze.data$/, "");
    routes[route] = raw;
  }
  const modules = {};
  for (const { source, raw } of fragments.values())
    modules[source] = (modules[source] ?? 0) + raw;
  console.log(
    JSON.stringify(
      {
        metric:
          "Analyzer reachable JS fragment bytes, including async imports; modules count distinct emitted copies across routes",
        modules,
        routes
      },
      null,
      2
    )
  );
  process.exit(0);
}

// Run after `next build`; counts each shared client chunk once per route.
const build = path.resolve(process.argv[2] ?? ".next");
const manifest = JSON.parse(
  readFileSync(path.join(build, "build-manifest.json"), "utf8")
);
function size(files) {
  return [...new Set(files)].reduce(
    (sum, file) => {
      const bytes = readFileSync(path.join(build, decodeURIComponent(file)));
      sum.raw += bytes.length;
      sum.gzip += gzipSync(bytes).length;
      return sum;
    },
    { raw: 0, gzip: 0 }
  );
}
const app = path.join(build, "server/app");
const routes = {};
for (const file of readdirSync(app, { recursive: true }).filter(
  file =>
    file.endsWith("page_client-reference-manifest.js") &&
    !file.startsWith("design-system")
)) {
  const context = { globalThis: {} };
  vm.runInNewContext(readFileSync(path.join(app, file), "utf8"), context);
  const routeManifest = Object.values(context.globalThis.__RSC_MANIFEST)[0];
  const chunks = Object.values(routeManifest.clientModules)
    .flatMap(module => module.chunks)
    .filter(chunk => typeof chunk === "string" && chunk.endsWith(".js"));
  const route =
    "/" +
    file
      .replaceAll("\\", "/")
      .replace(/\/?page_client-reference-manifest.js$/, "")
      .replace(/\([^/]+\)\//g, "");
  routes[route] = size([...manifest.rootMainFiles, ...chunks]);
}
const chunks = readdirSync(path.join(build, "static/chunks"), {
  recursive: true
})
  .filter(file => file.endsWith(".js"))
  .map(file => path.join("static/chunks", file));
console.log(
  JSON.stringify(
    {
      metric:
        "Static initial client chunks (modern browser, raw and individual gzip bytes); excludes dynamic chunks, prefetch, RSC, CSS, fonts and the legacy nomodule polyfill. Total includes all emitted JS chunks, including deferred and legacy chunks.",
      total: { files: chunks.length, ...size(chunks) },
      routes
    },
    null,
    2
  )
);
