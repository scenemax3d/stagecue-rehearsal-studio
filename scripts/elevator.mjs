import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import net from "node:net";
import dgram from "node:dgram";

const scene = fileURLToPath(new URL("../examples/elevator/", import.meta.url));
const desktop = process.env.SCENEMAX_DESKTOP || "C:/dev/scenemax_desktop";
const bin = path.join(desktop, "scenemax3d_nextgen/target/release");
const server = path.join(
  desktop,
  "tools/multiplayer-server/bin/windows-x64/scenemax-mp-server.exe",
);
const gateway = path.join(bin, "scenemax_web_gateway.exe"),
  projector = path.join(bin, "scenemax_projector_nextgen.exe");
const relayOnly = process.argv.includes("--relay-only");
for (const exe of relayOnly ? [server, gateway] : [server, gateway, projector])
  if (!existsSync(exe)) throw Error("Missing SceneMax executable: " + exe);
const udp = 21971,
  tcp = 21972,
  host = "127.0.0.1",
  children = [];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const c of children) c.kill();
  if (process.connected) process.disconnect();
  process.exitCode = code;
}
process.on("disconnect", () => stop());
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
function launch(exe, args, env, visible = false) {
  const c = spawn(exe, args, {
    cwd: scene,
    env,
    windowsHide: !visible,
    stdio: "inherit",
  });
  children.push(c);
  c.on("error", (e) => {
    console.error(e.message);
    stop(1);
  });
  c.on("exit", (code) => stop(code ?? 0));
  return c;
}
async function ensureFree(socket, listen) {
  await new Promise((ok, no) => {
    socket.once("error", no);
    listen(() => socket.close(ok));
  });
}
try {
  const u = dgram.createSocket("udp4"),
    t = net.createServer();
  await ensureFree(u, (cb) => u.bind(udp, host, cb));
  await ensureFree(t, (cb) => t.listen(tcp, host, cb));
  mkdirSync(path.join(scene, "resources"), { recursive: true });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith("SCENEMAX_MULTIPLAYER_"),
    ),
  );
  launch(server, [], {
    ...env,
    SCENEMAX_MP_BIND_ADDRESS: host,
    SCENEMAX_MP_PORT: String(udp),
  });
  launch(
    gateway,
    [host + ":" + tcp, host + ":" + udp, "http://127.0.0.1:5173"],
    env,
  );
  await wait(500);
  if (!closing && !relayOnly)
    launch(
      projector,
      [
        "--runtime-log",
        "run",
        "--project-root",
        scene,
        "--script",
        path.join(scene, "scripts/main.smx"),
        "--width",
        "900",
        "--height",
        "600",
      ],
      {
        ...env,
        SCENEMAX_MULTIPLAYER_SERVER: host,
        SCENEMAX_MULTIPLAYER_PORT: String(udp),
        SCENEMAX_MULTIPLAYER_PROJECT_GUID: "stagecue-elevator",
        SCENEMAX_MULTIPLAYER_SESSION_ID: "1000",
        SCENEMAX_MULTIPLAYER_SCENE: "main",
      },
      true,
    );
} catch (e) {
  console.error(e.message);
  stop(1);
}
