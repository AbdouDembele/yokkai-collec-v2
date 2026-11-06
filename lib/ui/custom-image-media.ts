// Imgur serves every animated GIF as an MP4 too, usually 10 to 20 times
// lighter (a 41 MB GIF is a 2.5 MB MP4). Cards play that video instead and
// fall back to the GIF when Imgur has no MP4 (a still GIF answers 400).
const IMGUR_GIF = /^https:\/\/i\.imgur\.com\/([A-Za-z0-9]+)\.gif$/i;

export function imgurGifVideo(url?: string | null): string | undefined {
  const match = url ? IMGUR_GIF.exec(url) : null;
  return match ? `https://i.imgur.com/${match[1]}.mp4` : undefined;
}

// Largest file a player can choose as custom card art (what cards download:
// the MP4 for Imgur GIFs, the image itself otherwise).
export const CUSTOM_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
