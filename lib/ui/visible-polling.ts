export function startVisiblePolling(
  refresh: (resumed: boolean) => void,
  intervalMs: number
) {
  let timer: number | undefined;
  const onVisibility = () => {
    window.clearInterval(timer);
    timer = undefined;
    if (document.hidden) return;
    refresh(true);
    timer = window.setInterval(() => {
      if (!document.hidden) refresh(false);
    }, intervalMs);
  };
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
