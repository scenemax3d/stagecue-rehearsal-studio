import { routeMedia, releaseMedia } from "./audioOutput";
import type { Action, Show, Turn } from "./model";
import { mediaUrl } from "./storage";
import { youtubeEmbed } from "./youtube";
import { synthesizeSpeech } from "./speech";
import { broadcast } from "./scenemax";
type CueTimer = { label: string; total: number; remaining: number };

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
  private speech = new Map<string, HTMLAudioElement>();
  private active = new Set<HTMLMediaElement>();
  private timers = new Set<CueTimer>();
  get countdown() {
    let longest: CueTimer | undefined;
    for (const timer of this.timers)
      if (!longest || timer.remaining > longest.remaining) longest = timer;
    return longest;
  }
  private visualLifetime = new AbortController();
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
    this.timers.clear();
    this.visualLifetime.abort();
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
    this.speech.forEach(m => {
      const url = m.src;
      m.pause();
      m.removeAttribute("src");
      m.load();
      URL.revokeObjectURL(url);
    });
    this.speech.clear();
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
  private async wait(ms: number, signal: AbortSignal, tick?: (remaining: number) => void) {
    let last = performance.now();
    while (ms > 0 || this.paused) {
      signal.throwIfAborted();
      await new Promise((r) => setTimeout(r, Math.min(30, Math.max(5, ms))));
      const now = performance.now();
      if (!this.paused) {
        ms -= now - last;
        tick?.(ms);
      }
      last = now;
    }
    signal.throwIfAborted();
  }
  private async timedWait(ms: number, signal: AbortSignal, label: string) {
    if (!ms) return this.wait(0, signal);
    const timer = { label, total: ms, remaining: ms };
    this.timers.add(timer);
    this.update();
    try {
      await this.wait(ms, signal, remaining => {
        if (Math.ceil(remaining / 100) !== Math.ceil(timer.remaining / 100)) {
          timer.remaining = Math.max(0, remaining);
          this.update();
        }
      });
    } finally {
      this.timers.delete(timer);
      this.update();
    }
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
        this.visualLifetime.abort();
        this.visualLifetime = new AbortController();
        this.stage?.replaceChildren();
        group = document.createElement("div");
        group.className = "cue-outputs";
      }
      this.stage = group;
      group.append(el);
      this.update();
    };
    const execute = async (a: Action, index: number) => {
      await this.timedWait("delayMs" in a ? (a.delayMs ?? 0) : 0, token, "Media delay");
      if (a.type === "wait") return this.timedWait(a.durationMs, token, "Timed wait");
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
      if (a.type === "show_image") {
        const url = this.urls.get(a.assetId);
        if (!url) throw Error("Missing media: " + a.assetId);
        const img = new Image();
        img.alt = a.assetId;
        img.src = url;
        await img.decode();
        token.throwIfAborted();
        present(img);
        onset();
        if (a.durationMs) {
          const hide = () => {
            img.remove();
            if (this.stage === group && !group?.childElementCount) this.stage = undefined;
            this.update();
          };
          if (mode === "sequential" && index < actions.length - 1) {
            // Preserve timing between explicitly sequenced actions in this cue.
            await this.timedWait(a.durationMs, token, "Image display");
            hide();
          } else {
            // The image owns the remaining display time; the actor can continue.
            const lifetime = this.visualLifetime.signal;
            void this.wait(a.durationMs, lifetime).then(hide, () => {});
          }
        }
        return;
      }
      let original = a.assetId ? this.cache.get(a.assetId) : undefined;
      if (a.type === "text_to_speech" && !a.assetId) {
        const key = JSON.stringify([a.voice, a.text, a.speed ?? 1, a.pitch ?? 0]);
        original = this.speech.get(key);
        if (!original) {
          const preparing = { label: "Preparing speech", total: 0, remaining: 0 };
          this.timers.add(preparing);
          this.update();
          let blob: Blob;
          try {
            blob = await synthesizeSpeech(a, token);
          } finally {
            this.timers.delete(preparing);
            this.update();
          }
          token.throwIfAborted();
          if (this.disposed) throw new DOMException("Stopped", "AbortError");
          original = this.speech.get(key);
          if (!original) {
            const audio = new Audio(URL.createObjectURL(blob));
            this.speech.set(key, audio);
            original = audio;
          }
        }
        await this.wait(0, token);
      }
      if (!original) throw Error("Missing media: " + a.assetId);
      const m = this.active.has(original)
        ? (original.cloneNode(true) as HTMLMediaElement)
        : original;
      m.currentTime = 0;
      m.volume = a.type === "play_audio" ? (a.volume ?? 1) : 1;
      if (a.type === "play_video") present(m);
      await routeMedia(m);
      if (token.aborted) { releaseMedia(m); token.throwIfAborted(); }
      this.active.add(m);
      await new Promise<void>((resolve, reject) => {
        const timer = { label: a.type === "play_video" ? "Video playback" : "Audio playback", total: 0, remaining: 0 };
        const syncTime = () => {
          if (!Number.isFinite(m.duration) || m.duration <= 0) return;
          timer.total = m.duration * 1000;
          timer.remaining = Math.max(0, timer.total - m.currentTime * 1000);
          this.timers.add(timer);
          this.update();
        };
        m.addEventListener("timeupdate", syncTime);
        m.addEventListener("durationchange", syncTime);
        syncTime();
        const cleanup = () => {
          m.removeEventListener("timeupdate", syncTime);
          m.removeEventListener("durationchange", syncTime);
          this.timers.delete(timer);
          this.update();
          this.active.delete(m);
          releaseMedia(m);
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
              Error(a.assetId ? "Cannot play " + a.assetId + ". Check its media file." : "Cannot play synthesized speech."),
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
      else for (const [index, action] of actions.entries()) await execute(action, index);
    } catch (e) {
      local.abort();
      throw e;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
}
