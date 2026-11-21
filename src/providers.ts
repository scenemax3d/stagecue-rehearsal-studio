import {openMicrophone,inputThreshold} from "./microphone";
import {localAsr} from "./localhost";
import type { Hyp } from "./engine";
import type { Show } from "./model";
type Config = Show["recognition"] & { language: string };
type Hooks = {
  result: (h: Hyp, epoch: number) => void;
  error: (s: string) => void;
  epoch: () => number;
  gate: () => boolean;
  expectsContinuation: (text: string) => boolean;
  level: (v: number) => void;
};
export interface RecognitionProvider {
  start(): Promise<void>;
  stop(): void;
  reset(): void;
}
export class MockRecognitionProvider implements RecognitionProvider {
  constructor(private h: Hooks) {}
  async start() {}
  stop() {}
  reset() {}
  simulate(text: string) {
    const id = crypto.randomUUID(),
      ep = this.h.epoch(),
      at = performance.now();
    this.h.result(
      { id, text: text.split(" ").slice(0, -1).join(" "), final: false, at },
      ep,
    );
    this.h.result({ id, text, final: true, at: performance.now() }, ep);
  }
}
export class BrowserSpeechRecognitionProvider implements RecognitionProvider {
  rec: any;
  active = false;
  constructor(
    private h: Hooks,
    private cfg: Config,
  ) {}
  async start() {
    const w = window as any;
    const R = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!R)
      throw Error(
        "Browser speech recognition is unavailable. Choose Local Hebrew ASR or Simulator.",
      );
    this.active = true;
    const begin = () => {
      if (!this.active) return;
      const rec = (this.rec = new R()),
        session = crypto.randomUUID(),
        ep = this.h.epoch();
      rec.lang = this.cfg.language;
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (event: any) => {
        if (rec !== this.rec || this.h.gate()) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          this.h.result(
            {
              id: session + "-" + i,
              text: result[0].transcript,
              final: result.isFinal,
              at: performance.now(),
            },
            ep,
          );
        }
      };
      rec.onerror = (e: any) => {
        if (
          rec === this.rec &&
          this.active &&
          !["no-speech", "aborted"].includes(e.error)
        ) {
          this.active = false;
          this.h.error("Browser microphone: " + e.error);
        }
      };
      rec.onend = () => {
        if (this.active && rec === this.rec) begin();
      };
      rec.start();
    };
    begin();
  }
  reset() {
    this.rec?.abort();
  }
  stop() {
    this.active = false;
    this.rec?.abort();
    this.rec = null;
  }
}
export class LocalHebrewASRProvider implements RecognitionProvider {
  private ws?: WebSocket;
  private ctx?: AudioContext;
  get inputName(){return this.stream?.getAudioTracks()[0]?.label || "";}
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private stopped = false;
  private resetCapture = () => {};
  constructor(
    private h: Hooks,
    private cfg: Config,
  ) {}
  async start() {
    let streaming = false;
    const ws = (this.ws = new WebSocket(localAsr));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Local ASR connection timed out.")),
        8000,
      );
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            type: "start",
            language: this.cfg.language,
            sampleRate: 16000,
            wordFeedback: true,
          }),
        );
      ws.onmessage = (e) => {
        const ready = JSON.parse(e.data);
        if (ready.type === "error") {
          clearTimeout(timer);
          reject(Error(ready.message));
        } else if (ready.type === "ready") {
          streaming = ready.streaming === true;
          clearTimeout(timer);
          resolve();
        }
      };
      ws.onerror = ws.onclose = () => {
        clearTimeout(timer);
        reject(
          Error(
            "Local ASR is offline. Start the service or choose another input.",
          ),
        );
      };
    });
    if (this.stopped) return;
    ws.onclose = () => {
      if (!this.stopped)
        this.h.error(
          "Local ASR disconnected. Restart the rehearsal to reconnect.",
        );
    };
    const ctx = (this.ctx = new AudioContext({ sampleRate: 16000 }));
    await ctx.resume();
    const stream = await openMicrophone();
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    track.onended = () => {if (!this.stopped) this.h.error("Microphone disconnected. Choose an available microphone and restart rehearsal.");};
    const vadThreshold=inputThreshold(this.cfg.vadThreshold);
    await ctx.audioWorklet.addModule("/capture.js");
    if (this.stopped) return;
    const node = (this.node = new AudioWorkletNode(ctx, "cue-capture"));
    ctx.createMediaStreamSource(stream).connect(node);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    let pre: Float32Array[] = [],
      buffered: Float32Array[] = [];
    let quiet = 0,
      count = 0,
      ep = this.h.epoch(),
      uid = "",
      probed = false;
    const pending = new Map<
      string,
      {
        ep: number;
        end: number;
        probe: number;
        sent: number;
        probeSent: number;
        prefix: boolean;
      }
    >();
    const send = (type: string, probe?: number) =>
      ws.send(JSON.stringify({ type, utteranceId: uid, probe }));
    const pcm = (f: Float32Array) =>
      ws.send(
        Int16Array.from(f, (x) =>
          Math.round(Math.max(-1, Math.min(1, x)) * 32767),
        ),
      );
    const clear = () => {
      pre = [];
      buffered = [];
      quiet = 0;
      count = 0;
      uid = "";
      probed = false;
    };
    this.resetCapture = () => {
      clear();
      pending.clear();
      ep = this.h.epoch();
    };
    node.port.onmessage = ({ data: f }: { data: Float32Array }) => {
      if (this.stopped || ws.readyState !== 1) return;
      if (ep !== this.h.epoch() || this.h.gate()) {
        this.resetCapture();
        return;
      }
      const level = Math.sqrt(f.reduce((a, x) => a + x * x, 0) / f.length);
      const now = performance.now();
      this.h.level(level);
      if (!uid) {
        if (level < vadThreshold || pending.size >= 2) {
          pre.push(f);
          if (pre.length > 6) pre.shift();
          return;
        }
        uid = crypto.randomUUID();
        pending.set(uid, {
          ep,
          end: now,
          probe: 0,
          sent: 0,
          probeSent: 0,
          prefix: false,
        });
        if (streaming) {
          send("begin");
          pre.forEach(pcm);
        } else buffered = pre;
        pre = [];
      }
      const entry = pending.get(uid)!;
      if (level >= vadThreshold) {
        entry.end = now;
        quiet = 0;
        if (probed) {
          entry.probe++;
          entry.prefix = false;
          send("resume");
          probed = false;
        }
      } else quiet += f.length / 16;
      if (streaming) pcm(f);
      else buffered.push(f);
      count++;
      const silenceLimit = entry.prefix
        ? Math.max(1500, this.cfg.endpointSilenceMs)
        : this.cfg.endpointSilenceMs;
      if (quiet >= silenceLimit || count >= 850) {
        if (!streaming) buffered.forEach(pcm);
        entry.sent = now;
        send("endpoint");
        clear();
      } else if (streaming && !probed && quiet >= 128) {
        entry.probeSent = now;
        probed = true;
        send("probe", ++entry.probe);
      }
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "error") {
        this.h.error(msg.message);
        return;
      }
      const p = pending.get(msg.utteranceId);
      if (!p || (msg.type === "partial" && msg.probe !== p.probe)) return;
      if (msg.type === "partial")
        p.prefix = this.h.expectsContinuation(msg.text);
      if (msg.type === "final") pending.delete(msg.utteranceId);
      this.h.result(
        {
          id: msg.utteranceId,
          text: msg.text,
          at: performance.now(),
          endpoint: p.end,
          earlyProbe: msg.type === "partial",
          feedbackOnly: msg.type === "progress",
          silenceMs: (msg.type === "partial" ? p.probeSent : p.sent) - p.end,
          decodeMs: msg.decodeMs,
          final: msg.type === "final",
        },
        p.ep,
      );
    };
  }
  reset() {
    this.resetCapture();
  }
  stop() {
    this.stopped = true;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ws?.close();
  }
}
