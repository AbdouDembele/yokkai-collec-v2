import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkStripeSandbox } from "./check-stripe-sandbox.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
export const SANDBOX_ORIGIN = "http://localhost:3002";
export const SANDBOX_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.finalization_failed",
  "charge.dispute.created",
  "charge.dispute.closed",
  "charge.refunded",
  "radar.early_fraud_warning.created"
];

export function localSupabaseValues(text) {
  const values = Object.fromEntries(
    text.split(/\r?\n/).flatMap(line => {
      const match = line.match(/^([A-Z_]+)="([^"]*)"$/);
      return match ? [[match[1], match[2]]] : [];
    })
  );
  let url;
  try {
    url = new URL(values.API_URL);
  } catch {
    throw new Error("STRIPE_SANDBOX_LOCAL_DATABASE_REQUIRED");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !values.PUBLISHABLE_KEY ||
    !values.SECRET_KEY
  )
    throw new Error("STRIPE_SANDBOX_LOCAL_DATABASE_REQUIRED");
  return {
    NEXT_PUBLIC_SUPABASE_URL: url.origin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: values.SECRET_KEY
  };
}

function readLocalSupabase() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("STRIPE_"))
  );
  try {
    return execFileSync(
      process.execPath,
      [
        resolve(root, "node_modules/supabase/dist/supabase.js"),
        "status",
        "-o",
        "env"
      ],
      {
        cwd: root,
        env,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20000
      }
    );
  } catch {
    throw new Error("STRIPE_SANDBOX_LOCAL_DATABASE_REQUIRED");
  }
}

export function webhookSecretFromListener(child, log, timeout = 20000) {
  return new Promise((resolveSecret, reject) => {
    let buffer = "",
      secret;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("STRIPE_SANDBOX_LISTENER_UNAVAILABLE"));
    }, timeout);
    const inspect = chunk => {
      buffer = (buffer + chunk.toString()).slice(-32768);
      const found = buffer.match(
        /whsec_[A-Za-z0-9]{16,}(?=[\s"'()\[\]\u001b])/
      )?.[0];
      if (found && !secret) {
        secret = found;
        clearTimeout(timer);
        resolveSecret(secret);
      }
      // Only fixed status messages leave this process: never relay raw CLI output.
      if (/\[200\].*POST.*\/api\/billing\/webhook/.test(chunk.toString()))
        log("STRIPE_SANDBOX_WEBHOOK_DELIVERED");
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("STRIPE_SANDBOX_LISTENER_UNAVAILABLE"));
    });
    child.once("exit", () => {
      clearTimeout(timer);
      if (!secret) reject(new Error("STRIPE_SANDBOX_LISTENER_UNAVAILABLE"));
    });
  });
}

export async function startStripeSandbox(
  env,
  {
    spawnProcess = spawn,
    readSupabase = readLocalSupabase,
    createStripe,
    log = console.log
  } = {}
) {
  // Verifies key mode, own account and test price before any CLI or server starts.
  await checkStripeSandbox(env, createStripe);
  const local = localSupabaseValues(readSupabase());
  const cli = spawnProcess(
    resolve(root, ".tools/stripe-cli/1.54.0/stripe.exe"),
    [
      "listen",
      "--skip-update",
      "--events-from",
      "@self",
      "--events",
      SANDBOX_EVENTS.join(","),
      "--forward-to",
      `${SANDBOX_ORIGIN}/api/billing/webhook`,
      "--config",
      resolve(root, ".tools/stripe-cli/session.toml")
    ],
    {
      cwd: root,
      windowsHide: true,
      env: {
        ...env,
        STRIPE_API_KEY: env.STRIPE_SECRET_KEY,
        STRIPE_DEVICE_NAME: "yokkai-local-sandbox"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let app;
  const stop = () => {
    for (const child of [app, cli]) {
      if (!child || child.exitCode !== null) continue;
      if (process.platform === "win32" && Number.isSafeInteger(child.pid)) {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore"
          });
        } catch {
          child.kill();
        }
      } else child.kill();
    }
  };
  try {
    const secret = await webhookSecretFromListener(cli, log);
    log("STRIPE_SANDBOX_WEBHOOK_READY");
    app = spawnProcess(
      process.execPath,
      [
        require.resolve("next/dist/bin/next"),
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3002"
      ],
      {
        cwd: root,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...env,
          ...local,
          NODE_ENV: "development",
          NEXT_PUBLIC_SITE_URL: SANDBOX_ORIGIN,
          STRIPE_BILLING_MODE: "test",
          STRIPE_BILLING_ENABLED: "true",
          STRIPE_CHECKOUT_ENABLED: "true",
          STRIPE_SANDBOX_PREVIEW: "true",
          STRIPE_PRO_WEBHOOK_SECRET: secret,
          MAINTENANCE_MODE: "false"
        }
      }
    );
    app.stdout.on("data", chunk => {
      if (/Ready in/.test(chunk.toString()))
        log(
          `STRIPE_SANDBOX_READY ${SANDBOX_ORIGIN}/design-system/billing-preview`
        );
    });
    app.stderr.on("data", () => {
      /* Never relay arbitrary diagnostics containing credentials. */
    });
    app.once("error", () => {
      log("STRIPE_SANDBOX_APP_UNAVAILABLE");
      stop();
    });
    app.once("exit", () => {
      log("STRIPE_SANDBOX_APP_STOPPED");
      stop();
    });
    cli.once("exit", () => {
      log("STRIPE_SANDBOX_LISTENER_STOPPED");
      stop();
    });
    return { stop, app, cli };
  } catch (error) {
    stop();
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const runtime = await startStripeSandbox(process.env);
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => {
        runtime.stop();
        process.exit(0);
      });
  } catch (error) {
    console.error(
      error instanceof Error && /^STRIPE_SANDBOX_[A-Z_]+$/.test(error.message)
        ? error.message
        : "STRIPE_SANDBOX_START_FAILED"
    );
    process.exitCode = 1;
  }
}
