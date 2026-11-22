import { useEffect, useRef, useState } from "react";
import { tr } from "./language";
import { deleteLocalScene, setSceneRemoved } from "./storage";

type Scene = { id: string; title: string };
export function SceneRemoval({ scene, removed, close, changed }: {
  scene: Scene; removed: boolean; close: () => void; changed: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function apply() {
    setBusy(true);
    try {
      if (confirm) await deleteLocalScene(scene.id);
      else await setSceneRemoved(scene.id, !removed);
      changed();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }
  return <dialog ref={dialog} className="scene-removal" aria-labelledby="manage-title"
    onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <h2 id="manage-title" dir="auto">{scene.title}</h2>
    <p>{tr(confirm
      ? "Permanently delete this scene’s scripts and local media? Shared resources and exported .srs files are kept."
      : "Removed scenes stay on this computer and can be restored to the library.")}</p>
    {error && <p role="alert">{error}</p>}
    <div>
      <button autoFocus disabled={busy} onClick={close}>{tr("Cancel")}</button>
      {!confirm && <button onClick={() => void apply()} disabled={busy}>
        {tr(removed ? "Restore to library" : "Remove from library")}
      </button>}
      <button className="danger" disabled={busy} onClick={() => confirm ? void apply() : setConfirm(true)}>
        {tr(confirm ? "Delete permanently" : "Delete from this computer…")}
      </button>
    </div>
  </dialog>;
}
