import type { Show, Turn } from "./model";
import {
  alignLine,
  lineParts,
  normalize,
  displayText,
  type LinePart,
  type WordMark,
} from "./lineMatch";
export { normalize } from "./lineMatch";
export type Feedback = {
  turnId: string;
  parts: LinePart[];
  marks: WordMark[];
  alternative: boolean;
};
// The imported play keeps blocking and dialogue together for display.
export function spokenText(turn: Turn) {
  return displayText(
    turn.scriptedTurn
      ? turn.expectedText
          .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
          .replace(/\s+([.,!?])/g, "$1")
          .replace(/\s+/g, " ")
          .trim()
      : turn.expectedText,
  );
}
function similarity(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        row[j] + 1,
        row[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length, 1);
}
export type Hyp = {
  id: string;
  text: string;
  final: boolean;
  at: number;
  endpoint?: number;
  earlyProbe?: boolean;
  feedbackOnly?: boolean;
  decodeMs?: number;
  silenceMs?: number;
};
type History = { stateId: string; at: number; score: number; text: string };
export type Phase =
  | "IDLE"
  | "LISTENING"
  | "CANDIDATE"
  | "EXECUTING"
  | "WAITING_FOR_PLAYBACK"
  | "PAUSED"
  | "ERROR"
  | "FINISHED";
export class Engine {
  phase: Phase = "IDLE";
  history: History[] = [];
  id: string;
  last?: Turn;
  serial = 0;
  epoch = 0;
  armed = false;
  seen = new Set<string>();
  lastFire = -Infinity;
  hypothesis = "";
  score = 0;
  current = 0;
  context = 0;
  reason = "Ready";
  decision = 0;
  feedback?: Feedback;
  private candidates() {
    const t = this.turn;
    return [
      lineParts(t.expectedText, t.scriptedTurn),
      ...t.alternatives.map((text) => lineParts(text)),
    ]
      .map((parts, index) => ({ parts, alternative: index > 0 }))
      .filter((c) => c.parts.some((p) => p.kind === "word"));
  }
  expectsContinuation(text: string) {
    const fragment = normalize(text);
    return (
      !!fragment &&
      this.candidates().some(({ parts }) => {
        const { input, line } = alignLine(parts, fragment);
        return !!input && line.startsWith(input + " ");
      })
    );
  }
  private confirmedPrefix = "";
  constructor(public show: Show) {
    this.id = show.startStateId;
  }
  get turn() {
    return this.show.states.find((s) => s.id === this.id)!;
  }
  enter(id: string) {
    this.epoch++;
    this.confirmedPrefix = "";
    this.id = id;
    this.armed = true;
    this.phase = "LISTENING";
    this.hypothesis = "";
    this.score = this.current = this.context = 0;
    this.reason = "Waiting for a line";
  }
  stop() {
    this.enter(this.show.startStateId);
    this.phase = "IDLE";
    this.armed = false;
    this.history = [];
    this.seen.clear();
    this.feedback = undefined;
    this.last = undefined;
    this.lastFire = -Infinity;
  }
  pause() {
    this.epoch++;
    this.armed = false;
    this.phase = "PAUSED";
  }
  jump(id: string) {
    this.feedback = undefined;
    this.epoch++;
    this.history = [];
    this.enter(id);
  }
  accept(h: Hyp, epoch = this.epoch) {
    if (
      !this.armed ||
      epoch !== this.epoch ||
      this.seen.has(h.id) ||
      this.turn.kind !== "human_line"
    )
      return false;
    const r = this.show.recognition,
      t = this.turn,
      fragment = normalize(h.text);
    if (!fragment) return false;
    const inputs = this.confirmedPrefix
      ? [fragment, this.confirmedPrefix + " " + fragment]
      : [fragment];
    const options = this.candidates()
      .flatMap(({ parts, alternative }) =>
        inputs.map((raw) => {
          const aligned = alignLine(parts, raw);
          return {
            ...aligned,
            parts,
            alternative,
            raw,
            score: similarity(aligned.input, aligned.line),
          };
        }),
      )
      .sort((a, b) => b.score - a.score);
    const best = options[0];
    if (!best) return false;
    const input = best.input,
      words = input.split(" ");
    this.feedback = {
      turnId: t.id,
      parts: best.parts,
      marks: best.marks,
      alternative: best.alternative,
    };
    const isPrefix = options.some(
      (o) =>
        o.raw === best.raw && !!o.input && o.line.startsWith(o.input + " "),
    );
    const exact = input === best.line;
    // A substitution at the end is marked "unheard"; an unspoken ending is
    // marked "pending". Only relax the scripted ending after a final result.
    const heard = best.marks.filter(mark => mark === "heard").length;
    const strongEndingMatch = t.scriptedTurn && h.final && !isPrefix &&
      best.marks.at(-1) === "unheard" && heard / best.marks.length >= 0.85;
    const complete = (exact && (!isPrefix || h.final)) || strongEndingMatch;
    const moreToSay =
      t.scriptedTurn &&
      !complete &&
      (isPrefix || words.at(-1) !== best.line.split(" ").at(-1));
    if (moreToSay && h.final) {
      const prefix = best.line.split(" ").slice(0, words.length).join(" ");
      if (
        words.length < best.line.split(" ").length &&
        similarity(input, prefix) >= 0.8
      ) {
        this.confirmedPrefix = best.raw;
        this.seen.add(h.id);
      }
    }
    this.hypothesis = best.raw;
    this.current = best.score;
    const prior: Turn[] = [];
    let prev = t;
    while (prior.length < r.windowSize) {
      const found = this.show.states.find((s) => s.nextStateId === prev.id);
      if (!found) break;
      prev = found;
      if (found.kind === "human_line") prior.push(found);
    }
    const recent = this.history.slice().reverse().slice(0, r.windowSize);
    let evidence = 0;
    prior.forEach((p, i) => {
      const item = recent[i];
      if (item?.stateId === p.id && h.at - item.at <= r.maxHistoryAgeMs)
        evidence +=
          item.score *
          (1 -
            (Math.max(0, h.at - item.at) / Math.max(r.maxHistoryAgeMs, 1)) *
              0.25);
    });
    this.context = prior.length ? evidence / prior.length : 0;
    this.score =
      !exact && !strongEndingMatch && prior.length && recent.some((v) => h.at - v.at <= r.maxHistoryAgeMs)
        ? (r.currentLineWeight * this.current +
            r.historyWeight * this.context) /
          (r.currentLineWeight + r.historyWeight)
        : this.current;
    const terminal =
      h.final || input.split(" ").at(-1) === best.line.split(" ").at(-1);
    this.reason = h.feedbackOnly && !complete
      ? "Listening for the rest of the line"
      : moreToSay
        ? "Waiting for the rest of the turn"
        : h.earlyProbe && input !== best.line
          ? "Waiting for complete line"
          : !this.current ||
              this.current <
                (t.trigger.minCurrentLineScore ?? r.minCurrentLineScore)
            ? "Current line below minimum"
            : this.score < (t.trigger.threshold ?? r.matchThreshold)
              ? "Below cue threshold"
              : (t.trigger.requireTerminalEvidence ??
                    r.requireTerminalEvidence) &&
                  !terminal
                ? "Waiting for line ending"
                : !h.final && isPrefix
                  ? "Ambiguous prefix"
                  : h.at - this.lastFire < r.cooldownMs
                    ? "Cooldown"
                    : "Matched";
    this.phase = this.current >= 0.45 ? "CANDIDATE" : "LISTENING";
    if (this.reason !== "Matched") return false;
    this.seen.add(h.id);
    this.history.push({
      stateId: t.id,
      at: h.at,
      score: this.current,
      text: t.scriptedTurn ? input : h.text,
    });
    this.lastFire = h.at;
    this.fire();
    return true;
  }
  fire() {
    if (!this.armed) return false;
    this.armed = false;
    this.phase = "EXECUTING";
    this.last = this.turn;
    this.serial++;
    return true;
  }
  complete(epoch: number) {
    if (epoch !== this.epoch || this.armed) return;
    if (this.turn.nextStateId) this.enter(this.turn.nextStateId);
    else {
      this.epoch++;
      this.phase = "FINISHED";
      this.armed = false;
    }
  }
}
