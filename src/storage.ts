import { spokenText } from "./engine";
import { localGateway } from "./localhost";
import { schema, type Show } from "./model";
import example from "../public/example-show.json";
import gaon from "../public/gaon-iris-gaon.json";
import iris from "../public/gaon-iris-iris.json";
// Cue IDs keep the illustrated beats attached to their lines when a show is edited.
const shots = [
  "meeting",
  "meeting",
  "meeting",
  "meeting",
  "lift",
  "lift",
  "lift",
  "cabin",
  "evidence",
  "evidence",
  "clue",
  "clue",
  "evidence",
  "iris",
  "evidence",
  "iris",
  "evidence",
  "iris",
  "iris",
  "iris",
  "evidence",
  "evidence",
  "evidence",
  "evidence",
  "evidence",
  "iris",
  "ray",
  "ray",
  "ray",
];
function illustrate(show: Show) {
  for (const [i, shot] of shots.entries()) {
    const turn = show.states.find(
      (t) => t.id === "turn-" + String(i + 1).padStart(2, "0"),
    );
    if (turn) turn.sceneEntryEvent ??= "picture_" + shot;
  }
  return show;
}
function elevatorExample(source: typeof gaon | typeof iris) {
  const show = schema.parse(source);
  show.showId += "-elevator";
  show.title += " · מעלית";
  show.sceneMax = {
    gateway: localGateway,
    projectGuid: "stagecue-elevator",
    sessionId: 1000,
    scene: "main",
  };
  // The bundled WAVs were already rendered by these voices. Keep them as the
  // playable audio for the editable TTS actions, including the timed split.
  for (const line of show.states) {
    if (line.kind !== "virtual_line") continue;
    const voice = line.actor === "איריס" ? "noa" : "asaf";
    line.actions = line.actions.map((action) =>
      action.type === "play_audio"
        ? {
            type: "text_to_speech",
            voice,
            text: spokenText(line),
            assetId: action.assetId,
          }
        : action,
    );
  }
  const turn = show.states.find((t) => t.id === "turn-06")!;
  const shake = {
    type: "scenemax" as const,
    event: "elevator_shake",
    message: "iris",
  };
  if (turn.kind === "virtual_line") {
    // Split at the recorded silence before היא רועדת. Sequencing follows the audio transport.
    show.assets = show.assets.filter((a) => a.id !== turn.id);
    for (const id of ["turn-06-lead", "turn-06-shake"])
      show.assets.push({
        id,
        type: "audio",
        uri: "assets/gaon-iris/" + id + ".wav",
      });
    const phrase = "היא רועדת";
    const spoken = spokenText(turn);
    if (!spoken.endsWith(phrase))
      throw new Error("Elevator shake phrase missing from cue 6");
    turn.actionMode = "sequential";
    turn.actions = [
      {
        type: "text_to_speech",
        voice: "noa",
        text: spoken.slice(0, -phrase.length).trimEnd(),
        assetId: "turn-06-lead",
      },
      shake,
      {
        type: "text_to_speech",
        voice: "noa",
        text: phrase,
        assetId: "turn-06-shake",
      },
    ];
  } else {
    turn.actions = [shake];
  }
  return schema.parse(illustrate(show));
}
const scripts = [
  schema.parse(gaon),
  schema.parse(iris),
  elevatorExample(gaon),
  elevatorExample(iris),
];
export const demo = schema.parse(example);
export function projects(): Show[] {
  const list: unknown[] = JSON.parse(
    localStorage.getItem("stagecue.projects") || "[]",
  );
  return [
    demo,
    ...scripts,
    ...list.map((x) => {
      const saved = schema.parse(x);
      return ["gaon-iris-gaon-elevator", "gaon-iris-iris-elevator"].includes(
        saved.showId,
      ) && saved.sceneMax
        ? illustrate(saved)
        : saved;
    }),
  ].filter((s, i, a) => a.findLastIndex((t) => t.showId === s.showId) === i);
}
export function sceneOf(show: Show) {
  if (show.collection) return show.collection;
  if (["gaon-iris-gaon", "gaon-iris-iris"].includes(show.showId))
    return { id: "gaon-iris", title: "גאון ואיריס" };
  if (
    ["gaon-iris-gaon-elevator", "gaon-iris-iris-elevator"].includes(show.showId)
  )
    return { id: "gaon-iris-elevator", title: "גאון ואיריס · מעלית" };
  return { id: show.showId, title: show.title };
}
export function sceneScripts(show: Show, list = projects()) {
  return list.filter((s) => sceneOf(s).id === sceneOf(show).id);
}
// Older files can contain different rooms per script. Apply a scene-wide room
// when the editor changes the connection, preserving older files on ordinary saves.
export function scriptsWithDraft(draft: Show) {
  const members = sceneScripts(draft);
  const previous = members.find((s) => s.showId === draft.showId);
  if (!previous) return [...members, draft];
  const changed =
    JSON.stringify(previous.sceneMax) !== JSON.stringify(draft.sceneMax);
  return members.map((s) =>
    s.showId === draft.showId
      ? draft
      : changed
        ? { ...s, sceneMax: draft.sceneMax }
        : s,
  );
}
export function saveScripts(scripts: Show[]) {
  const byId = new Map(projects().map((s) => [s.showId, s]));
  for (const s of scripts) byId.set(s.showId, schema.parse(s));
  const titles = new Map(
    scripts
      .filter((s) => s.collection)
      .map((s) => [s.collection!.id, s.collection!]),
  );
  localStorage.setItem(
    "stagecue.projects",
    JSON.stringify(
      [...byId.values()].map((s) => {
        const collection = titles.get(sceneOf(s).id);
        return collection ? { ...s, collection } : s;
      }),
    ),
  );
}
export function save(s: Show) {
  saveScripts(scriptsWithDraft(s));
}
const db = new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open("stagecue-media", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("files");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
export async function putMedia(key: string, file: File) {
  const tx = (await db).transaction("files", "readwrite");
  tx.objectStore("files").put(file, key);
  await new Promise<void>((ok, no) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => no(tx.error);
  });
}
export async function importMedia(showId: string, files: Map<string, Blob>) {
  const tx = (await db).transaction("files", "readwrite");
  for (const [uri, blob] of files)
    tx.objectStore("files").put(blob, showId + "/" + uri);
  await new Promise<void>((ok, fail) => {
    tx.oncomplete = () => ok();
    tx.onabort = () => fail(tx.error);
  });
}
export async function mediaUrl(show: Show, asset: Show["assets"][number]) {
  const req = (await db)
    .transaction("files")
    .objectStore("files")
    .get(show.showId + "/" + asset.uri);
  const blob = await new Promise<Blob | undefined>((ok, no) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });
  return blob ? URL.createObjectURL(blob) : "/" + asset.uri;
}
