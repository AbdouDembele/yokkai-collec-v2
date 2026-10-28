import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Variables publiques Supabase manquantes.");
const require = createRequire(import.meta.url);
const sharingContext = {
  exports: {},
  URL,
  require(name) {
    if (name === "server-only") return {};
    if (name === "@/utils/supabase/config")
      return { getSupabaseConfig: () => ({ url: url, key: "test" }) };
    if (name === "@supabase/supabase-js") return {};
    throw new Error(`Unexpected sharing import: ${name}`);
  }
};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../lib/server/card-sharing.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  ).outputText,
  sharingContext
);
const source = ts.transpileModule(
  readFileSync(
    new URL("../lib/server/card-share-image.tsx", import.meta.url),
    "utf8"
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  }
).outputText;
const context = {
  exports: {},
  process,
  Buffer,
  URL,
  Response,
  fetch,
  AbortSignal,
  TextDecoder,
  Uint8Array,
  Promise,
  require(name) {
    if (name === "server-only") return {};
    if (name === "@/lib/server/card-sharing") return sharingContext.exports;
    if (name.startsWith("@/")) return {};
    return require(name);
  }
};
vm.runInNewContext(source, context);
const { renderSharedCardImage } = context.exports;
const db = createClient(url, key, { auth: { persistSession: false } });
const rows = [];
let cacheBytes = 0;
for (const rarity of ["C", "R", "SR", "SSR", "LR"]) {
  const { data, error } = await db
    .from("cards")
    .select("nom,franchise,rarete_base,image_url")
    .eq("rarete_base", rarity)
    .limit(1)
    .single();
  if (error) throw error;
  for (const format of ["og", "story", "square"]) {
    global.gc?.();
    const before = process.memoryUsage();
    const started = performance.now();
    const image = await renderSharedCardImage(
      {
        cardName: data.nom,
        franchise: data.franchise,
        rarity: data.rarete_base,
        shiny: false,
        catalogueImageUrl: data.image_url
      },
      format
    );
    const after = process.memoryUsage();
    cacheBytes += image.byteLength;
    rows.push({
      rarity,
      format,
      milliseconds: Math.round(performance.now() - started),
      bytes: image.byteLength,
      heapDelta: after.heapUsed - before.heapUsed,
      rssDelta: after.rss - before.rss
    });
  }
}
console.log(
  JSON.stringify(
    {
      rows,
      cacheBytes,
      cacheMiB: Number((cacheBytes / 1024 / 1024).toFixed(2)),
      memory: process.memoryUsage()
    },
    null,
    2
  )
);
