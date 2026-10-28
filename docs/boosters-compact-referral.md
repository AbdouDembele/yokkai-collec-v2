# Compact Boosters selection and invitation

On `/boosters`, the referral invitation stays visible for authenticated players, including those who dismissed the reminder on another page. It has no close control. Other pages keep the existing dismissal preference; Home keeps its inline referral section.

The invitation is at most 376px wide, 12px from the left edge, with the same copy-link action and reward conditions. Its position leaves 16px plus the safe-area inset above the footer, including while scrolling. Scroll, viewport resize, content resize and late footer mounting are observed; measurement updates a CSS variable without a React render on each scroll. Observers and listeners are cleaned up. There is no database or reward-rule change.

The idle desktop pack-selection layout is compact from 1024px wide on viewports up to 1200px tall: smaller header spacing, a compact Pro promotion preserving its text, a 54px footer interior and pack artwork sized to the available viewport height. Opening controls retain their existing 44px minimum height. Room is reserved for the referral invitation above the footer. The opening and card-reveal layouts are not restyled.

No document overflow is hidden, no page is scaled, and no pack detail or action is removed to force a fit. Mobile, very short windows and expanded error states can still scroll normally. No SQL migration; nothing to apply on the VPS. Existing tests are unchanged.
