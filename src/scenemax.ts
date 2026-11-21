import { localGateway } from "./localhost";
import type { Show } from "./model";
type Room = NonNullable<Show["sceneMax"]>;
const utf8 = new TextEncoder();
function packet(kind: number, client: number, size: number) {
  const bytes = new Uint8Array(8 + size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x504d5853, true);
  bytes[4] = 1;
  bytes[5] = kind;
  view.setUint16(6, client, true);
  return bytes;
}
async function login(room: Room) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    utf8.encode(""),
  );
  const bytes = packet(1, 0, 357);
  bytes.set(new Uint8Array(hash), 8);
  bytes.set(utf8.encode(room.projectGuid), 40);
  new DataView(bytes.buffer).setUint32(105, room.sessionId, true);
  bytes.set(utf8.encode(room.scene), 173);
  bytes.set(utf8.encode("Stagecue"), 301);
  return bytes;
}
// One browser-gateway binary frame per Zig datagram. Only broadcast after room sync.
export async function broadcast(
  room: Room,
  event: string,
  message: string,
  signal: AbortSignal,
) {
  const hello = await login(room);
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(localGateway);
    ws.binaryType = "arraybuffer";
    let client = 0,
      settled = false;
    const close = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (client && ws.readyState === WebSocket.OPEN)
        ws.send(packet(40, client, 0));
      ws.close();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => close(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(
      () => close(Error("SceneMax gateway timed out")),
      3500,
    );
    signal.addEventListener("abort", abort, { once: true });
    ws.onopen = () => ws.send(hello);
    ws.onerror = () =>
      close(
        Error("Cannot reach SceneMax gateway. Check URL and allowed origin."),
      );
    ws.onclose = () =>
      close(Error("SceneMax gateway disconnected before broadcast"));
    ws.onmessage = ({ data }) => {
      if (!(data instanceof ArrayBuffer) || data.byteLength < 8) return;
      const v = new DataView(data);
      if (v.getUint32(0, true) !== 0x504d5853 || v.getUint8(4) !== 1) return;
      const type = v.getUint8(5);
      if (type === 3)
        return close(Error("SceneMax rejected the project or password"));
      if (type === 2 && data.byteLength >= 14) {
        if (v.getUint32(10, true) !== room.sessionId)
          return close(Error("SceneMax joined a different session"));
        client = v.getUint16(8, true);
      }
      if (type === 32 && client) {
        const body = utf8.encode(event + (message ? "\0" + message : ""));
        const bytes = packet(24, client, 2 + body.length);
        bytes.set(body, 10);
        ws.send(bytes);
        close();
      }
    };
  });
}
