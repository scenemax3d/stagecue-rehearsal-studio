import init, {
  mount_file,
  mount_alias,
  read_file,
  start_game,
} from "./runtime.js";
const status = document.getElementById("status");
const receive = new Promise((resolve, reject) => {
  function accept(ev) {
    if (
      ev.source !== parent ||
      ev.origin !== location.origin ||
      ev.data?.type !== "stagecue-scene"
    )
      return;
    removeEventListener("message", accept);
    ev.data.error ? reject(Error(ev.data.error)) : resolve(ev.data);
  }
  addEventListener("message", accept);
  parent.postMessage(
    { type: "stagecue-player", status: "request-scene" },
    location.origin,
  );
});
const {
  bundle: { manifest, assets },
  room,
  password,
} = await receive;
if (!navigator.gpu || !(await navigator.gpu.requestAdapter()))
  throw Error("SceneMax requires a WebGPU-capable graphics adapter.");
await init();
if (manifest.effects) {
  const effects = await import("./effects/bridge.js");
  effects.install(
    new URL("./", import.meta.url),
    manifest.files,
    !!manifest.effect_distortion,
    read_file,
  );
  effects.unlockAudio();
}
const entry = manifest.entry,
  config = "game/.scenemax-studio/multiplayer.json";
const source = await assets.get(manifest.aliases?.[entry] || entry).text();
const metadata = {
  multiplayer_server: "127.0.0.1",
  multiplayer_port: location.port === "21870" ? 21873 : 21971,
  multiplayer_create_session: "false",
  project_guid: room.projectGuid,
  multiplayer_session_id: room.sessionId,
  multiplayer_scene: room.scene,
  multiplayer_password: password,
};
const header = Object.entries(metadata)
  .map(([k, v]) => {
    if (/[\r\n\0]/.test(String(v)))
      throw Error("Invalid multiline SceneMax room setting");
    return "//$[" + k + "]=" + v + ";";
  })
  .join("\n");
const ready =
  'do async\n wait for network.ready == 1\n network.broadcast ("studio_player_ready")\nend do\n';
let count = 0;
for (const [path, blob] of assets) {
  if (path !== entry && path !== config)
    mount_file(path, new Uint8Array(await blob.arrayBuffer()));
  status.textContent = "Loading scene files · " + ++count + " / " + assets.size;
}
const enc = new TextEncoder();
mount_file(config, enc.encode('{"enabled":true}'));
mount_file(
  entry,
  enc.encode(
    header +
      "\n" +
      ready +
      source
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter((line) => {
          const key = line.trim().match(/^\/\/\$\[([^\]]+)\]=/);
          return !key || !Object.hasOwn(metadata, key[1]);
        })
        .join("\n"),
  ),
);
for (const [alias, path] of Object.entries(manifest.aliases ?? {}))
  if (alias !== entry && alias !== config) mount_alias(alias, path);
document.getElementById("loading").hidden = true;
start_game(entry, room.gateway);
