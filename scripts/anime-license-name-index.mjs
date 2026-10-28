// Candidate discovery only. This module never assigns a card or approves a merge.
export function normalizedLicenseName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export const compactLicenseName = value =>
  normalizedLicenseName(value).replaceAll(" ", "");
export function seasonNameStem(value) {
  return normalizedLicenseName(value)
    .replace(
      /\s+(?:(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|final)\s+season|season\s+\d+|part\s+\d+|cour\s+\d+|s\d+)(?:\s+.*)?$/u,
      ""
    )
    .replace(/\s+(?:ii|iii|iv|v|vi|vii|viii|ix|x|[2-9]\d*)$/u, "")
    .replace(/\s+(?:the\s+)?(?:movie|ova|specials?)(?:\s+.*)?$/u, "")
    .trim();
}
const genericWords = new Set([
  "the",
  "a",
  "an",
  "my",
  "i",
  "you",
  "your",
  "we",
  "our",
  "it",
  "its",
  "this",
  "that",
  "in",
  "on",
  "of",
  "to",
  "and"
]);
const add = (index, key, value) => {
  if (!key) return;
  const set = index.get(key) ?? new Set();
  set.add(value);
  index.set(key, set);
};
const grams = text => {
  const result = new Map();
  for (let i = 0; i + 3 <= text.length; i++) {
    const gram = text.slice(i, i + 3);
    result.set(gram, (result.get(gram) ?? 0) + 1);
  }
  return result;
};
export function boundedNameDistance(a, b, limit = 2) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array(b.length + 1).fill(limit + 1);
    current[0] = i;
    let minimum = limit + 1;
    for (
      let j = Math.max(1, i - limit);
      j <= Math.min(b.length, i + limit);
      j++
    ) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + Number(a[i - 1] !== b[j - 1])
      );
      minimum = Math.min(minimum, current[j]);
    }
    if (minimum > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

export function indexLicenseNameCandidates(licenses) {
  const sorted = [...licenses].sort((a, b) =>
    a.name.localeCompare(b.name, "en")
  );
  if (new Set(sorted.map(r => r.name)).size !== sorted.length)
    throw new Error("Exact source license names must be unique");
  const groups = [],
    compact = new Map(),
    stems = new Map(),
    mediaAliases = new Map();
  const aliasNames = new Map();
  const root = {
    children: new Map(),
    members: new Set(),
    terminals: new Set()
  };
  const metrics = {
    licenses: sorted.length,
    indexed_forms: 0,
    trie_nodes: 1,
    trigram_posting_visits: 0,
    bounded_distance_checks: 0,
    all_possible_license_pairs: (sorted.length * (sorted.length - 1)) / 2
  };
  const makeGroup = (kind, key, members, extra = {}) => {
    const ids = [...members].sort((a, b) => a - b);
    if (ids.length < 2 && !extra.multiple_media) return;
    groups.push({ kind, key, license_indexes: ids, ...extra });
  };
  for (const [id, row] of sorted.entries()) {
    add(compact, compactLicenseName(row.name), id);
    add(stems, seasonNameStem(row.name), id);
    for (const mediaId of row.known_media_ids ?? [])
      add(mediaAliases, String(mediaId), id);
    for (const form of [row.name, ...(row.aliases ?? [])])
      add(aliasNames, normalizedLicenseName(form), id);
    const forms = new Set(
      [row.name, ...(row.prefix_aliases ?? [])]
        .map(normalizedLicenseName)
        .filter(Boolean)
    );
    for (const form of forms) {
      metrics.indexed_forms++;
      let node = root;
      for (const token of form.split(" ")) {
        if (!node.children.has(token)) {
          node.children.set(token, {
            children: new Map(),
            members: new Set(),
            terminals: new Set()
          });
          metrics.trie_nodes++;
        }
        node = node.children.get(token);
        node.members.add(id);
      }
      node.terminals.add(id);
    }
  }
  const walk = (node, tokens = []) => {
    if (
      tokens.length &&
      node.members.size > 1 &&
      (node.terminals.size || node.children.size > 1)
    ) {
      const generic = tokens.length === 1 && genericWords.has(tokens[0]);
      makeGroup(
        generic ? "GRAMMATICAL_PREFIX_EXCLUDED" : "TITLE_PREFIX",
        tokens.join(" "),
        node.members,
        { generic_prefix: generic }
      );
    }
    for (const [token, child] of node.children) walk(child, [...tokens, token]);
  };
  walk(root);
  // Token Aho-Corasick finds a complete existing source title inside a longer
  // title/subtitle. Failure links avoid comparing every pattern to every name.
  const automaton = [{ children: new Map(), failure: 0, outputs: [] }],
    contained = new Map();
  for (const [id, row] of sorted.entries()) {
    const pattern = normalizedLicenseName(row.name);
    if (!pattern) continue;
    let state = 0;
    for (const token of pattern.split(" ")) {
      if (!automaton[state].children.has(token)) {
        automaton[state].children.set(token, automaton.length);
        automaton.push({ children: new Map(), failure: 0, outputs: [] });
      }
      state = automaton[state].children.get(token);
    }
    automaton[state].outputs.push({
      pattern,
      length: pattern.split(" ").length
    });
    add(contained, pattern, id);
  }
  const queue = [...automaton[0].children.values()];
  for (let offset = 0; offset < queue.length; offset++) {
    const state = queue[offset];
    for (const [token, next] of automaton[state].children) {
      let fallback = automaton[state].failure;
      while (fallback && !automaton[fallback].children.has(token))
        fallback = automaton[fallback].failure;
      automaton[next].failure = automaton[fallback].children.get(token) ?? 0;
      automaton[next].outputs.push(
        ...automaton[automaton[next].failure].outputs
      );
      queue.push(next);
    }
  }
  for (const [id, row] of sorted.entries())
    for (const form of new Set(
      [row.name, ...(row.prefix_aliases ?? [])]
        .map(normalizedLicenseName)
        .filter(Boolean)
    )) {
      let state = 0;
      const tokens = form.split(" ");
      for (const [position, token] of tokens.entries()) {
        while (state && !automaton[state].children.has(token))
          state = automaton[state].failure;
        state = automaton[state].children.get(token) ?? 0;
        for (const match of automaton[state].outputs)
          if (position + 1 > match.length || position + 1 < tokens.length)
            add(contained, match.pattern, id);
      }
    }
  metrics.containment_automaton_states = automaton.length;
  for (const [pattern, members] of contained)
    if (members.size > 1) makeGroup("CONTAINED_SOURCE_TITLE", pattern, members);
  for (const [key, members] of compact)
    makeGroup("ORTHOGRAPHY_SPACING_PUNCTUATION", key, members);
  for (const [key, members] of stems)
    makeGroup("SEASON_PART_STEM", key, members);
  for (const [key, members] of mediaAliases)
    makeGroup("SAME_IMPORTED_MEDIA_ALIAS", key, members);
  for (const [key, members] of aliasNames)
    if (members.size > 1) makeGroup("EXACT_VERIFIED_TITLE_ALIAS", key, members);
  // A single stored label may already cover multiple imported works. Include it
  // in the audit rather than inventing separate physical licenses from API titles.
  for (const [id, row] of sorted.entries())
    if (new Set(row.known_media_ids ?? []).size > 1)
      makeGroup("MULTI_MEDIA_SOURCE", row.name, new Set([id]), {
        multiple_media: true
      });
  // Trigram multiset overlap is a necessary condition for edit distance <= k.
  // Candidate verification uses banded distance, never the full all-pairs matrix.
  const keys = [...compact.keys()],
    postings = new Map(),
    gramCounts = keys.map(grams);
  const spellingPairs = new Set();
  const emitSpelling = (i, j, distance) => {
    const pair = [i, j].sort((a, b) => a - b).join(":");
    if (i === j || spellingPairs.has(pair)) return;
    spellingPairs.add(pair);
    makeGroup(
      "SPELLING_DISTANCE",
      keys[i] + " / " + keys[j],
      new Set([...compact.get(keys[i]), ...compact.get(keys[j])]),
      { edit_distance: distance }
    );
  };
  // Short names need no shared trigram (Air/Ai). A character trie with edit
  // states covers them without a quadratic short-name exception.
  const spellingTrie = { children: new Map(), terminal: -1 };
  for (const [id, text] of keys.entries()) {
    let node = spellingTrie;
    for (const character of text.split("")) {
      if (!node.children.has(character))
        node.children.set(character, { children: new Map(), terminal: -1 });
      node = node.children.get(character);
    }
    node.terminal = id;
  }
  metrics.short_name_trie_visits = 0;
  for (const [id, text] of keys.entries())
    if (text.length < 5) {
      const visit = (node, previous) => {
        if (node.terminal >= 0 && previous[text.length] <= 1)
          emitSpelling(id, node.terminal, previous[text.length]);
        for (const [character, child] of node.children) {
          metrics.short_name_trie_visits++;
          const next = [previous[0] + 1];
          for (let position = 1; position <= text.length; position++)
            next[position] = Math.min(
              next[position - 1] + 1,
              previous[position] + 1,
              previous[position - 1] + Number(text[position - 1] !== character)
            );
          if (Math.min(...next) <= 1) visit(child, next);
        }
      };
      visit(
        spellingTrie,
        Array.from({ length: text.length + 1 }, (_, i) => i)
      );
    }
  for (const [id, keyGrams] of gramCounts.entries())
    for (const [gram, count] of keyGrams) {
      const list = postings.get(gram) ?? [];
      list.push([id, count]);
      postings.set(gram, list);
    }
  for (const [i, a] of keys.entries()) {
    if (a.length < 5) continue;
    const possible = new Map();
    for (const [gram, count] of gramCounts[i])
      for (const [j, otherCount] of postings.get(gram)) {
        metrics.trigram_posting_visits++;
        if (j <= i || Math.abs(a.length - keys[j].length) > 2) continue;
        possible.set(j, (possible.get(j) ?? 0) + Math.min(count, otherCount));
      }
    for (const [j, overlap] of possible) {
      const b = keys[j],
        limit = Math.min(a.length, b.length) < 8 ? 1 : 2;
      if (overlap < Math.max(a.length, b.length) - 2 - 3 * limit) continue;
      metrics.bounded_distance_checks++;
      const distance = boundedNameDistance(a, b, limit);
      if (distance <= limit) emitSpelling(i, j, distance);
    }
  }
  return {
    licenses: sorted,
    groups: groups.map((g, i) => ({
      group_id: `N${String(i + 1).padStart(5, "0")}`,
      ...g
    })),
    metrics
  };
}
