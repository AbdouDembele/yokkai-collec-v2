import test from "node:test";
import assert from "node:assert/strict";
import { canonicalCheckConjunction as canonical } from "../scripts/check-constraint-canonical.mjs";

test("PG17 and PGlite CHECK conjunction parentheses compare without changing operands", () => {
  const pg17 =
    "CHECK (((char_length(message) >= 1) AND (char_length(message) <= 500) AND (message = btrim(message))))";
  const pglite =
    "CHECK ((((char_length(message) >= 1) AND (char_length(message) <= 500)) AND (message = btrim(message))))";
  assert.deepEqual(canonical(pg17), canonical(pglite));
  for (const changed of [
    pg17.replace("500", "501"),
    pg17.replace(">= 1", ">= 0"),
    pg17.replace("btrim", "lower"),
    pg17.replace("AND", "OR")
  ])
    assert.notDeepEqual(canonical(changed), canonical(pglite));
  assert.notDeepEqual(
    canonical("CHECK ((a AND b))"),
    canonical("CHECK ((b AND a))"),
    "Operand order is retained"
  );
});

test("quoted data remain exact and unsupported boolean syntax is never rewritten", () => {
  assert.deepEqual(
    canonical("CHECK (((a = 'AND (keep)') AND b) AND c)"),
    canonical("CHECK ((a = 'AND (keep)') AND b AND c)")
  );
  assert.notDeepEqual(
    canonical("CHECK ((a = 'AND (keep)') AND b AND c)"),
    canonical("CHECK ((a = 'AND keep') AND b AND c)")
  );
  for (const value of [
    "CHECK ((a AND (b OR c)))",
    "CHECK ((a BETWEEN 1 AND 2))",
    "CHECK ((NOT (a AND b)))",
    "CHECK ((a AND b)) NOT VALID",
    "CHECK ((a AND b)); SELECT 1",
    "CHECK ((a AND b)"
  ])
    assert.equal(canonical(value), value);
  assert.notDeepEqual(
    canonical("CHECK ((a AND (b OR c)))"),
    canonical("CHECK (((a AND b) OR c))")
  );
});
