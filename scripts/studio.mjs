import { fork, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const python = path.join(
  root,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
if (!existsSync(python)) {
  console.error(
    "Install the local speech service dependencies using the README first.",
  );
  process.exit(1);
}
const children = [];
let relay;
try {
  await import("./prepare-scenemax.mjs");
  relay = fork(path.join(root, "scripts/elevator.mjs"), ["--relay-only"], {
    cwd: root,
  });
  relay.on("error", (err) => console.error("SceneMax relay:", err.message));
} catch (err) {
  console.error("SceneMax web player unavailable:", err.message);
}
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  if (relay?.connected) relay.disconnect();
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const [exe, args] of [
  [python, ["-u", "service/asr.py"]],
  [
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
  ],
]) {
  const child = spawn(exe, args, { cwd: root, stdio: "inherit" });
  children.push(child);
  child.on("error", (err) => {
    console.error(err.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 1));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
