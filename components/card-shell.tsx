"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { animation } from "@/lib/ui/animations";
import "@/styles/card-shell.css";

export type CardShellProps = {
  children: ReactNode;
  className?: string;
  demoState?: "hover" | "tilt" | "reflection";
  interactive?: boolean;
};

export function CardShell({
  children,
  className = "",
  demoState,
  interactive = true
}: CardShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || demoState || !interactive) return;
    const precisePointer = window.matchMedia(
      "(hover: hover) and (pointer: fine)"
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    const reset = () => {
      window.cancelAnimationFrame(frame);
      shell.style.removeProperty("--shell-tilt-x");
      shell.style.removeProperty("--shell-tilt-y");
      shell.style.removeProperty("--shell-reflect-x");
      shell.style.removeProperty("--shell-reflect-opacity");
    };
    const move = (event: PointerEvent) => {
      if (
        !precisePointer.matches ||
        reducedMotion.matches ||
        event.pointerType === "touch"
      )
        return;
      const bounds = shell.getBoundingClientRect();
      const x = Math.max(
        -1,
        Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2)
      );
      const y = Math.max(
        -1,
        Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2)
      );
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        shell.style.setProperty(
          "--shell-tilt-x",
          `${(-y * animation.cardShell.tiltX).toFixed(2)}deg`
        );
        shell.style.setProperty(
          "--shell-tilt-y",
          `${(x * animation.cardShell.tiltY).toFixed(2)}deg`
        );
        shell.style.setProperty(
          "--shell-reflect-x",
          `${(x * animation.cardShell.reflectionTravel).toFixed(1)}%`
        );
        shell.style.setProperty(
          "--shell-reflect-opacity",
          `${animation.cardShell.reflectionOpacity}`
        );
      });
    };

    shell.addEventListener("pointermove", move, { passive: true });
    shell.addEventListener("pointerleave", reset);
    reducedMotion.addEventListener("change", reset);
    precisePointer.addEventListener("change", reset);
    return () => {
      window.cancelAnimationFrame(frame);
      shell.removeEventListener("pointermove", move);
      shell.removeEventListener("pointerleave", reset);
      reducedMotion.removeEventListener("change", reset);
      precisePointer.removeEventListener("change", reset);
    };
  }, [demoState, interactive]);

  return (
    <div
      ref={shellRef}
      className={`yk-card-shell ${interactive ? "" : "yk-card-shell-static"} ${demoState ? `yk-card-shell-demo-${demoState}` : ""} ${className}`}
      data-card-shell="true"
    >
      <div className="yk-card-shell-plane">
        {children}
        <span className="yk-card-shell-reflection" aria-hidden="true" />
      </div>
    </div>
  );
}
