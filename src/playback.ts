import type { Action, Show, Turn } from "./model";
import { mediaUrl } from "./storage";
import { youtubeEmbed } from "./youtube";
import { broadcast } from "./scenemax";
export interface ActionExecutor {
  run(
    actions: Action[],
    signal: AbortSignal,
    onset: () => void,
    mode?: Turn["actionMode"],
  ): Promise<void>;
}
export class Playback implements ActionExecutor {
  urls = new Map<string, string>();
  cache = new Map<string, HTMLMediaElement>();
  paused = false;
  disposed = false;
  stage?: HTMLElement;
  private active = new Set<HTMLMediaElement>();
  private network = new AbortController();
  private pending = new Set<Promise<void>>();
  constructor(
    private show: Show,
    private update: () => void,
    private notice: (s: string) => void,
  ) {}
  async preload() {
    for (const a of this.show.assets) {
      const url = await mediaUrl(this.show, a);
      if (this.disposed) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        return;
      }
      this.urls.set(a.id, url);
      if (a.type !== "image") {
        const m = document.createElement(a.type);
        m.preload = "auto";
        m.src = url;
        m.load();
        this.cache.set(a.id, m);
      }
    }
  }
  reset() {
    this.network.abort();
    this.network = new AbortController();
    this.stage?.replaceChildren();
    this.stage = undefined;
    this.paused = false;
  }
  dispose() {
    this.disposed = true;
    this.reset();
    this.cache.forEach((m) => {
      m.pause();
      m.removeAttribute("src");
      m.load();
    });
    this.urls.forEach((u) => {
      if (u.startsWith("blob:")) URL.revokeObjectURL(u);
    });
  }
  setPaused(v: boolean) {
    this.paused = v;
    for (const m of this.active) {
      if (v) m.pause();
      else this.play(m);
    }
    this.stage
      ?.querySelectorAll("iframe")
      .forEach((f) =>
        f.contentWindow?.postMessage(
          JSON.stringify({
            event: "command",
            func: v ? "pauseVideo" : "playVideo",
            args: [],
          }),
          "https://www.youtube.com",
        ),
      );
  }
  private play(m: HTMLMediaElement) {
    m.play().catch((e) => {
      if (e.name !== "AbortError" && this.active.has(m))
        m.dispatchEvent(new Event("error"));
    });
  }
  private async wait(ms: number, signal: AbortSignal) {
    let last = performance.now();
    while (ms > 0 || this.paused) {
      signal.throwIfAborted();
      await new Promise((r) => setTimeout(r, Math.min(30, Math.max(5, ms))));
      const now = performance.now();
      if (!this.paused) ms -= now - last;
      last = now;
    }
    signal.throwIfAborted();
  }
  async settleNetwork() {
    await Promise.all(this.pending);
  }
  async run(
    actions: Action[],
    signal: AbortSignal,
    onset: () => void,
    mode: Turn["actionMode"] = "sequential",
  ) {
    const local = new AbortController();
    const abort = () => local.abort();
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    const token = local.signal;
    let group: HTMLElement | undefined;
    const present = (el: HTMLElement) => {
      if (!group || mode !== "parallel") {
        this.stage?.replaceChildren();
        group = document.createElement("div");
        group.className = "cue-outputs";
      }
      this.stage = group;
      group.append(el);
      this.update();
    };
    const execute = async (a: Action) => {
      await this.wait("delayMs" in a ? (a.delayMs ?? 0) : 0, token);
      if (a.type === "wait") return this.wait(a.durationMs, token);
      if (a.type === "emit_ws") {
        this.notice(
          "Legacy WebSocket action is disabled. Use a SceneMax broadcast action.",
        );
        return;
      }
      if (a.type === "scenemax") {
        if (!this.show.sceneMax)
          throw Error("Configure the SceneMax connection");
        const net = AbortSignal.any([signal,token,this.network.signal]);
        const task = broadcast(this.show.sceneMax, a.event, a.message, net)
          .then(() => this.notice("SceneMax broadcast sent · " + a.event))
          .catch((e) => {
            if (!net.aborted) this.notice(String(e));
          });
        this.pending.add(task);
        void task.finally(() => this.pending.delete(task));
        return;
      }
      if (a.type === "youtube") {
        const url = youtubeEmbed(a.url);
        if (!url) throw Error("Invalid YouTube link");
        url.searchParams.set("autoplay", "1");
        url.searchParams.set("enablejsapi", "1");
        url.searchParams.set("origin", location.origin);
        url.searchParams.set("playsinline", "1");
        const frame = document.createElement("iframe");
        frame.title = "YouTube clip";
        frame.allow = "autoplay; fullscreen; encrypted-media";
        frame.allowFullscreen = true;
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        frame.src = url.href;
        present(frame);
        return;
      }
      const url = this.urls.get(a.assetId);
      if (!url) throw Error("Missing media: " + a.assetId);
      if (a.type === "show_image") {
        const img = new Image();
        img.alt = a.assetId;
        img.src = url;
        await img.decode();
        token.throwIfAborted();
        present(img);
        onset();
        if (a.durationMs) {
          await this.wait(a.durationMs, token);
          img.remove();
          if (!group?.childElementCount) this.stage = undefined;
          this.update();
        }
        return;
      }
      const original = this.cache.get(a.assetId);
      if (!original) throw Error("Missing media: " + a.assetId);
      const m = this.active.has(original)
        ? (original.cloneNode(true) as HTMLMediaElement)
        : original;
      m.currentTime = 0;
      m.volume = a.type === "play_audio" ? (a.volume ?? 1) : 1;
      if (a.type === "play_video") present(m);
      this.active.add(m);
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          this.active.delete(m);
          m.removeEventListener("ended", ended);
          m.removeEventListener("error", error);
          m.removeEventListener("playing", onset);
          token.removeEventListener("abort", cancel);
        };
        const ended = () => {
            cleanup();
            resolve();
          },
          error = () => {
            cleanup();
            reject(
              Error("Cannot play " + a.assetId + ". Check its media file."),
            );
          },
          cancel = () => {
            m.pause();
            cleanup();
            reject(new DOMException("Stopped", "AbortError"));
          };
        m.addEventListener("ended", ended);
        m.addEventListener("error", error);
        m.addEventListener("playing", onset, { once: true });
        token.addEventListener("abort", cancel, { once: true });
        this.play(m);
      });
    };
    try {
      if (mode === "parallel") await Promise.all(actions.map(execute));
      else for (const a of actions) await execute(a);
    } catch (e) {
      local.abort();
      throw e;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
}
