import { unzip } from "fflate";

type Manifest = {
  entry: string;
  files: string[];
  aliases?: Record<string, string>;
  effects?: boolean;
  effect_distortion?: boolean;
};
export type SceneBundle = { manifest: Manifest; assets: Map<string, Blob> };
export type SceneRef = { id: string; name: string };
const openLibrary = () =>
  new Promise<IDBDatabase>((ok, fail) => {
    const req = indexedDB.open("stagecue.scenes", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("packages");
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
export async function deleteScenePackages(ids: string[]) {
  if (!ids.length) return;
  const db = await openLibrary();
  try {
    await new Promise<void>((ok, fail) => {
      const tx = db.transaction("packages", "readwrite");
      for (const id of ids) tx.objectStore("packages").delete(id);
      tx.oncomplete = () => ok();
      tx.onabort = () => fail(tx.error);
    });
  } finally { db.close(); }
}
export async function loadScene(id: string): Promise<SceneBundle> {
  const db = await openLibrary();
  try {
    return await new Promise((ok, fail) => {
      const req = db.transaction("packages").objectStore("packages").get(id);
      req.onsuccess = () =>
        req.result
          ? ok(req.result)
          : fail(
              Error(
                "Import this scene again in Script editor on this computer.",
              ),
            );
      req.onerror = () => fail(req.error);
    });
  } finally {
    db.close();
  }
}
function validPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    !/[\\:\x00-\x1f]/.test(path) &&
    path.split("/").every((s) => s && s !== "." && s !== "..")
  );
}
export async function importScene(files: File[]): Promise<SceneRef> {
  const entries = new Map<string, Blob>();
  let name = files[0]?.name;
  if (
    files.length === 1 &&
    !files[0].webkitRelativePath &&
    /\.zip$/i.test(name)
  ) {
    const bytes = new Uint8Array(await files[0].arrayBuffer());
    const data = await new Promise<Record<string, Uint8Array<ArrayBuffer>>>(
      (ok, fail) => {
        let size = 0,
          oversized = false;
        unzip(
          bytes,
          {
            filter: (f) => {
              // Omit the export's executable web shell. Use the installed player.
              if (!validPath(f.name)) return false;
              if (
                !/(^|\/)(game|scripts|resources)\//.test(f.name) &&
                /(?:^|\/)(runtime_bg\.wasm|runtime\.js)$/.test(f.name)
              )
                return false;
              size += f.originalSize;
              if (size > 1024 ** 3) oversized = true;
              return !oversized;
            },
          },
          (err, result) =>
            err
              ? fail(err)
              : oversized
                ? fail(
                    Error("For scenes over 1 GB, import the extracted folder."),
                  )
                : ok(result as Record<string, Uint8Array<ArrayBuffer>>),
        );
      },
    );
    for (const [path, bytes] of Object.entries(data))
      entries.set(path, new Blob([bytes]));
  } else {
    for (const file of files) {
      const [folder, ...rest] = file.webkitRelativePath.split("/");
      name = folder;
      const path = rest.join("/");
      if (validPath(path)) entries.set(path, file);
    }
  }
  return storeSceneEntries(entries, name);
}
export async function storeSceneEntries(
  entries: Map<string, Blob>,
  name: string,
): Promise<SceneRef> {
  const manifests = [...entries.keys()].filter((p) =>
    /(^|\/)game-manifest\.json$/.test(p),
  );
  if (manifests.length > 1) throw Error("Select one SceneMax scene at a time.");
  const assets = new Map<string, Blob>();
  let manifest: Manifest;
  if (manifests.length) {
    const path = manifests[0],
      prefix = path.slice(0, -"game-manifest.json".length);
    manifest = JSON.parse(await entries.get(path)!.text());
    if (
      !Array.isArray(manifest.files) ||
      !manifest.files.length ||
      !manifest.files.every((p) => validPath(p) && p.startsWith("game/"))
    )
      throw Error("Invalid scene file list.");
    const paths = new Set(manifest.files);
    if (paths.size !== manifest.files.length)
      throw Error("Duplicate scene path.");
    const aliases = manifest.aliases ?? {};
    for (const [p, src] of Object.entries(aliases))
      if (!paths.has(p) || !paths.has(src) || Object.hasOwn(aliases, src))
        throw Error("Invalid scene asset alias.");
    for (const p of paths) {
      if (Object.hasOwn(aliases, p)) continue;
      const blob = entries.get(prefix + p);
      if (!blob) throw Error("Missing scene file: " + p);
      assets.set(p, blob);
    }
  } else {
    const mains = [...entries.keys()].filter((p) =>
      /(^|\/)scripts\/main(?:\.smx)?$/i.test(p),
    );
    if (mains.length !== 1)
      throw Error(
        "Choose a SceneMax web export or a project with scripts/main.smx.",
      );
    const entry = mains[0],
      prefix = entry.slice(0, entry.lastIndexOf("scripts/"));
    for (const [path, blob] of entries)
      if (path.startsWith(prefix)) {
        const rel = path.slice(prefix.length);
        if (!rel.split("/").some((part) => part.startsWith(".")))
          assets.set("game/" + rel, blob);
      }
    manifest = {
      entry: "game/" + entry.slice(prefix.length),
      files: [...assets.keys()],
      effects: [...assets.keys()].some((p) => /\.efk(efc|proj)$/i.test(p)),
    };
  }
  if (
    !validPath(manifest.entry) ||
    !manifest.entry.startsWith("game/scripts/") ||
    !manifest.files.includes(manifest.entry)
  )
    throw Error("Missing scene entry script.");
  // A stable reference lets an exported rehearsal reconnect after reimport on another PC.
  const fingerprints = [];
  for (const path of [...assets.keys()].sort()) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await assets.get(path)!.arrayBuffer(),
    );
    fingerprints.push([path, Array.from(new Uint8Array(digest)).join(".")]);
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        manifest.entry,
        Object.entries(manifest.aliases ?? {}).sort(),
        !!manifest.effects,
        !!manifest.effect_distortion,
        fingerprints,
      ]),
    ),
  );
  const id = Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  const db = await openLibrary();
  try {
    await new Promise<void>((ok, fail) => {
      const tx = db.transaction("packages", "readwrite");
      tx.objectStore("packages").put({ manifest, assets }, id);
      tx.oncomplete = () => ok();
      tx.onabort = () => fail(tx.error);
    });
  } finally {
    db.close();
  }
  return { id, name: name || "SceneMax scene" };
}
