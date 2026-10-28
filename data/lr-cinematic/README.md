# Local LR cinematic prototype

`reveal.html` is the unmodified animation supplied in `LR ANIMATION.html`.
Its embedded artwork and original bridge are retained for regression coverage.

The final SSR/LR versions now live in `data/card-cinematics/`. The original
prototype here remains unchanged for regression coverage. The normal local
pack flow and demo pages use the final files; see that directory's README.

Open **http://localhost:3000/design-system/lr-cinematic** with `npm run dev`.
No pack or database access is needed. Use **Replay cinematic** to restart the
whole sequence, or **Pause animations** to pause it. The prototype also keeps
its own `prefers-reduced-motion` fallback.

For complete pack openings, open **http://localhost:3000/design-system/lr-packs**.
Regular and Decision demo packs can be reopened indefinitely. Every pack has
five cards, ending with exactly one LR; Madara, Omni-Man and Shadow rotate
between openings. All illustrations are existing local assets. The demo uses
the real opening/reveal components, but no pack RPC, real reward, sharing,
destruction or referral action. The displayed rarities are demo fixtures, not
the live catalog or drop rates. Decision Pack choices are simulated as well.

In development, SSR/LR cards in the normal pack flow use the final files.
Continue returns to the existing reveal flow. The final pack summary allows
replaying each SSR/LR without opening another pack or adding cards.

The document endpoint and demo return 404 outside development. The HTML is
served as plain text and rendered only inside a `srcDoc` iframe sandbox with
scripts enabled but no same-origin access, top-level navigation, forms or
popups. A restrictive document CSP disables connections and external non-image
resources.
No global security headers, pack odds, rewards, quotas, SQL or production
cinematics are changed. This branch is for local evaluation, not deployment.
