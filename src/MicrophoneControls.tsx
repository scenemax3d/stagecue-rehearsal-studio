import { tr, message } from "./language";
import { useEffect, useState } from "react";
import {
  microphoneId,
  selectMicrophone,
  openMicrophone,
  inputThreshold,
} from "./microphone";

export function MicrophoneControls({
  locked,
  activeName,
  threshold,
}: {
  locked: boolean;
  activeName: string;
  threshold: number;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [id, setId] = useState(microphoneId);
  const [quiet, setQuiet] = useState(
    () => localStorage.getItem("stagecue.quietMic") === "1",
  );
  const [testing, test] = useState(false);
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState(0);
  const [refresh, update] = useState(0);
  useEffect(() => {
    let live = true;
    async function list() {
      try {
        const found = await navigator.mediaDevices.enumerateDevices();
        if (live)
          setDevices(
            found.filter(
              (d) =>
                d.kind === "audioinput" &&
                d.deviceId &&
                d.deviceId !== "default",
            ),
          );
      } catch {
        if (live) setStatus(tr("The microphone list is unavailable."));
      }
    }
    void list();
    navigator.mediaDevices?.addEventListener("devicechange", list);
    return () => {
      live = false;
      navigator.mediaDevices?.removeEventListener("devicechange", list);
    };
  }, [refresh, activeName]);
  useEffect(() => {
    if (locked) {
      test(false);
      setStatus("");
      return;
    }
    if (!testing) return;
    let closed = false,
      ctx: AudioContext | undefined,
      stream: MediaStream | undefined;
    let frame = 0,
      timeout = 0;
    function release() {
      stream?.getTracks().forEach((t) => t.stop());
      if (ctx && ctx.state !== "closed") void ctx.close();
    }
    async function check() {
      try {
        setStatus(tr("Opening microphone…"));
        setLevel(0);
        stream = await openMicrophone();
        if (closed) {
          release();
          return;
        }
        update((n) => n + 1);
        const track = stream.getAudioTracks()[0];
        ctx = new AudioContext({ sampleRate: 16000 });
        await ctx.resume();
        if (closed) return;
        const node = ctx.createAnalyser();
        node.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(node);
        const data = new Float32Array(node.fftSize);
        let peak = 0,
          last = 0;
        setStatus(tr("Speak into") + " " + track.label + ".");
        function meter(time: number) {
          if (time - last >= 80) {
            last = time;
            node.getFloatTimeDomainData(data);
            const rms = Math.sqrt(
              data.reduce((sum, n) => sum + n * n, 0) / data.length,
            );
            peak = Math.max(peak, rms);
            setLevel(rms);
          }
          frame = requestAnimationFrame(meter);
        }
        frame = requestAnimationFrame(meter);
        timeout = window.setTimeout(() => {
          setStatus(
            track.label +
              " · " +
              (peak >= inputThreshold(threshold)
                ? tr("Signal reaches the speech threshold.")
                : peak > 0.0001
                  ? tr(
                      "Signal is low. Try Quiet input or raise the Windows input volume.",
                    )
                  : tr("No signal. Check mute or select another microphone.")),
          );
          test(false);
        }, 5000);
      } catch (err) {
        if (!closed) {
          setStatus(String(err));
          test(false);
        }
      }
    }
    void check();
    return () => {
      closed = true;
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      release();
    };
  }, [testing, locked, threshold, id]);
  return (
    <div className="mic-controls">
      <label>
        {tr("Microphone")}{" "}
        <select
          value={id}
          disabled={locked}
          onChange={(e) => {
            selectMicrophone(e.target.value);
            setId(e.target.value);
            test(false);
            setStatus("");
          }}
        >
          <option value="">{tr("System default")}</option>
          {id && !devices.some((d) => d.deviceId === id) && (
            <option value={id}>{tr("Saved microphone")}</option>
          )}
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || tr("Microphone") + " " + (i + 1)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          disabled={locked || testing}
          checked={quiet}
          onChange={(e) => {
            setQuiet(e.target.checked);
            localStorage.setItem(
              "stagecue.quietMic",
              e.target.checked ? "1" : "0",
            );
          }}
        />{" "}
        {tr("Quiet input")}{" "}
      </label>
      <button
        type="button"
        disabled={locked}
        onClick={() => {
          if (testing) setStatus("");
          test(!testing);
        }}
      >
        {testing ? tr("Stop check") : tr("Check microphone")}
      </button>
      {testing && (
        <meter
          aria-label={tr("Test input level")}
          min={0}
          max={1}
          value={Math.min(
            1,
            level / Math.max(0.001, inputThreshold(threshold) * 3),
          )}
        />
      )}
      {(activeName || status) && (
        <small role="status">
          {activeName ? tr("Listening on") + " " + activeName : message(status)}
        </small>
      )}
    </div>
  );
}
