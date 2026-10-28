# Final booster opening

Original user-supplied `yokkai_booster_opening_final.html`, copied unchanged as
`reveal.html`. Integration notes were treated as reference material only.

The public `/api/booster-opening?kind=regular|decision` endpoint serves an inert
plain-text document for the same sandbox isolation as SSR/LR reveals. Only the
two existing booster image paths are allowed, selected by pack kind, with blue
or pink ambient accents and the original 11% tear. No arbitrary image URLs,
client card lists, database access or extra account permissions are accepted.

The served adaptation removes the embedded demonstration image and default
startup, translates accessible text into English, hides the standalone replay
button, bounds image loading, and adds a strict parent-origin message bridge.
The actual pack is hidden until loaded. A scoped animation-name reset makes the
supplied scene replay reset all layers together. Original keyframes, sizing,
image aspect ratio and reduced-motion behavior are preserved.

The last finite visual effect ends at 5 seconds; completion is sent after a
200ms final hold (500ms for reduced motion). Clicking or pressing Enter/Space
on the existing full-screen opening skips this decorative wait. Fetch/image
failure also releases the visual gate, never a second pack request.

The live Game and local simulated pack preview explicitly enable the new opening.
`Boosters` retains its legacy default opening for compatibility. A real opening
is submitted once under the existing lock, and card reveals wait for both the
server result and the visual gate. An undefined/empty result or rejected request
does not reveal the previous draw. The Regular/Decision result, reward and keep
flows, drop rates and the deployed SSR/LR cinematics are unchanged.

No migration. No existing tests weakened or modified.

Behind the production proxy, Next can see `https://localhost:3000` as the
request URL. Both public opening/cinematic routes therefore use the configured
`NEXT_PUBLIC_SITE_URL` origin in production for their parent message target.
This fixes the existing SSR/LR completion handshake as well. No forwarded
header is trusted, and development keeps its actual local origin.
