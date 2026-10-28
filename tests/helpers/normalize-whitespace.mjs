// Source contracts compare content rather than layout on both sides.
export function normalizeWhitespace(value) {
  if (value instanceof RegExp) {
    return new RegExp(value.source.replace(/\s/g, ""), value.flags);
  }
  return value.replace(/\{\s*["']\s+["']\s*\}/g, " ").replace(/\s/g, "");
}
