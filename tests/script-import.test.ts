import test from "node:test";
import assert from "node:assert/strict";
import { Engine, spokenText, normalize } from "../src/engine";
import { schema } from "../src/model";
import gaon from "../public/gaon-iris-gaon.json";
import iris from "../public/gaon-iris-iris.json";
for (const [role, project] of [
  ["Gaon", gaon],
  ["Iris", iris],
] as const) {
  test(
    role + " can complete every turn across separate final speech events",
    () => {
      const show = schema.parse(project);
      assert.equal(show.states.length, 29);
      const engine = new Engine(show);
      engine.enter(show.startStateId);
      let at = 1000;
      for (const turn of show.states) {
        assert.equal(engine.id, turn.id);
        if (turn.kind === "human_line") {
          const words = normalize(spokenText(turn)).split(" ");
          for (let i = 0; i < words.length; i++) {
            at += 300;
            const accepted = engine.accept({
              id: String(at),
              final: true,
              at,
              text: words[i],
            });
            assert.equal(
              accepted,
              i === words.length - 1,
              turn.id + " word " + i,
            );
          }
        } else assert.ok(engine.fire());
        engine.complete(engine.epoch);
      }
      assert.equal(engine.phase, "FINISHED");
    },
  );
}
