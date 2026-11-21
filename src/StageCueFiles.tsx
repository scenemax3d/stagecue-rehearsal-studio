import { tr } from "./language";
import { message } from "./language";
import { useState, useRef } from "react";
import { importSrs, exportSrs } from "./srs";
import type { Show } from "./model";
export function StageCueFiles({
  draft,
  opened,
  disabled = false,
}: {
  draft?: Show;
  opened: (s: Show) => void;
  disabled?: boolean;
}) {
  const file = useRef<HTMLInputElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stagecue-files">
      <button disabled={busy} onClick={() => file.current?.click()}>
        {tr("Open Scene file")}
      </button>
      <input
        ref={file}
        type="file"
        hidden
        accept=".srs"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          e.target.value = "";
          if (selected) void run(async () => opened(await importSrs(selected)));
        }}
      />
      {draft && (
        <button
          disabled={busy || disabled}
          onClick={() => void run(() => exportSrs(draft))}
        >
          {tr("Export Scene File")}
        </button>
      )}
      {busy && <small role="status">{tr("Preparing package…")}</small>}
      {error && <small role="alert">{message(error)}</small>}
    </div>
  );
}
