function periodWidth(element: HTMLElement) {
  const width =
    element.querySelector<HTMLElement>("[data-scroll-period]")?.offsetWidth ??
    0;
  return width > element.clientWidth ? width : 0;
}

// Recenter on the identical middle copy, preserving the exact offset.
export function scrollStripBy(element: HTMLElement, delta: number) {
  const period = periodWidth(element);
  element.scrollLeft = period
    ? period +
      ((((element.scrollLeft - period + delta) % period) + period) % period)
    : Math.max(
        0,
        Math.min(
          element.scrollWidth - element.clientWidth,
          element.scrollLeft + delta
        )
      );
}

export function enableHorizontalWheel(element: HTMLElement) {
  const layout = () => {
    const period = periodWidth(element);
    element
      .querySelectorAll<HTMLElement>("[data-scroll-clone]")
      .forEach(copy => {
        copy.hidden = !period;
      });
    if (period) scrollStripBy(element, 0);
  };
  const recenter = () => {
    // Keyboard focus remains on the accessible copy; native focus scrolling wins.
    if (
      document.activeElement === element ||
      !element.contains(document.activeElement)
    )
      scrollStripBy(element, 0);
  };
  const scroll = (event: WheelEvent) => {
    if (event.ctrlKey) return;
    const delta =
      (Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY) *
      (event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? element.clientWidth
          : 1);
    if (element.scrollWidth <= element.clientWidth || !delta) return;
    event.preventDefault();
    scrollStripBy(element, delta);
  };
  layout();
  const observer = new ResizeObserver(layout);
  observer.observe(element);
  const period = element.querySelector("[data-scroll-period]");
  if (period) observer.observe(period);
  element.addEventListener("wheel", scroll, { passive: false });
  element.addEventListener("scroll", recenter);
  return () => {
    observer.disconnect();
    element.removeEventListener("wheel", scroll);
    element.removeEventListener("scroll", recenter);
  };
}

// Native transform animation stays smooth between display frames, like the hero.
export function enableAutomaticScroll(element: HTMLElement) {
  const track = element.firstElementChild as HTMLElement | null;
  if (!track) return () => {};
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let animation: Animation | null = null;
  let duration = 0;
  let distance = 0;
  let resumeAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (!animation) return;
    const offset =
      ((Number(animation.currentTime ?? 0) % duration) / duration) * distance;
    animation.cancel();
    animation = null;
    scrollStripBy(element, offset);
  };
  const start = () => {
    if (
      animation ||
      motion.matches ||
      document.hidden ||
      element.matches(":hover, :focus-within")
    )
      return;
    const wait = resumeAt - Date.now();
    if (wait > 0) {
      clearTimeout(timer);
      timer = setTimeout(start, wait);
      return;
    }
    distance = periodWidth(element);
    if (!distance) return;
    duration = (distance / 40) * 1000;
    const offset =
      (((element.scrollLeft - distance) % distance) + distance) % distance;
    element.scrollLeft = distance;
    animation = track.animate(
      [
        { transform: "translateX(0px)" },
        { transform: "translateX(-" + distance + "px)" }
      ],
      { duration, iterations: Infinity, easing: "linear" }
    );
    animation.currentTime = (offset / distance) * duration;
  };
  const pause = () => {
    resumeAt = Date.now() + 6000;
    stop();
    clearTimeout(timer);
    timer = setTimeout(start, 6000);
  };
  const update = () => {
    stop();
    start();
  };
  const leave = () => {
    clearTimeout(timer);
    timer = setTimeout(start, 0);
  };
  const observer = new ResizeObserver(update);
  observer.observe(element);
  const period = element.querySelector("[data-scroll-period]");
  if (period) observer.observe(period);
  element.addEventListener("mouseenter", stop);
  element.addEventListener("mouseleave", leave);
  element.addEventListener("focusin", stop);
  element.addEventListener("focusout", leave);
  element.addEventListener("wheel", pause, { passive: true });
  element.addEventListener("pointerdown", pause);
  document.addEventListener("visibilitychange", update);
  motion.addEventListener("change", update);
  start();
  return () => {
    stop();
    clearTimeout(timer);
    observer.disconnect();
    element.removeEventListener("mouseenter", stop);
    element.removeEventListener("mouseleave", leave);
    element.removeEventListener("focusin", stop);
    element.removeEventListener("focusout", leave);
    element.removeEventListener("wheel", pause);
    element.removeEventListener("pointerdown", pause);
    document.removeEventListener("visibilitychange", update);
    motion.removeEventListener("change", update);
  };
}
