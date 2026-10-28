export type ProfileImage = {
  mime: string;
  extension: string;
  animated: boolean;
};

// Inspect bytes, never the browser-supplied filename or Content-Type. GIF, APNG
// and animated WebP require Pro, even when uploaded with a static extension.
export function inspectProfileImage(input: Uint8Array): ProfileImage {
  const bytes = Buffer.from(input);
  const invalid = () => {
    throw new Error("PROFILE_IMAGE_INVALID");
  };
  if (bytes.length < 14 || bytes.length > 4 * 1024 * 1024) return invalid();
  const ascii = (start: number, end: number) =>
    bytes.toString("ascii", start, end);
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") {
    if (!bytes.readUInt16LE(6) || !bytes.readUInt16LE(8)) return invalid();
    return { mime: "image/gif", extension: "gif", animated: true };
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
      return invalid();
    return { mime: "image/jpeg", extension: "jpg", animated: false };
  }
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    let animated = false,
      header = false,
      end = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = bytes.readUInt32BE(offset);
      const type = ascii(offset + 4, offset + 8);
      if (offset + size + 12 > bytes.length) return invalid();
      if (!header) {
        if (type !== "IHDR" || size !== 13) return invalid();
        const width = bytes.readUInt32BE(offset + 8),
          height = bytes.readUInt32BE(offset + 12);
        if (!width || !height || width * height > 40_000_000) return invalid();
        header = true;
      }
      if (type === "acTL") animated = true;
      offset += size + 12;
      if (type === "IEND") {
        end = size === 0 && offset === bytes.length;
        break;
      }
    }
    if (!header || !end) return invalid();
    return { mime: "image/png", extension: "png", animated };
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    if (bytes.readUInt32LE(4) !== bytes.length - 8) return invalid();
    let animated = false,
      image = false,
      offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = ascii(offset, offset + 4),
        size = bytes.readUInt32LE(offset + 4);
      if (offset + size + 8 > bytes.length) return invalid();
      if (type === "ANIM" || type === "ANMF") animated = true;
      if (type === "VP8X") {
        if (size < 10) return invalid();
        animated ||= !!(bytes[offset + 8] & 2);
      }
      if (type === "VP8 " || type === "VP8L" || type === "ANMF") image = true;
      offset += 8 + size + (size % 2);
    }
    if (offset !== bytes.length || !image) return invalid();
    return { mime: "image/webp", extension: "webp", animated };
  }
  return invalid();
}
