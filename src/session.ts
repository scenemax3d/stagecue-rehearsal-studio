import type { Show, Turn } from "./model";
import { Engine, type Hyp, type Phase } from "./engine";
import {
  LocalHebrewASRProvider,
  BrowserSpeechRecognitionProvider,
  MockRecognitionProvider,
  type RecognitionProvider,
} from "./providers";
import { Playback } from "./playback";
import { broadcast } from "./scenemax";
export const names = {
  "local-hebrew-asr": "Local Hebrew ASR",
  browser: "Browser speech",
  mock: "Simulator",
};
type Row = { time: string; detail: string };
export class Session {
  e: Engine;
  player: Playback;
  provider?: RecognitionProvider;
  mode: Show["recognition"]["provider"];
  mic = false;
  get inputName(){return this.provider instanceof LocalHebrewASRProvider ? this.provider.inputName : "";}
  busy = false;
  level = 0;
  error = "";
  logs: Row[] = [];
  timings: {
    endpoint?: number;
    decodeMs?: number;
    silenceMs?: number;
    asr: number;
    decision: number;
    dispatch: number;
    onset?: number;
  }[] = [];
  samples: {
    text: string;
    score: number;
    current: number;
    context: number;
    reason: string;
  }[] = [];
  private entry?: { event: string; ctrl: AbortController };
  private enterScene(turn: Turn) {
    const event = turn.sceneEntryEvent;
    if (!event || !this.show.sceneMax || this.entry?.event === event) return;
    this.entry?.ctrl.abort();
    const ctrl = new AbortController();
    this.entry = { event, ctrl };
    void broadcast(this.show.sceneMax, event, "", ctrl.signal)
      .then(() => { if (!ctrl.signal.aborted) this.log("SceneMax · " + event); })
      .catch((error) => {
        if (ctrl.signal.aborted) return;
        this.entry = undefined;
        this.log(String(error));
      });
  }
  syncScene() {
    this.entry?.ctrl.abort();
    this.entry = undefined;
    this.enterScene(this.e.turn);
  }
  private queued?: Hyp;
  private receive?: (h: Hyp, ep: number) => void;
  private seq = 0;
  private ctrl?: AbortController;
  private beforePause: Phase = "LISTENING";
  private load: Promise<void>;
  constructor(
    public show: Show,
    private draw: () => void,
  ) {
    this.mode = show.recognition.provider;
    this.e = new Engine(show);
    this.player = new Playback(show, draw, (s) => this.log(s));
    this.load = this.player.preload();
    this.load.catch((e) => this.fail(String(e)));
  }
  log(detail: string) {
    this.logs.unshift({
      time: new Date().toLocaleTimeString([], { hour12: false }),
      detail,
    });
    this.logs = this.logs.slice(0, 80);
    this.draw();
  }
  fail(s: string) {
    this.cancel();
    this.error = s;
    this.e.phase = "ERROR";
    this.e.armed = false;
    this.log(s);
  }
  private cancel() {
    this.entry?.ctrl.abort();
    this.entry = undefined;
    this.queued = undefined;
    this.seq++;
    this.ctrl?.abort();
    this.ctrl = undefined;
    this.player.paused = false;
    this.player.reset();
    this.provider?.stop();
    this.provider = undefined;
    this.busy = this.mic = false;
    this.level = 0;
  }
  stop() {
    this.cancel();
    this.e.stop();
    this.error = "";
    this.log("Rehearsal stopped");
  }
  dispose() {
    this.cancel();
    this.player.dispose();
  }
  async start(id = this.e.id) {
    this.cancel();
    const seq = this.seq;
    this.e.stop();
    this.e.enter(id);
    this.e.armed = false;
    this.error = "";
    this.busy = true;
    this.draw();
    const cfg = { ...this.show.recognition, language: this.show.language },
      h = {
        epoch: () =>
          this.e.epoch +
          Number(
            !cfg.gateMicDuringPlayback &&
              this.e.phase === "WAITING_FOR_PLAYBACK",
          ),
        expectsContinuation: (text: string) => this.e.expectsContinuation(text),
        gate: () =>
          this.busy ||
          this.e.phase === "PAUSED" ||
          (!this.e.armed && cfg.gateMicDuringPlayback),
        level: (v: number) => {
          this.level = v;
          this.draw();
        },
        error: (s: string) => {
          if (seq === this.seq) this.fail(s);
        },
        result: (event: Hyp, ep: number) => {
          if (seq !== this.seq) return;
          if (
            !cfg.gateMicDuringPlayback &&
            this.e.phase === "WAITING_FOR_PLAYBACK" &&
            ep === this.e.epoch + 1 &&
            event.final
          ) {
            this.queued = event;
            return;
          }
          if (ep !== this.e.epoch || !this.e.armed) return;
          const fired = this.e.accept(event, ep);
          this.samples.unshift({
            text: event.text,
            score: this.e.score,
            current: this.e.current,
            context: this.e.context,
            reason: this.e.reason,
          });
          this.samples = this.samples.slice(0, 60);
          this.draw();
          if (fired) void this.execute(this.e.turn, false, event);
        },
      };
    this.receive = h.result;
    const p = (this.provider =
      this.mode === "mock"
        ? new MockRecognitionProvider(h)
        : this.mode === "browser"
          ? new BrowserSpeechRecognitionProvider(h, cfg)
          : new LocalHebrewASRProvider(h, cfg));
    try {
      await this.load;
      if (seq !== this.seq) return;
      await p.start();
      if (this.seq !== seq) {
        p.stop();
        return;
      }
      this.mic = this.mode !== "mock";
      this.busy = false;
      this.e.armed = true;
      this.log("Rehearsal started · " + names[this.mode]);
      this.auto();
    } catch (e) {
      if (this.seq === seq)
        this.fail(e instanceof Error ? e.message : String(e));
    }
  }
  simulate(text: string) {
    if (this.provider instanceof MockRecognitionProvider)
      this.provider.simulate(text);
  }
  auto() {
    this.enterScene(this.e.turn);
    if (this.e.turn.kind === "virtual_line" && this.e.fire())
      void this.execute(this.e.turn);
  }
  advance() {
    if (this.e.fire()) void this.execute(this.e.turn);
  }
  replay() {
    if (this.e.last && this.e.armed) {
      this.e.armed = false;
      this.e.epoch++;
      this.e.serial++;
      this.enterScene(this.e.last);
      void this.execute(this.e.last, true);
    }
  }
  async execute(t: Turn, replay = false, h?: Hyp) {
    const epoch = this.e.epoch,
      ctrl = (this.ctrl = new AbortController()),
      now = performance.now();
    const time = {
      endpoint: h?.endpoint,
      decodeMs: h?.decodeMs,
      silenceMs: h?.silenceMs,
      asr: h?.at ?? now,
      decision: now,
      dispatch: performance.now(),
      onset: undefined as number | undefined,
    };
    this.timings.push(time);
    this.e.phase = "WAITING_FOR_PLAYBACK";
    if (!this.show.recognition.gateMicDuringPlayback) this.provider?.reset();
    this.log(
      (replay ? "Replay " : "Cue fired · ") + t.id + " #" + this.e.serial,
    );
    try {
      await this.player.run(
        t.actions,
        ctrl.signal,
        () => {
          time.onset ??= performance.now();
          this.draw();
        },
        t.actionMode,
      );
      if (ctrl.signal.aborted) return;
      if (replay) this.e.enter(this.e.id);
      else this.e.complete(epoch);
      if (this.show.recognition.gateMicDuringPlayback) this.provider?.reset();
      const queued = this.queued;
      this.queued = undefined;
      if (
        !replay &&
        queued &&
        this.e.armed &&
        this.e.turn.kind === "human_line"
      )
        this.receive?.(queued, this.e.epoch);
      if ((this.e.phase as Phase) === "FINISHED") {
        this.provider?.stop();
        this.mic = false;
        this.log("Scene complete");
      } else {
        this.draw();
        this.auto();
      }
    } catch (e) {
      if (!ctrl.signal.aborted) this.fail(String(e));
    }
  }
  pause() {
    if (this.e.phase === "PAUSED") {
      this.player.setPaused(false);
      if (this.beforePause === "WAITING_FOR_PLAYBACK") {
        this.e.phase = this.beforePause;
      } else {
        this.e.enter(this.e.id);
        this.provider?.reset();
      }
      this.log("Resumed");
      return;
    }
    this.queued = undefined;
    this.beforePause = this.e.phase;
    this.player.setPaused(true);
    if (this.beforePause === "WAITING_FOR_PLAYBACK") this.e.phase = "PAUSED";
    else this.e.pause();
    this.provider?.reset();
    this.log("Paused");
  }
  jump(id: string) {
    this.queued = undefined;
    this.ctrl?.abort();
    this.player.paused = false;
    this.player.reset();
    const idle = ["IDLE", "FINISHED", "ERROR"].includes(this.e.phase);
    this.e.jump(id);
    this.provider?.reset();
    if (idle) {
      this.e.phase = "IDLE";
      this.e.armed = false;
    }
    this.log("Selected " + id);
    if (!idle) this.auto();
  }
}
