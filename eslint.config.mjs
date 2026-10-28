import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx,mjs}",
      "hooks/**/*.{ts,tsx}"
    ],
    rules: { "max-len": ["error", { code: 300, tabWidth: 2 }] }
  },
  {
    files: ["components/boosters.tsx"],
    rules: {
      // bloc d'animation protégé par empreinte, voir tests/card-sharing-client.test.mjs.
      // Exact matches exempt only the two frozen lines; edits remain guarded by the fingerprint.
      "max-len": [
        "error",
        {
          code: 300,
          tabWidth: 2,
          ignorePattern:
            '^(?:      <div className="yk-deck">\\{cards\\.slice\\(revealed \\+ 1\\)\\.map\\(\\(card, i, remaining\\) => <div className="yk-stacked-back" key=\\{card\\.instanceId\\} style=\\{\\{ transform: `translate\\(\\$\\{\\(remaining\\.length-i\\)\\*3\\}px,\\$\\{-\\(remaining\\.length-i\\)\\*4\\}px\\) rotate\\(\\$\\{\\(remaining\\.length-i\\)\\*1\\.3\\}deg\\)`, filter: `brightness\\(\\$\\{1-\\(remaining\\.length-i\\)\\*\\.045\\}\\)` \\}\\}><CardBack /></div>\\)\\}|        <button type="button" ref=\\{next\\} onClick=\\{flip\\} aria-disabled=\\{revealLocked\\} aria-label=\\{revealLocked \\? tp\\("revealingCard", \\{ name: current\\.name \\}\\) : faceUp \\? tp\\("placeCard", \\{ name: current\\.name \\}\\) : tp\\("revealCard", \\{ index: revealed \\+ 1, total: cards\\.length \\}\\)\\} className=\\{`yk-deck-button \\$\\{faceUp \\? "yk-face-up" : ""\\}`\\}><span className="yk-flip"><span className="yk-flip-back" aria-hidden="true"><CardBack /></span><span className="yk-flip-front" aria-hidden="true">\\{faceUp && <YokaiCard \\{\\.\\.\\.current\\} />\\}</span></span></button>)$'
        }
      ]
    }
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Supplied prototype runtime is reference material, not application code.
    "Yokkai Collec' UI design/**",
    "design_handoff_yokkai_collec/**",
    // Local Claude worktrees are separate generated checkouts.
    ".claude/worktrees/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts"
  ])
]);

export default eslintConfig;
