"use client";
import { useTranslations } from "next-intl";

import type { CSSProperties } from "react";
import { hexToHsv, hsvToHex } from "@/lib/ui/color-wheel";

export function ShowcaseColorPicker({
  value,
  onChange,
  onReset
}: {
  value: string;
  onChange: (color: string) => void;
  onReset: () => void;
}) {
  const t = useTranslations();
  const hsv = hexToHsv(value);
  const angle = (hsv.h * Math.PI) / 180;
  const pick = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2,
      y = event.clientY - rect.top - rect.height / 2;
    const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const saturation = Math.min(1, Math.hypot(x, y) / (rect.width / 2));
    onChange(hsvToHex(hue, saturation, hsv.v || 1));
  };
  return (
    <div className="yk-showcase-color-picker">
      <p className="yk-style-help">{t("profileUi.showcaseColorHint")} </p>
      <div className="yk-showcase-color-layout">
        <button
          type="button"
          role="slider"
          className="yk-showcase-color-wheel"
          aria-label={t("profileUi.showcaseColorHue")}
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={Math.min(359, Math.round(hsv.h))}
          aria-valuetext={t("profileUi.colorSaturation", {
            color: value.toUpperCase(),
            percent: Math.round(hsv.s * 100)
          })}
          aria-describedby="showcase-wheel-help"
          style={{ "--wheel-darkness": 1 - hsv.v } as CSSProperties}
          onPointerDown={event => {
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            pick(event);
          }}
          onPointerMove={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              pick(event);
          }}
          onKeyDown={event => {
            const delta = event.shiftKey ? 10 : 1;
            let hue: number;
            if (event.key === "ArrowRight" || event.key === "ArrowUp")
              hue = hsv.h + delta;
            else if (event.key === "ArrowLeft" || event.key === "ArrowDown")
              hue = hsv.h - delta;
            else if (event.key === "Home") hue = 0;
            else if (event.key === "End") hue = 359;
            else return;
            event.preventDefault();
            onChange(hsvToHex(hue, hsv.s || 1, hsv.v || 1));
          }}
        >
          <span
            className="yk-showcase-color-handle"
            aria-hidden="true"
            style={{
              left: `${50 + Math.cos(angle) * hsv.s * 50}%`,
              top: `${50 + Math.sin(angle) * hsv.s * 50}%`,
              background: value
            }}
          />
        </button>
        <div className="yk-showcase-color-controls">
          <div className="yk-showcase-color-value">
            <input
              type="color"
              value={value}
              aria-label={t("profileUi.showcaseColorPicker")}
              onChange={event => onChange(event.target.value)}
            />
            <output aria-label={t("profileUi.showcaseColorValue")}>
              {value.toUpperCase()}
            </output>
          </div>
          <label>
            {t("profileUi.saturation")}{" "}
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(hsv.s * 100)}
              onChange={event =>
                onChange(
                  hsvToHex(hsv.h, Number(event.target.value) / 100, hsv.v)
                )
              }
            />
          </label>
          <label>
            {t("profileUi.brightness")}{" "}
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(hsv.v * 100)}
              onChange={event =>
                onChange(
                  hsvToHex(hsv.h, hsv.s, Number(event.target.value) / 100)
                )
              }
            />
          </label>
          <button type="button" className="yk-style-reset" onClick={onReset}>
            {t("profileUi.resetShowcaseColor")}{" "}
          </button>
        </div>
      </div>
      <p id="showcase-wheel-help" className="sr-only">
        {t("profileUi.colorWheelKeyboardHint")}{" "}
      </p>
    </div>
  );
}
