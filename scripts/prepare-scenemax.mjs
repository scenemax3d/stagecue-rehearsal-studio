import {
  cp,
  readdir,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  access,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const nextgen = path.join(
  process.env.SCENEMAX_DESKTOP || "C:/dev/scenemax_desktop",
  "scenemax3d_nextgen",
);
const out = path.join(root, "public/scenemax");
const templates = path.join(nextgen, "IDE/services/src/deployment/web");
const candidates = [
  process.env.SCENEMAX_WEB_RUNTIME,
  path.join(nextgen, "prebuilt/web"),
].filter(Boolean);
const installers = path.join(nextgen, "target/studio-installer");
for (const id of await readdir(installers).catch(() => []))
  candidates.push(
    path.join(installers, id, "payload/scenemax3d_nextgen/prebuilt/web"),
  );
const runtimes = [];
for (const dir of candidates) {
  try {
    await access(path.join(dir, "runtime_bg.wasm"));
    const info = await stat(path.join(dir, "runtime.js"));
    runtimes.push({ dir, time: info.mtimeMs });
  } catch {}
}
const runtime =
  runtimes.find((x) =>
    candidates
      .slice(0, process.env.SCENEMAX_WEB_RUNTIME ? 2 : 1)
      .includes(x.dir),
  ) || runtimes.sort((a, b) => b.time - a.time)[0];
if (!runtime)
  throw Error(
    "Set SCENEMAX_WEB_RUNTIME to a built SceneMax web runtime directory.",
  );
await mkdir(out, { recursive: true });
for (const name of ["runtime.js", "runtime_bg.wasm"])
  await copyFile(path.join(runtime.dir, name), path.join(out, name));
await cp(path.join(runtime.dir, "snippets"), path.join(out, "snippets"), {
  recursive: true,
});
for (const name of ["files.mjs", "game.js"])
  await copyFile(path.join(templates, name), path.join(out, name));
const files = [];
for (const dir of ["scripts", "resources/sprites"]) {
  const src = path.join(root, "examples/elevator", dir);
  await mkdir(path.join(out, "game", dir), { recursive: true });
  for (const name of await readdir(src)) {
    const rel = "game/" + dir + "/" + name;
    await copyFile(path.join(src, name), path.join(out, rel));
    files.push(rel);
  }
}
const entry = "game/scripts/main.smx";
const script = await readFile(path.join(out, entry), "utf8");
await writeFile(
  path.join(out, entry),
  [
    "//$[multiplayer_server]=127.0.0.1;",
    "//$[multiplayer_port]=21971;",
    "//$[project_guid]=stagecue-elevator;",
    script,
    'network.broadcast ("studio_player_ready")',
  ].join("\n"),
);
await writeFile(
  path.join(out, "game-manifest.json"),
  JSON.stringify({ entry, files, multiplayer: true }),
);
await writeFile(
  path.join(out, "network.json"),
  JSON.stringify({
    websocket_url: "ws://127.0.0.1:21972",
    allowed_origin: "http://127.0.0.1:5173",
  }),
);
await copyFile(
  path.join(root, "scripts/scenemax-player.html"),
  path.join(out, "index.html"),
);

await copyFile(path.join(root,"scripts/external-player.mjs"),path.join(out,"external-player.mjs"));
await cp(path.join(nextgen,"Engine/effects/web"),path.join(out,"effects"),{recursive:true,filter:p=>!p.endsWith(".test.mjs")});
