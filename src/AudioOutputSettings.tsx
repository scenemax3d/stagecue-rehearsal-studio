import { useEffect, useRef, useState } from "react";
import { releaseMedia, routeMedia, selectedOutput, selectOutput } from "./audioOutput";
import { tr } from "./language";

export function AudioOutputSettings() {
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [id, setId] = useState(selectedOutput);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const sample = useRef<HTMLAudioElement>(null);
  const media = navigator.mediaDevices;
  async function refresh() {
    const list = await media.enumerateDevices();
    setOutputs(list.filter(d => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default"));
  }
  useEffect(() => {
    const list = () => { void refresh().catch(() => setStatus("Audio outputs are unavailable.")); };
    list();
    media?.addEventListener("devicechange", list);
    const sound = sample.current!;
    return () => {
      media?.removeEventListener("devicechange", list);
      sound.pause();
      releaseMedia(sound);
    };
  }, []);
  async function choose(value: string) {
    setBusy(true);
    setStatus("");
    try {
      await selectOutput(value);
      setId(value);
    } catch { setStatus("Could not select this output."); }
    finally { setBusy(false); }
  }
  async function reveal() {
    setBusy(true);
    try {
      const stream = await media.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      await refresh();
      setStatus("");
    } catch { setStatus("Allow microphone access to list additional speakers."); }
    finally { setBusy(false); }
  }
  async function test() {
    const sound = sample.current!;
    try {
      await routeMedia(sound);
      sound.currentTime = 0;
      await sound.play();
      setStatus("Playing test sound…");
    } catch { setStatus("Could not play the test sound. Choose another output."); }
  }
  return <section className="audio-output-settings">
    <label>{tr("Audio output")}
      <select value={id} disabled={busy} onChange={e => void choose(e.target.value)}>
        <option value="">{tr("System default")}</option>
        {id && !outputs.some(d => d.deviceId === id) && <option value={id}>{tr("Previously selected output")}</option>}
        {outputs.map((d,i) => <option key={d.deviceId} value={d.deviceId}>{d.label || tr("Audio output") + " " + (i+1)}</option>)}
      </select>
    </label>
    <div className="settings-controls">
      <button disabled={busy} onClick={() => void test()}>{tr("Test sound")}</button>
      {media && !outputs.some(d => d.label) && <button disabled={busy} onClick={() => void reveal()}>{tr("Show available speakers")}</button>}
    </div>
    <audio ref={sample} src="/assets/output-test.wav" preload="auto" onEnded={() => setStatus("Test sound finished.")} />
    <small role="status">{tr(status)}</small>
  </section>;
}
