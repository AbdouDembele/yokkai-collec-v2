export function cardSearchTerms(query: string): string[] {
  return query
    .replace(/[,%()]/g, " ")
    .trim()
    .toLocaleLowerCase("en-US")
    .split(/\s+/)
    .filter(Boolean);
}

export function matchesCardSearch(
  query: string,
  values: (string | null | undefined)[]
): boolean {
  const terms = cardSearchTerms(query);
  if (!terms.length) return true;
  const searchable = values.map(
    value => value?.toLocaleLowerCase("en-US") ?? ""
  );
  return terms.every(term => searchable.some(value => value.includes(term)));
}

export function toggleFilterValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter(item => item !== value)
    : [...values, value];
}
