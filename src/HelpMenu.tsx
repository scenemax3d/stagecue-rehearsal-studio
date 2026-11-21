import { SceneWizard } from "./SceneWizard";
import { useRef, useState } from "react";
import { tr } from "./language";

const credits = [
  ["Interface", "React, React DOM, TypeScript, Lucide, Zod, fflate"],
  ["Browser APIs", "Web Audio, Web Speech, MediaDevices, Gamepad, IndexedDB, WebSockets"],
  ["Scene playback", "SceneMax, Rust, Bevy, WebAssembly, WebGPU, Effekseer, SceneMax Zig multiplayer server"],
  ["Local Hebrew recognition", "Hebrew Zipformer by thewh1teagle, sherpa-onnx, ONNX Runtime"],
  ["Hebrew voices", "Noa (Piper) and Omer (thewh1teagle’s Hebrew adaptation of Kyutai Pocket TTS), Renikud, SentencePiece"],
  ["Audio processing", "Python, NumPy, PyAV, FFmpeg, Python websockets"],
  ["Windows desktop", "C#, .NET Framework, Windows Forms, Microsoft Edge WebView2, Inno Setup"],
  ["Build and testing", "Node.js, npm, Vite, tsx, Playwright"],
  ["Multilingual recognition (full edition)", "OpenAI Whisper, faster-whisper, CTranslate2"],
];

export function HelpMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const about = useRef<HTMLDialogElement>(null);
  const [wizard, setWizard] = useState(false);
  return (
    <>
      <details className="help-menu" ref={menu}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.currentTarget.open = false;
            trigger.current?.focus();
          }
        }}>
        <summary ref={trigger}>{tr("Help")}</summary>
        <div><button type="button" onClick={() => {
          if (menu.current) menu.current.open = false;
          setWizard(true);
        }}>{tr("Create a scene with AI")}</button>
        <button type="button" onClick={() => {
          if (menu.current) menu.current.open = false;
          about.current?.showModal();
        }}>{tr("About")}</button></div>
      </details>
      {wizard && <SceneWizard close={() => {
        setWizard(false);
        trigger.current?.focus();
      }} />}
      <dialog ref={about} className="general-settings about-dialog" aria-labelledby="about-title"
        onClose={() => trigger.current?.focus()}>
        <h2 id="about-title">Stagecue Rehearsal Studio</h2>
        <p>{tr("Written by Adi Barda")}</p>
        <h3>{tr("Technology credits")}</h3>
        <dl>{credits.map(([label, names]) => (
          <div key={label}><dt>{tr(label)}</dt><dd dir="auto">{names}</dd></div>
        ))}</dl>
        <form method="dialog"><button>{tr("Done")}</button></form>
      </dialog>
    </>
  );
}
