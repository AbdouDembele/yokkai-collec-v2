# SEC-10 — development dependency reachability

Reviewed on 2026-10-18 against `origin/master` at `69daa2d2` (dependency
lockfile and lint configuration unchanged since the initial `400e9a78` review).

## Finding and available fixes

The complete `npm audit --json` reports five high-severity entries, all from
one dependency chain:

```text
eslint-config-next 16.3.8
└─ @next/eslint-plugin-next 16.3.8
   └─ fast-glob 3.3.1
      └─ micromatch 4.0.8
         └─ braces 3.0.3
```

All five packages are marked `dev: true` in `package-lock.json`.
`npm audit --omit=dev --json` reports zero vulnerabilities.

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects `braces <= 3.0.3` and lists no patched version. Deeply nested brace
patterns can exhaust the Node.js stack. The other four audit entries propagate
this advisory; they are not five independent vulnerabilities.

Registry checks return `braces 3.0.3`, `micromatch 4.0.8`, and `fast-glob 3.3.3`
as their latest releases. `@next/eslint-plugin-next@16.4.2` still depends on
`fast-glob 3.3.1`. No checked compatible release removes this chain.
The audit suggestion to downgrade `eslint-config-next` to `14.2.35` is rejected.
No dependency change, override, forced audit fix, or lint-rule suppression is
introduced. SEC-10 remains open pending an upstream compatible fix.

## Reachability in this project

In the installed `@next/eslint-plugin-next` sources, the only import of
`fast-glob` is `dist/utils/get-root-dirs.js`. Its `processRootDir` calls
`globSync` only for a string or string-array `context.settings.next.rootDir`.
Without that setting, `getRootDirs` returns `[context.cwd]` without globbing.
The consumer is `dist/rules/no-html-link-for-pages.js`; it derives `pages`,
`src/pages`, `app`, and `src/app` directories from those roots.

The repository's `eslint.config.mjs` does not set `settings.next.rootDir`.
Its ignore patterns are repository-authored constants. The lint script is
`eslint`, invoked as `npm run lint` in CI; player requests, uploaded content,
and player-supplied strings are not passed as root-directory glob patterns.
File names discovered while linting are not themselves this helper's glob
pattern input. Thus this particular vulnerable chain has no configured path
from player input to brace-pattern parsing in the current lint setup.

This is a scoped source assessment, not a claim that the vulnerable package
is safe for arbitrary input. A future monorepo configuration that sets
`settings.next.rootDir` must use reviewed, fixed patterns. Do not derive those
patterns from request data, external job payloads, or untrusted configuration.
An untrusted PR can also change executable lint configuration; these observations
do not make running arbitrary PR code with secrets safe.

## Before and after

This documentation-only change leaves the lockfile and executable configuration
unchanged: five high development audit entries remain; production has zero.
There is no honest failing-then-passing vulnerability test without a fix.
The requested documentation exception applies; no existing test is changed.

Recheck the complete audit and production audit when a compatible upstream
release becomes available. Verify that the vulnerable chain is actually removed
or patched, keep Next lint rules enabled, and run GitHub Actions before merging
the eventual dependency update. No audit allowlist or weakened gate is added.

## Migrations

None. No database or VPS operation; non appliquée sur le VPS (not applicable).
