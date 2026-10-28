const SURFACE = [36, 40, 56];
function luminance(rgb: number[]) {
  const linear = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
const surfaceLuminance = luminance(SURFACE);
const contrast = (rgb: number[]) =>
  (luminance(rgb) + 0.05) / (surfaceLuminance + 0.05);

/** Presentation only: retain the selected hue and saved value. */
export function readableNameColor(hex: string): string {
  if (!/^#[a-f\d]{6}$/i.test(hex)) return "#eeebff";
  const rgb = [1, 3, 5].map(offset =>
    Number.parseInt(hex.slice(offset, offset + 2), 16)
  );
  if (contrast(rgb) >= 4.5) return hex;
  const mix = (amount: number) =>
    rgb.map(channel => Math.round(channel + (255 - channel) * amount));
  let low = 0,
    high = 1;
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2;
    if (contrast(mix(middle)) >= 4.5) high = middle;
    else low = middle;
  }
  return (
    "#" +
    mix(high)
      .map(channel => channel.toString(16).padStart(2, "0"))
      .join("")
  );
}
