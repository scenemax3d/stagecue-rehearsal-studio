export function youtubeEmbed(link: string): URL | undefined {
  try {
    const u = new URL(link);
    if (!["http:", "https:"].includes(u.protocol)) return;
    const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
    const parts = u.pathname.split("/").filter(Boolean);
    let id: string | null = null;
    if (host === "youtu.be") id = parts[0];
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      if (["embed", "shorts", "live"].includes(parts[0])) id = parts[1];
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return;
    const out = new URL("https://www.youtube.com/embed/" + id);
    const t = u.searchParams.get("start") || u.searchParams.get("t") || "";
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(\d+)s?$/.exec(t);
    const seconds = match
      ? Number(match[1] || 0) * 3600 +
        Number(match[2] || 0) * 60 +
        Number(match[3])
      : 0;
    if (seconds) out.searchParams.set("start", String(seconds));
    return out;
  } catch {
    return;
  }
}
