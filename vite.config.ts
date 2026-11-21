import { defineConfig } from "vite";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export default defineConfig({
  server: {
    proxy: {
      "/api/speech": { target: "http://127.0.0.1:21874", changeOrigin: true },
    },
  },
  plugins: [
    {
      name: "local-speech",
      configureServer(server) {
        const root = fileURLToPath(new URL(".", import.meta.url));
        const packagedPython = path.join(root, "packaging/payload/python/python.exe");
        const python = existsSync(packagedPython) ? packagedPython : path.join(root, ".venv/Scripts/python.exe");
        const worker = spawn(
          python,
          ["installer/serve.py", "--tts-dev"],
          { cwd: root, stdio: "inherit", windowsHide: true },
        );
        worker.on("error", (error) =>
          server.config.logger.error("Local speech: " + error.message),
        );
        server.httpServer?.once("close", () => worker.kill());
        process.once("exit", () => worker.kill());
      },
    },
  ],
});
