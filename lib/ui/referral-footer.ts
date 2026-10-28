export function referralFooterOffset(
  viewportHeight: number,
  footerTop: number | null
): number {
  if (
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0 ||
    footerTop === null ||
    !Number.isFinite(footerTop)
  )
    return 0;
  return Math.max(0, viewportHeight - footerTop);
}

// Only used by the compact Boosters reminder. No React render per scroll frame.
export function trackReferralFooter(reminder: HTMLElement): () => void {
  let frame = 0;
  let footer: Element | null = null;
  const resize =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  const mutation =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(schedule);

  function measure() {
    frame = 0;
    if (!footer || !footer.isConnected) {
      footer = document.querySelector(".yk-site-footer");
      if (footer) resize?.observe(footer);
    }
    const offset = referralFooterOffset(
      window.innerHeight,
      footer?.getBoundingClientRect().top ?? null
    );
    reminder.style.setProperty("--yk-referral-footer-offset", `${offset}px`);
    reminder.style.setProperty("--yk-referral-positioned", "visible");
  }
  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(measure);
  }

  resize?.observe(document.body);
  // Route content, fonts and lazily mounted footers may change after initial render.
  mutation?.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  measure();
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    resize?.disconnect();
    mutation?.disconnect();
    reminder.style.removeProperty("--yk-referral-footer-offset");
    reminder.style.removeProperty("--yk-referral-positioned");
  };
}
