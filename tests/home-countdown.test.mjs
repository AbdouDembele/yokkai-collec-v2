import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("shared pack countdown rounds up and clamps expired or full reserves", () => {
  const loaded = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("lib/ui/pack-countdown.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    { exports: loaded.exports }
  );
  const { packCountdown, auctionCountdown } = loaded.exports;
  assert.equal(packCountdown(61001, 0), "01:02");
  assert.equal(packCountdown(61000, 0), "01:01");
  assert.equal(packCountdown(1000, 2000), "00:00");
  assert.equal(packCountdown(null, 2000), "00:00");
  assert.equal(packCountdown(3601001, 0, true), "01:00:02");
  assert.equal(auctionCountdown(9600000, 0), "2h 40m");
  assert.equal(auctionCountdown(3600000, 0), "1h 0m");
  assert.equal(auctionCountdown(3599000, 0), "59:59");
  assert.equal(auctionCountdown(0, 1000), "00:00");
});

test("Decision panel keeps the daily quota and pending choice", () => {
  const loaded = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("lib/data/home.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    { exports: loaded.exports }
  );
  const { decisionPackSummary } = loaded.exports;
  const status = {
    available: false,
    remaining: 1,
    maximum: 2,
    nextPackAt: 10000,
    pending: [{}]
  };
  const summary = decisionPackSummary(status);
  assert.equal(summary.available, 1);
  assert.equal(summary.maximum, 2);
  assert.equal(summary.canResume, true);
  assert.equal(summary.nextPackAt, 10000);
  assert.equal(
    decisionPackSummary({ ...status, pending: [] }).canResume,
    false
  );
});
