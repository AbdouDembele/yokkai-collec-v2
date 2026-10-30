export type TypeaheadBuffer = { text: string; updatedAt: number };

export function normalizeChoiceLabel(label: string) {
  return label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "");
}

export function advanceTypeahead(
  previous: TypeaheadBuffer,
  key: string,
  now: number
) {
  const letter = key
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
  const continuing = now - previous.updatedAt < 800;
  // Repeating one letter cycles through its matches instead of searching "aaa".
  const text =
    continuing && previous.text !== letter
      ? previous.text + (key === " " ? " " : letter)
      : letter;
  return { text: normalizeChoiceLabel(text), updatedAt: now };
}

export function typeaheadMatchIndex(
  labels: string[],
  prefix: string,
  current: number
) {
  const normalized = normalizeChoiceLabel(prefix);
  if (!normalized) return -1;
  const start = normalized.length === 1 ? current + 1 : Math.max(0, current);
  for (let step = 0; step < labels.length; step++) {
    const index = (start + step) % labels.length;
    if (normalizeChoiceLabel(labels[index]).startsWith(normalized))
      return index;
  }
  return -1;
}
