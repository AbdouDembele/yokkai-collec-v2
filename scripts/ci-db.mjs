import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const docker = args =>
  execFileSync("docker", args, { encoding: "utf8", windowsHide: true }).trim();
const endpoint =
  process.env.DOCKER_HOST ||
  docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
if (!/^(?:npipe:\/\/\/\/\.\/pipe\/|unix:\/\/\/)/.test(endpoint))
  throw new Error(
    "Docker distant refusé : seul un moteur local jetable est autorisé"
  );
let container;
let test;
function cleanup() {
  if (container) {
    docker(["rm", "--force", container]);
    container = undefined;
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    test?.kill(signal);
    try {
      cleanup();
    } finally {
      process.exit(signal === "SIGINT" ? 130 : 143);
    }
  });
}

try {
  container = docker([
    "run",
    "--detach",
    "--env",
    "POSTGRES_USER=supabase_admin",
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "--tmpfs",
    "/docker-entrypoint-initdb.d",
    "--health-cmd",
    "pg_isready -U supabase_admin -d postgres",
    "--health-interval",
    "5s",
    "--health-timeout",
    "5s",
    "--health-retries",
    "20",
    "supabase/postgres:17.6.1.136"
  ]);
  const deadline = Date.now() + 150_000;
  while (true) {
    const health = docker([
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      container
    ]);
    if (health === "healthy") break;
    if (health === "unhealthy" || Date.now() >= deadline) {
      throw new Error("PostgreSQL container did not become healthy");
    }
    await delay(1000);
  }
  process.exitCode = await new Promise((resolve, reject) => {
    test = spawn(
      process.execPath,
      ["tests/postgres17-auction-concurrency.mjs"],
      {
        stdio: "inherit",
        windowsHide: true,
        env: { ...process.env, TEST_POSTGRES_CONTAINER: container }
      }
    );
    test.on("error", reject);
    test.on("exit", code => resolve(code ?? 1));
  });
} finally {
  cleanup();
}
