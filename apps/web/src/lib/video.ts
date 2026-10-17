/**
 * How to show a lesson's video address: YouTube and Vimeo pages become their embeddable players, a direct
 * media file plays in a <video> element, and anything else is offered as a link (it cannot be embedded).
 */
export type VideoSource =
  | { kind: "youtube"; src: string }
  | { kind: "vimeo"; src: string }
  | { kind: "file"; src: string }
  | { kind: "link"; src: string };

import { isUploadLink } from "./upload";

const FILE_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov)(\?|#|$)/i;

export function videoSource(raw: string): VideoSource | null {
  // A video uploaded here plays natively from the API.
  if (isUploadLink(raw)) return { kind: "file", src: raw.trim() };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "").toLowerCase();

  if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com") {
    const id =
      host === "youtu.be"
        ? url.pathname.slice(1).split("/")[0]
        : url.pathname === "/watch"
          ? url.searchParams.get("v")
          : url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1];
    if (id && /^[\w-]{6,20}$/.test(id)) {
      const start = Number.parseInt(url.searchParams.get("t") ?? url.searchParams.get("start") ?? "", 10);
      return { kind: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}?rel=0${Number.isFinite(start) && start > 0 ? `&start=${start}` : ""}` };
    }
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.match(/(?:^|\/)(\d{5,12})(?:\/|$)/)?.[1];
    if (id) return { kind: "vimeo", src: `https://player.vimeo.com/video/${id}` };
  }

  if (FILE_EXT.test(url.pathname)) return { kind: "file", src: url.toString() };
  return { kind: "link", src: url.toString() };
}
