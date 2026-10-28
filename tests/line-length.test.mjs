import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ESLint } from "eslint";

const eslint = new ESLint();
test("application lint rejects lines longer than 300 characters", async () => {
  const [result] = await eslint.lintText(
    `const label = "${"x".repeat(301)}";`,
    {
      filePath: "components/length-check.tsx"
    }
  );
  assert.ok(result.messages.some(message => message.ruleId === "max-len"));
});

test("application sources stay within the 300-character limit", async () => {
  const results = await eslint.lintFiles(["app", "components", "lib", "hooks"]);
  const violations = results.flatMap(result =>
    result.messages
      .filter(message => message.ruleId === "max-len")
      .map(message => `${result.filePath}:${message.line}: ${message.message}`)
  );
  assert.deepEqual(violations, []);
});

test("only the two fingerprint-protected animation lines are exempt", async () => {
  const config = await eslint.calculateConfigForFile("components/boosters.tsx");
  const pattern = new RegExp(config.rules["max-len"][1].ignorePattern);
  const lines = readFileSync(
    new URL("../components/boosters.tsx", import.meta.url),
    "utf8"
  )
    .split(/\r?\n/)
    .filter(line => line.length > 300);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.ok(pattern.test(line));
    assert.equal(pattern.test(`${line} `), false);
  }
});
