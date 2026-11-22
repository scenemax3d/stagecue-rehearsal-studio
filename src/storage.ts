import { spokenText } from "./engine";
import { localGateway } from "./localhost";
import { diskLibrary, libraryRequest, library, commitCatalog, loadCatalog } from "./diskLibrary";
import { deleteScenePackages, loadLegacyPackage, writePackage } from "./sceneLibrary";
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
function storedIds(key: string): string[] {
  if (diskLibrary) return key === removedKey ? library.removed : library.deletedDefaults;
  return JSON.parse(localStorage.getItem(key) || "[]");
}
const removedKey = "stagecue.removedScenes";
const deletedDefaultsKey = "stagecue.deletedDefaults";
function allProjects(): Show[] {
  const deletedDefaults = storedIds(deletedDefaultsKey);
  const list: unknown[] = diskLibrary ? library.scripts : JSON.parse(
    localStorage.getItem("stagecue.projects") || "[]",
  );
  return [
    ...[demo, ...scripts].filter(s => !deletedDefaults.includes(s.showId)),
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
export function projects(removed = false): Show[] {
  const hidden = new Set(storedIds(removedKey));
  if (!hidden.size) return removed ? [] : allProjects();
  return allProjects().filter(s => hidden.has(sceneOf(s).id) === removed);
}
export async function setSceneRemoved(id: string, removed: boolean) {
  const hidden = new Set(storedIds(removedKey));
  if (removed) hidden.add(id);
  else hidden.delete(id);
  if (diskLibrary) return commitCatalog({removed: [...hidden]});
  localStorage.setItem(removedKey, JSON.stringify([...hidden]));
}
export function sceneOf(show: Show): NonNullable<Show["collection"]> {
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
export async function saveScripts(scripts: Show[]) {
  const byId = new Map(allProjects().map((s) => [s.showId, s]));
  for (const s of scripts) byId.set(s.showId, schema.parse(s));
  const titles = new Map(
    scripts
      .filter((s) => s.collection)
      .map((s) => [s.collection!.id, s.collection!]),
  );
  const updated = [...byId.values()].map(s => {
    const collection = titles.get(sceneOf(s).id);
    return collection ? {...s, collection} : s;
  });
  if (diskLibrary) await commitCatalog({scripts: updated});
  else localStorage.setItem("stagecue.projects", JSON.stringify(updated));
}
export function save(s: Show) {
  return saveScripts(scriptsWithDraft(s));
}
let legacyDb: Promise<IDBDatabase> | undefined;
const openMedia = () => legacyDb ??= new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open("stagecue-media", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("files");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
export async function deleteLocalScene(id: string) {
  const all = allProjects();
  const members = all.filter(s => sceneOf(s).id === id);
  const remaining = all.filter(s => sceneOf(s).id !== id);
  const referenced = new Set(remaining.map(s => s.scenePackage?.id));
  const packages = new Set(members.flatMap(s => s.scenePackage ? [s.scenePackage.id] : []));
  if (diskLibrary) {
    const ids = new Set(members.map(s => s.showId));
    const defaults = [demo, ...scripts].filter(s => ids.has(s.showId));
    await commitCatalog({
      scripts: library.scripts.filter(s => !ids.has(s.showId)),
      removed: library.removed.filter(key => key !== id),
      deletedDefaults: [...new Set([...library.deletedDefaults, ...defaults.map(s => s.showId)])],
    });
    await libraryRequest("clean", JSON.stringify({scripts:[...ids], packages:[...packages].filter(key => !referenced.has(key))}));
    return;
  }
  const tx = (await openMedia()).transaction("files", "readwrite");
  for (const s of members) {
    // All media for this script, including recordings superseded during editing.
    const prefix = s.showId + "/";
    const range = IDBKeyRange.bound(prefix, s.showId + "0", false, true);
    const store = tx.objectStore("files");
    const nested = remaining.filter(other => other.showId.startsWith(prefix));
    if (!nested.length) store.delete(range);
    else {
      const req = store.openKeyCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (!nested.some(other => String(cursor.key).startsWith(other.showId + "/")))
          store.delete(cursor.primaryKey);
        cursor.continue();
      };
    }
  }
  await new Promise<void>((ok, fail) => {
    tx.oncomplete = () => ok();
    tx.onabort = () => fail(tx.error);
  });
  await deleteScenePackages([...packages].filter(key => !referenced.has(key)));
  const ids = new Set(members.map(s => s.showId));
  const defaults = [demo, ...scripts].filter(s => ids.has(s.showId));
  if (defaults.length) localStorage.setItem(deletedDefaultsKey, JSON.stringify(
    [...new Set([...storedIds(deletedDefaultsKey), ...defaults.map(s => s.showId)])]
  ));
  const saved: Show[] = JSON.parse(localStorage.getItem("stagecue.projects") || "[]");
  localStorage.setItem("stagecue.projects", JSON.stringify(saved.filter(s => !ids.has(s.showId))));
  await setSceneRemoved(id, false);
}
export async function putMedia(showId: string, uri: string, file: File) {
  if (diskLibrary) {
    await libraryRequest("putMedia", file, {id:showId, uri, type:file.type});
    return;
  }
  const tx = (await openMedia()).transaction("files", "readwrite");
  tx.objectStore("files").put(file, showId + "/" + uri);
  await new Promise<void>((ok, no) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => no(tx.error);
  });
}
export async function importMedia(showId: string, files: Map<string, Blob>) {
  if (diskLibrary) {
    for (const [uri, blob] of files) await libraryRequest("putMedia", blob, {id:showId, uri, type:blob.type});
    return;
  }
  const tx = (await openMedia()).transaction("files", "readwrite");
  for (const [uri, blob] of files)
    tx.objectStore("files").put(blob, showId + "/" + uri);
  await new Promise<void>((ok, fail) => {
    tx.oncomplete = () => ok();
    tx.onabort = () => fail(tx.error);
  });
}
export async function mediaUrl(show: Show, asset: Show["assets"][number]) {
  if (diskLibrary) {
    const res = await libraryRequest("getMedia", undefined, {id:show.showId, uri:asset.uri});
    return res.ok ? URL.createObjectURL(await res.blob()) : "/" + asset.uri;
  }
  const req = (await openMedia())
    .transaction("files")
    .objectStore("files")
    .get(show.showId + "/" + asset.uri);
  const blob = await new Promise<Blob | undefined>((ok, no) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });
  return blob ? URL.createObjectURL(blob) : "/" + asset.uri;
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve,reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function openDesktopLibrary() {
  if (!diskLibrary || await loadCatalog()) return;
  // Publish the catalog only after every legacy script, asset and attachment is copied.
  // A failed migration can retry without changing the original workspace.
  const scripts: Show[] = JSON.parse(localStorage.getItem("stagecue.projects") || "[]").map((s:unknown) => schema.parse(s));
  const media = await openMedia();
  const keys = await readRequest(media.transaction("files").objectStore("files").getAllKeys());
  const owners = [...new Set([...scripts, demo, ...allProjects()].map(s => s.showId))].sort((a,b) => b.length-a.length);
  for (const key of keys) {
    if (typeof key !== "string") continue;
    const owner = owners.find(id => key.startsWith(id + "/assets/"));
    if (!owner) continue;
    const blob = await readRequest<Blob>(media.transaction("files").objectStore("files").get(key));
    await libraryRequest("putMedia", blob, {id:owner, uri:key.slice(owner.length+1), type:blob.type});
  }
  for (const id of new Set(scripts.flatMap(s => s.scenePackage ? [s.scenePackage.id] : [])))
    await writePackage(id, await loadLegacyPackage(id));
  await commitCatalog({scripts, removed: JSON.parse(localStorage.getItem(removedKey) || "[]"),
    deletedDefaults: JSON.parse(localStorage.getItem(deletedDefaultsKey) || "[]")});
}
