// PostgreSQL versions deparse (a AND b) AND c with different parentheses.
// Flatten only associative AND trees. Keep every operand, order, literal,
// operator, threshold and function unchanged. Unsupported syntax fails closed.
function scan(source) {
  const tokens = [];
  let depth = 0,
    quote = "",
    escape = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escape && c === "\\") {
        i++;
        continue;
      }
      if (c === quote) {
        if (source[i + 1] === quote) i++;
        else quote = "";
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      escape = c === "'" && /(?:^|[^\w])E$/i.test(source.slice(0, i));
      continue;
    }
    if (
      c === ";" ||
      c === "$" ||
      source.slice(i, i + 2) === "--" ||
      source.slice(i, i + 2) === "/*"
    )
      return null;
    if (c === "(") depth++;
    if (c === ")") {
      if (--depth < 0) return null;
    }
    if (/[A-Za-z_]/.test(c)) {
      const word = source.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/)[0];
      tokens.push({
        word: word.toUpperCase(),
        start: i,
        end: i + word.length,
        depth
      });
      i += word.length - 1;
    }
  }
  return depth === 0 && !quote ? tokens : null;
}

function unwrap(source) {
  let value = source.trim();
  while (
    value.startsWith("(") &&
    value.endsWith(")") &&
    scan(value.slice(1, -1))
  )
    value = value.slice(1, -1).trim();
  return value;
}

export function canonicalCheckConjunction(definition) {
  if (
    typeof definition !== "string" ||
    !definition.startsWith("CHECK (") ||
    !definition.endsWith(")")
  )
    return definition;
  const expression = definition.slice(6).trim(),
    tokens = scan(expression);
  if (
    !tokens ||
    tokens.some(t =>
      ["OR", "NOT", "BETWEEN", "CASE", "WHEN", "SELECT", "ARRAY"].includes(
        t.word
      )
    )
  )
    return definition;
  const flatten = input => {
    const value = unwrap(input),
      parts = scan(value);
    if (!parts) return null;
    const ands = parts.filter(t => t.word === "AND" && t.depth === 0);
    if (!ands.length) return value ? [value] : null;
    let start = 0;
    const operands = [];
    for (const token of [...ands, { start: value.length, end: value.length }]) {
      const child = flatten(value.slice(start, token.start));
      if (!child) return null;
      operands.push(...child);
      start = token.end;
    }
    return operands;
  };
  const operands = flatten(expression);
  return operands && operands.length > 1
    ? ["CHECK_CONJUNCTION", ...operands]
    : definition;
}
