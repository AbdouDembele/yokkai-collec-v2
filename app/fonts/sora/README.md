# Sora

Sous-ensembles Google Fonts que `next/font/google` téléchargeait au build (#391),
copiés sans modification pour ne plus dépendre du réseau.

- `Sora-latin.woff2` (25 240 octets), SHA-256
  `3902474d3ece89c8580d5ef3325cf58753e6e45a86f9957b4dacc4fce2e7fde1`.
- `Sora-latin-ext.woff2` (12 116 octets), SHA-256
  `8d9b4a4136bf8cf8b00c65978e7801c372d14ed901fa387cc7352a40b96cd006`.
- Police variable, poids 400 à 700 (les quatre poids 400, 500, 600 et 700 déjà
  chargés), style normal.
- Licence : SIL Open Font License 1.1, voir `OFL.txt` (copie de
  `google/fonts`, `ofl/sora/OFL.txt`).

Chargement via `next/font/local` dans `app/layout.tsx`, avec la même famille
`Sora`, les mêmes `unicode-range` et la même police de repli
(`Sora Fallback`, déclarée dans `app/globals.css`) qu'auparavant.
