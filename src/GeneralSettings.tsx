import { tr } from "./language";
import { languages, type Language } from "./language";
import { useEffect, useRef, useState } from "react";
import { describe, watchGamepads, type ButtonBinding } from "./joystick";

import { AudioOutputSettings } from "./AudioOutputSettings";

export function GeneralSettings({
  locale,
  changeLanguage,
  binding,
  change,
  close,
}: {
  locale: Language;
  changeLanguage: (value: Language) => void;
  binding: ButtonBinding | null;
  change: (b: ButtonBinding | null) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [capture, setCapture] = useState(false);
  const [devices, setDevices] = useState<string[]>([]);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let accepted = false;
    function assign(next: ButtonBinding) {
      if (!capture || accepted) return;
      accepted = true;
      change(next);
      setCapture(false);
    }
    function key(ev: KeyboardEvent) {
      if (
        !capture ||
        ev.repeat ||
        !ev.code ||
        ["Escape", "Tab"].includes(ev.code) ||
        ev.altKey ||
        ev.ctrlKey ||
        ev.metaKey
      )
        return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      assign({ kind: "key", code: ev.code });
    }
    window.addEventListener("keydown", key, true);
    const stop = watchGamepads(assign, setDevices);
    return () => {
      stop();
      window.removeEventListener("keydown", key, true);
    };
  }, [capture, change]);
  return (
    <dialog
      className="general-settings"
      ref={dialog}
      onCancel={close}
      aria-labelledby="settings-title"
    >
      <h2 id="settings-title">{tr("General settings")}</h2>
      <label>
        {tr("System language")}{" "}
        <select
          value={locale}
          onChange={(e) => changeLanguage(e.target.value as Language)}
        >
          {Object.entries(languages).map(([code, name]) => (
            <option key={code} value={code} lang={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <AudioOutputSettings />
      <h3>{tr("Simulator cue button")}</h3>
      <p>
        {tr(
          "Assign a button on your paired joystick to fire the current cue. Remotes that send keyboard presses also work.",
        )}{" "}
      </p>
      <p aria-live="polite">
        <strong>{describe(binding)}</strong>
      </p>
      <p>
        {devices.length
          ? devices.join(", ")
          : tr(
              "If your controller is asleep, press and release a button to wake it.",
            )}
      </p>
      <p role="status">
        {capture
          ? tr(
              "Press and release the button you want to use. If this is its first press, press it again.",
            )
          : ""}
      </p>
      <div className="settings-controls">
        <button onClick={() => setCapture(!capture)}>
          {capture ? tr("Cancel assignment") : tr("Assign button")}
        </button>
        {binding && (
          <button
            onClick={() => {
              change(null);
              setCapture(false);
            }}
          >
            {tr("Clear assignment")}{" "}
          </button>
        )}
        <button onClick={close}>{tr("Done")}</button>
      </div>
    </dialog>
  );
}
