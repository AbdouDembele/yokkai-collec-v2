export function hexToHsv(hex: string) {
  const safe = /^#[a-f\d]{6}$/i.test(hex) ? hex : "#9abcff";
  const [r, g, b] = [1, 3, 5].map(
    i => parseInt(safe.slice(i, i + 2), 16) / 255
  );
  const v = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = v - min;
  let h =
    d === 0
      ? 0
      : v === r
        ? (g - b) / d
        : v === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: v === 0 ? 0 : d / v, v };
}

export function hsvToHex(hue: number, saturation: number, brightness: number) {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, saturation)),
    v = Math.min(1, Math.max(0, brightness));
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return (
    "#" +
    rgb
      .map(channel =>
        Math.round((channel + m) * 255)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}
