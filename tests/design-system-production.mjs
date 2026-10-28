// Run after next build. Disposable local server, dummy public configuration, no player session.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const routes = readdirSync(new URL("../app/design-system/", import.meta.url), {
  recursive: true
})
  .filter(name => name === "page.tsx" || name.endsWith("page.tsx"))
  .map(
    name =>
      "/design-system/" +
      name.replaceAll("\\", "/").replace(/\/?page\.tsx$/, "")
  );
const port = 4300 + (process.pid % 1000);
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port)
  ],
  {
    cwd: new URL("../", import.meta.url),
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ci_dummy",
      MAINTENANCE_MODE: "false"
    }
  }
);
try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/design-system`);
      ready = true;
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(ready, "production server must start");
  for (const route of routes) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    await response.text();
    assert.equal(
      response.status,
      404,
      `${route} must be inaccessible in production`
    );
  }
  const login = await fetch(`http://127.0.0.1:${port}/login`);
  await login.text();
  assert.equal(
    login.status,
    200,
    "ordinary application routes remain available"
  );
  console.log(
    `${routes.length} design-system routes: HTTP 404 in real production build`
  );
} finally {
  server.kill();
}
