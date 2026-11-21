import {tr} from "./language";
export type ButtonBinding =
  | { kind: "gamepad"; device: string; button: number }
  | { kind: "key"; code: string };

const storageKey = "stagecue.manualFireButton";

export function loadBinding(): ButtonBinding | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (value?.kind === "key" && typeof value.code === "string" && value.code)
      return value;
    if (
      value?.kind === "gamepad" &&
      typeof value.device === "string" &&
      Number.isInteger(value.button) &&
      value.button >= 0
    )
      return value;
  } catch {}
  return null;
}

export function saveBinding(value: ButtonBinding | null) {
  if (value) localStorage.setItem(storageKey, JSON.stringify(value));
  else localStorage.removeItem(storageKey);
}

export function describe(value: ButtonBinding | null) {
  if (!value) return tr("No button assigned");
  return value.kind === "gamepad"
    ? value.device + " · "+tr("Button")+" " + (value.button + 1)
    : tr("Keyboard input")+" · " + value.code;
}

// Browsers expose paired controllers by polling. Seed each connection with its
// current state so a held button cannot fire when resuming or reconnecting.
export function watchGamepads(
  onPress: (binding: ButtonBinding) => void,
  onDevices?: (names: string[]) => void,
) {
  let previous = new Map<string, boolean[]>(),
    lastNames = "",
    frame = 0;
  function poll() {
    const current = new Map<string, boolean[]>();
    const names: string[] = [];
    if (document.visibilityState === "visible" && document.hasFocus()) {
      try {
        for (const pad of navigator.getGamepads?.() ?? []) {
          if (!pad?.connected) continue;
          names.push(pad.id);
          const key = JSON.stringify([pad.index, pad.id]);
          const buttons = pad.buttons.map((b) => b.pressed);
          const old = previous.get(key);
          current.set(key, buttons);
          buttons.forEach((down, button) => {
            if (down && old?.[button] === false)
              onPress({ kind: "gamepad", device: pad.id, button });
          });
        }
      } catch {
        /* Gamepad access can be unavailable in an embedded browser. */
      }
    }
    const list = JSON.stringify(names);
    if (list !== lastNames) {
      lastNames = list;
      onDevices?.(names);
    }
    previous = current;
    frame = requestAnimationFrame(poll);
  }
  function reset() {
    previous.clear();
  }
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", reset);
  poll();
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("blur", reset);
    document.removeEventListener("visibilitychange", reset);
  };
}
