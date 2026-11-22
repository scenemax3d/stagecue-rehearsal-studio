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

test("an endpoint cannot replace a missing final word", () => {
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
    false,
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

test("Oliver cue 19 fires once on exact streaming recognition even with weak history", () => {
  const e = setup();
  const t = e.show.states[3];
  t.expectedText = "קלטתי איפה זה. אני לא בודק אותך שם.";
  t.scriptedTurn = true;
  e.enter(t.id);
  e.history.push({ stateId: e.show.states[2].id, at: 700, score: 0.8, text: "previous" });
  const h = { id: "speech", at: 1000, text: "קלטתי איפה זה", final: false, feedbackOnly: true };
  assert.equal(e.accept(h), false);
  const full = { ...h, text: "קלטתי איפה זה אני לא בודק אותך שם" };
  assert.ok(e.accept(full));
  assert.equal(e.score, 1);
  assert.ok(e.feedback!.marks.every(mark => mark === "heard"));
  e.complete(e.epoch);
  assert.equal(e.id, t.nextStateId);
  assert.equal(e.accept({ ...full, feedbackOnly: false, final: true }), false);
  assert.equal(e.serial, 1);
});

test("a completed alternative has its own mandatory ending", () => {
  const e = setup();
  e.turn.expectedText = "אני מוכן עכשיו";
  e.turn.alternatives = ["אני מוכן"];
  e.turn.scriptedTurn = true;
  const h = { id: "short", at: 800, text: "אני מוכן", final: false, feedbackOnly: true };
  assert.ok(e.accept(h));
  assert.equal(e.accept({ ...h, feedbackOnly: false, final: true }), false);
});

test("Oliver cue 20 waits for the mandatory final word across pauses", () => {
  const e = setup();
  const t = e.show.states[3];
  t.scriptedTurn = true;
  t.expectedText = "כבר שלושה לילות אני לא ישן. זה מגרד, ואז אני נוגע, ואז זה נורא שורף. תסתכל שנייה. מרחוק. אני לא מבקש שתיגע.";
  t.alternatives = [];
  e.enter(t.id);
  e.history.push({ stateId: "earlier", at: 500, score: 1, text: "previous" });
  const prefix = normalize(t.expectedText).split(" ").slice(0, -1).join(" ");
  assert.equal(say(e, 1000, prefix, "first"), false);
  assert.equal(e.feedback?.marks.at(-1), "pending");
  const last = { id: "second", at: 1400, text: "שתגיע", final: false };
  assert.equal(e.accept({ ...last, earlyProbe: true }), false);
  assert.equal(e.accept({ ...last, feedbackOnly: true }), false);
  assert.equal(e.accept({ ...last, final: true }), false);
  assert.equal(e.feedback?.marks.at(-1), "unheard");
  assert.ok(say(e, 1800, "שתיגע", "corrected"));
  e.complete(e.epoch);
  assert.equal(e.id, t.nextStateId);
});

test("a short scripted line with a different ending still needs stronger evidence", () => {
  const e = setup();
  e.turn.scriptedTurn = true;
  e.turn.expectedText = "טוב תראה לי";
  e.turn.alternatives = [];
  assert.equal(say(e, 1000, "טוב תראה לה"), false);
});

test("Rachel cue 8 advances with one missed word once the actor reaches חודשים", () => {
  for (const number of ["שבעה", "7", "כמה", ""]) {
    const e = setup();
    const t = e.show.states[3];
    t.scriptedTurn = true;
    t.expectedText = "(בחיוך מבויש) כן, עברתי לגור שם לפני 7 חודשים";
    t.alternatives = [];
    e.enter(t.id);
    e.history.push({ stateId: "earlier", at: 500, score: 1, text: "previous" });
    const text = "כן עברתי לגור שם לפני " + number;
    assert.equal(say(e, 1000, text, "prefix", false), false);
    assert.ok(say(e, 1300, text + " חודשים", "full"));
    assert.equal(e.feedback?.marks.at(-2), number === "7" ? "heard" : "unheard");
    e.complete(e.epoch);
    assert.equal(e.id, t.nextStateId);
  }
});

test("Oliver cue 26 accepts one interior omission or substitution after the line ends", () => {
  for (const transcript of ["אז תרים שלא לך", "אז תרים שלא תאמר לך"]) {
    const e = setup();
    const t = e.show.states[3];
    t.scriptedTurn = true;
    t.expectedText = "אז תרים, שלא יתקרר לך.";
    t.alternatives = [];
    e.enter(t.id);
    e.history.push({stateId:"unrelated", at:500, score:1, text:"previous"});
    assert.equal(e.accept({id:"interim",text:transcript.split(" ").slice(0,-1).join(" "),at:1000,final:false,feedbackOnly:true}), false);
    assert.ok(say(e, 1300, transcript, "final"));
    assert.deepEqual(e.feedback?.marks, ["heard","heard","heard","unheard","heard"]);
    e.complete(e.epoch);
    assert.equal(e.id, t.nextStateId);
  }
});

test("a pause before the last word of Oliver cue 26 still waits", () => {
  const e = setup();
  e.turn.scriptedTurn = true;
  e.turn.expectedText = "אז תרים, שלא יתקרר לך.";
  e.turn.alternatives = [];
  assert.equal(say(e, 1000, "אז תרים שלא יתקרר"), false);
  assert.equal(e.feedback?.marks.at(-1), "pending");
});

test("every scene uses 70% of required words and an aligned final required word", () => {
  for (const scriptedTurn of [false, true]) {
    for (const [text, pass, score] of [
      ["two four five six seven eight ten", true, 0.7],
      ["two four five six seven ten", false, 0.6],
      ["one two three four five six seven eight nine", false, 0.9],
    ] as const) {
      const e = setup();
      e.turn.scriptedTurn = scriptedTurn;
      e.turn.expectedText = "one two #optional words# three four five six seven eight nine ten #extra#";
      e.turn.alternatives = [];
      e.turn.trigger.threshold = pass ? 1 : 0;
      e.turn.trigger.requireTerminalEvidence = false;
      assert.equal(say(e, 1000, text), pass);
      assert.equal(e.score, score);
    }
  }
});
