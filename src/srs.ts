import { zip, unzip, strToU8, strFromU8 } from "fflate";
import { schema, type Show } from "./model";
import {
  mediaUrl,
  importMedia,
  saveScripts,
  sceneOf,
  scriptsWithDraft,
} from "./storage";
import { loadScene, storeSceneEntries } from "./sceneLibrary";

type Entries = Record<string, Uint8Array<ArrayBuffer>>;
const maxSize = 1024 ** 3;
async function read(url: string) {
  const res = await fetch(url);
  if (!res.ok || res.headers.get("content-type")?.includes("text/html"))
    throw Error("Missing file: " + url);
  return res;
}
async function scriptEntries(draft: Show) {
  const show = schema.parse(draft);
  // The time this workspace received the scene belongs to the local library.
  if (show.collection) delete show.collection.added;
  const entries: Entries = Object.create(null);
  const media: Record<string, string> = Object.create(null);
  for (const asset of show.assets) {
    if (Object.hasOwn(media, asset.uri)) continue;
    const url = await mediaUrl(show, asset);
    try {
      const blob = await (await read(url)).blob();
      media[asset.uri] = blob.type;
      entries[asset.uri] = new Uint8Array(await blob.arrayBuffer());
    } finally {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
  }
  let sceneName: string | undefined;
  if (show.scenePackage) {
    const bundle = await loadScene(show.scenePackage.id);
    sceneName = show.scenePackage.name;
    entries["scene/game-manifest.json"] = strToU8(
      JSON.stringify(bundle.manifest),
    );
    for (const [path, blob] of bundle.assets)
      entries["scene/" + path] = new Uint8Array(await blob.arrayBuffer());
  } else if (
    show.sceneMax?.projectGuid === "stagecue-elevator" &&
    show.sceneMax.scene === "main" &&
    show.sceneMax.sessionId === 1000
  ) {
    sceneName = "Elevator";
    const manifest = await (await read("/scenemax/game-manifest.json")).json();
    entries["scene/game-manifest.json"] = strToU8(JSON.stringify(manifest));
    for (const path of manifest.files)
      if (!Object.hasOwn(manifest.aliases ?? {}, path))
        entries["scene/" + path] = new Uint8Array(
          await (
            await read(
              "/scenemax/" + path.split("/").map(encodeURIComponent).join("/"),
            )
          ).arrayBuffer(),
        );
  }
  entries["show.json"] = strToU8(JSON.stringify(show));
  entries["stagecue.json"] = strToU8(
    JSON.stringify({ format: "StageCue", version: 1, media, sceneName }),
  );
  return entries;
}
export async function exportSrs(draft: Show) {
  const scene = sceneOf(draft);
  const scripts = scriptsWithDraft(draft);
  let entries: Entries = Object.create(null);
  if (scripts.length === 1) entries = await scriptEntries(draft);
  else {
    entries["stagecue.json"] = strToU8(
      JSON.stringify({
        format: "StageCue",
        version: 2,
        title: scene.title,
        scriptCount: scripts.length,
        active: scripts.findIndex((s) => s.showId === draft.showId),
      }),
    );
    for (const [i, script] of scripts.entries()) {
      for (const [path, bytes] of Object.entries(await scriptEntries(script)))
        entries["scripts/" + i + "/" + path] = bytes;
    }
  }
  if (Object.values(entries).reduce((n, v) => n + v.byteLength, 0) > maxSize)
    throw Error("StageCue package exceeds 1 GB.");
  const data = await new Promise<Uint8Array<ArrayBuffer>>((ok, fail) =>
    zip(entries, { level: 3 }, (err, bytes) =>
      err ? fail(err) : ok(bytes as Uint8Array<ArrayBuffer>),
    ),
  );
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/zip" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download =
    (scene.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "StageCue") + ".srs";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function importSrs(file: File) {
  let size = 0,
    invalid = false;
  const paths = new Set<string>();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Entries>((ok, fail) =>
    unzip(
      bytes,
      {
        filter: (f) => {
          if (f.name.endsWith("/")) return false;
          size += f.originalSize;
          if (
            size > maxSize ||
            paths.has(f.name) ||
            /[\\:\x00-\x1f]/.test(f.name) ||
            f.name.split("/").some((p) => !p || p === "." || p === "..")
          )
            invalid = true;
          paths.add(f.name);
          return !invalid;
        },
      },
      (err, result) =>
        err
          ? fail(err)
          : invalid
            ? fail(Error("Invalid or oversized StageCue package."))
            : ok(result as Entries),
    ),
  );
  if (!entries["stagecue.json"])
    throw Error("This file is not a StageCue package.");
  const manifest = JSON.parse(strFromU8(entries["stagecue.json"]));
  if (manifest.format !== "StageCue" || ![1, 2].includes(manifest.version))
    throw Error("Unsupported StageCue package version.");
  const collected = [];
  if (manifest.version === 1) collected.push(await readScript(entries));
  else {
    const groups = new Map<string, Entries>();
    for (const [key, val] of Object.entries(entries)) {
      const match = /^scripts\/(0|[1-9]\d*)\/(.+)$/.exec(key);
      if (!match) continue;
      if (!groups.has(match[1])) groups.set(match[1], Object.create(null));
      groups.get(match[1])![match[2]] = val;
    }
    if (
      !groups.size ||
      groups.size !== manifest.scriptCount ||
      typeof manifest.title !== "string" ||
      !manifest.title.trim()
    )
      throw Error("Invalid scene file.");
    for (let i = 0; i < groups.size; i++) {
      const part = groups.get(String(i));
      if (!part) throw Error("Invalid scene file.");
      collected.push(await readScript(part));
    }
  }
  const collection = {
    id: crypto.randomUUID(),
    added: { at: new Date().toISOString(), via: "imported" },
    title:
      manifest.version === 2
        ? manifest.title
        : sceneOf(collected[0].show).title,
  };
  const scripts = collected.map(({ show }) =>
    schema.parse({ ...show, collection, showId: crypto.randomUUID() }),
  );
  for (const [i, s] of scripts.entries())
    await importMedia(s.showId, collected[i].files);
  saveScripts(scripts);
  return (
    (Number.isInteger(manifest.active) && scripts[manifest.active]) ||
    scripts[0]
  );
}
async function readScript(entries: Entries) {
  if (!entries["stagecue.json"] || !entries["show.json"])
    throw Error("This file is not a StageCue package.");
  const header = JSON.parse(strFromU8(entries["stagecue.json"]));
  if (header.format !== "StageCue" || header.version !== 1)
    throw Error("Unsupported StageCue package version.");
  const show = schema.parse(JSON.parse(strFromU8(entries["show.json"])));
  const files = new Map<string, Blob>();
  for (const asset of show.assets) {
    const content = entries[asset.uri];
    if (!content) throw Error("Missing file: " + asset.uri);
    files.set(
      asset.uri,
      new Blob([content], { type: header.media?.[asset.uri] || "" }),
    );
  }
  if (header.sceneName || show.scenePackage) {
    if (!entries["scene/game-manifest.json"])
      throw Error("Missing SceneMax scene.");
    const parts = new Map<string, Blob>();
    for (const [key, value] of Object.entries(entries))
      if (key.startsWith("scene/")) parts.set(key.slice(6), new Blob([value]));
    const scene = await storeSceneEntries(
      parts,
      header.sceneName || "SceneMax",
    );
    if (show.scenePackage && scene.id !== show.scenePackage.id)
      throw Error("SceneMax scene does not match the script.");
    show.scenePackage = scene;
  }
  return { show: schema.parse(show), files };
}
