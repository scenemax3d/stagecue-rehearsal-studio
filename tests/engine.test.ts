import test from "node:test";
import assert from "node:assert/strict";
import { Engine, normalize } from "../src/engine";
import { schema } from "../src/model";
import example from "../public/example-show.json";
function setup() {
  const e = new Engine(schema.parse(example));
  e.enter(e.id);
  return e;
}
function say(
  e: Engine,
  time = 1000,
  text = e.turn.expectedText,
  id = e.id,
  final = true,
) {
  return e.accept({ id, text, final, at: time });
}
test("Hebrew marks, punctuation and spacing normalize without erasing negation", () => {
  assert.equal(normalize("  שָׁלוֹם,   אֲרִי! "), "שלום ארי");
  assert.equal(normalize("לא מוכן"), "לא מוכן");
});
test("first line renormalizes; alternatives accepted", () => {
  const e = setup();
  assert.ok(say(e, 100, "היי ארי"));
  assert.equal(e.score, 1);
});
test("guards partial endings and suppresses repeated partial/final IDs", () => {
  const e = setup();
  assert.equal(say(e, 500, "שלום", "u", false), false);
  assert.ok(say(e, 600, "שלום ארי", "u", false));
  assert.equal(say(e, 650, "שלום ארי", "u"), false);
  e.complete(e.epoch);
  assert.equal(say(e, 2000, e.turn.expectedText, "u"), false);
  assert.equal(e.serial, 1);
});
test("three ordered matches supply context, history cannot trigger alone", () => {
  const e = setup();
  for (let i = 0; i < 3; i++) {
    assert.ok(say(e, 1000 + i * 500));
    e.complete(e.epoch);
  }
  assert.equal(e.history.length, 3);
  assert.equal(say(e, 4000, "אבטיח"), false);
  assert.ok(e.context > 0.9);
  assert.ok(say(e, 4200));
});
test("stale and misordered evidence receive no context credit", () => {
  for (const stale of [true, false]) {
    const e = setup();
    say(e);
    e.complete(e.epoch);
    if (!stale) e.history[0].stateId = "other";
    say(e, stale ? 60000 : 1600);
    assert.equal(e.context, 0);
  }
});
test("manual jump, cancellation and pause invalidate stale events", () => {
  const e = setup(),
    old = e.epoch;
  e.fire();
  e.jump("cue-3");
  e.complete(old);
  assert.equal(e.id, "cue-3");
  assert.equal(
    e.accept(
      { id: "old", at: 200, text: e.turn.expectedText, final: true },
      old,
    ),
    false,
  );
  e.pause();
  assert.equal(say(e), false);
  e.enter(e.id);
  assert.ok(say(e));
  e.stop();
  assert.equal(e.id, "cue-1");
  assert.equal(e.phase, "IDLE");
  assert.equal(e.history.length, 0);
});
test("show validates on JSON round trip and rejects bad references, thresholds and cycles", () => {
  assert.deepEqual(
    schema.parse(JSON.parse(JSON.stringify(schema.parse(example)))),
    schema.parse(example),
  );
  for (const mutate of [
    (s: any) => (s.states[0].nextStateId = "unknown"),
    (s: any) => (s.states[0].nextStateId = "cue-1"),
    (s: any) => (s.states[1].id = "cue-1"),
    (s: any) => (s.assets = []),
    (s: any) => (s.recognition.matchThreshold = 1.1),
    (s: any) => (s.states[0].expectedText = ""),
  ]) {
    const s = structuredClone(example);
    mutate(s);
    assert.equal(schema.safeParse(s).success, false);
  }
});

test("early local probes need a complete line, while final recognition tolerates a variation", () => {
  const e = setup();
  const probe = {
    id: "speech",
    at: 1000,
    earlyProbe: true,
    final: false,
    text: "שלום הרי",
  };
  assert.equal(e.accept(probe), false);
  assert.equal(e.accept({ ...probe, text: "שלום" }), false);
  assert.equal(e.accept({ ...probe, text: "עכשיו הולכים הביתה" }), false);
  assert.equal(e.accept({ ...probe, text: "שָׁלוֹם ארי!" }), true);
  assert.equal(e.accept({ ...probe, final: true, earlyProbe: false }), false);
  assert.equal(
    setup().accept({ ...probe, final: true, earlyProbe: false }),
    true,
  );
});

test("optional Hebrew spans tolerate omission, speech and ASR substitutions across endpoints", () => {
  for (const optional of ["", "לעשות עם זה", "לאסוף איזה דבר"]) {
    const e = setup();
    e.turn.expectedText =
      "הווו זה חשוב!! חייבים #לעשות עם זה# משהו זה בלתי נסבל";
    e.turn.scriptedTurn = true;
    e.turn.alternatives = [];
    assert.equal(say(e, 1000, "הווו זה חשוב חייבים " + optional, "a"), false);
    assert.equal(say(e, 2000, "משהו זה בלתי נסבל", "b"), true);
    assert.equal(e.current, 1);
    assert.ok(e.feedback!.marks.every((m) => m === "heard"));
  }
});
test("word feedback distinguishes interior misses, future words and corrected partials", () => {
  const e = setup();
  e.turn.expectedText = "זה כבר משהו גדול מאוד";
  e.turn.scriptedTurn = true;
  e.turn.alternatives = [];
  assert.equal(say(e, 1000, "זה משהו", "u", false), false);
  assert.deepEqual(e.feedback?.marks, [
    "heard",
    "unheard",
    "heard",
    "pending",
    "pending",
  ]);
  assert.equal(say(e, 1100, "זה כבר משהו גדול מאוד", "u"), true);
  assert.ok(e.feedback!.marks.every((m) => m === "heard"));
});
test("leading and trailing optional words cannot replace required evidence", () => {
  const e = setup();
  e.turn.expectedText = "#נו# חייבים לפעול עכשיו #באמת#";
  e.turn.scriptedTurn = true;
  e.turn.alternatives = [];
  assert.equal(say(e, 100, "נו באמת", "a"), false);
  assert.equal(say(e, 200, "חייבים לפעול", "b", false), false);
  assert.equal(say(e, 300, "חייבים לפעול עכשיו", "b"), true);
});

test("streaming word feedback updates the line without firing a cue mid-speech", () => {
  const e = setup();
  const event = {
    id: "stream",
    text: e.turn.expectedText,
    at: 1000,
    final: false,
    feedbackOnly: true,
  };
  assert.equal(e.accept(event), false);
  assert.ok(e.armed);
  assert.deepEqual(e.feedback?.marks, ["heard", "heard"]);
  assert.equal(e.accept({ ...event, feedbackOnly: false, final: true }), true);
});
