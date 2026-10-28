# Final SSR and LR local cinematics

Original assets supplied by the user, copied without modification:

- `lr.html`: `yokkai_lr_reveal_final (3).html`
- `ssr.html`: `yokkai_ssr_reveal_final (1).html`

Open **http://localhost:3000/design-system/card-cinematics** to compare them,
or **http://localhost:3000/design-system/lr-packs** to open a full simulated
pack (SSR in slot 4, LR in slot 5). The cinematic has no visible controls:
pack openings continue automatically after the reveal, or on click, Enter or
Space. Escape still closes the native dialog. Replay remains available from
the pack summary. The reusable player's optional manual controls are retained
for compatibility. The older `/design-system/lr-cinematic` URL now uses the
final LR file as well; its legacy document endpoint is retained for regression
coverage, not used by the new flow.

The live Boosters screen opts into the same final SSR/LR player through the
explicit `releasedCinematics` option. Production uses `/api/card-cinematics`,
not a design-system endpoint. The latter and all simulated pack pages remain
unavailable outside development. Drop rates, quotas, rewards, the server's
pack results and backend mutation calls are unchanged. The standalone reveal
component retains its previous defaults for compatibility.

## Integration boundary

The application supplies `name`, `category`, `anime` as `license`, `rarity` as
`rank`, and the card's existing `image`. The rarity color is taken from the
site's current LR/SSR palette. This app has CSS card borders, not a dedicated
transparent border image, so no border image URL is fabricated.

The server validates the rarity and image URL and injects escaped JSON. The
source's broad iframe message bridge/demo startup is replaced in the served
document by a bridge restricted to the actual parent window and origin.
No card mutation is accepted through postMessage. The supplied showCard
function loads actual artwork before releasing the hidden, paused stage.
Image preloads time out after 5 seconds; a failed image never reveals the
standalone example. The parent also bounds document/image startup and keeps
click/keyboard skip available even on failure. Palette sampling remains optional when
CORS/canvas access is unavailable.

The document is fetched as inert plain text, then used only as `srcDoc` inside
an iframe with `sandbox="allow-scripts"` (no same-origin access, forms, popups,
or top-level navigation). Its restrictive CSP permits inline visuals/scripts
and images but disables connections and other resources. Global security
headers remain unchanged. Supplied reduced-motion behavior is preserved.

The served document accelerates only the first 4.3 seconds at 1.4× (~3.1 seconds),
then restores normal animation speed. All layers share the same clock, so
delayed effects stay synchronized. Completion follows the final LR scale-up
(16.98s on the original timeline) or SSR arrival (9.52s), plus a 700ms hold.
Reduced-motion users advance after a short static hold. Original HTML assets
remain byte-identical; adaptation is confined to the sandbox bridge.

## Production delivery

`components/card-cinematic.tsx` enables the shared sandbox player for the live
route, always without visible controls. The public endpoint serves only the
two immutable visual templates and client-supplied, validated display fields;
it reads no accounts, collections or database data. Responses are inert plain
text, uncached and nosniff. Request length is bounded; template paths are fixed
by the SSR/LR allowlist and cached in process. Failed reads can be retried.
No Supabase migration or extra permission is needed.
