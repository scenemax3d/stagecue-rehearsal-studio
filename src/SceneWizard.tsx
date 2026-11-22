import { useEffect, useRef, useState } from "react";
import { tr } from "./language";
import formatReference from "./create-scene-prompt.txt?raw";

const defaults = {
  source: "", title: "", language: "", roles: "", voices: "",
  images: "none", art: "", media: "", install: false, destination: "",
};
type Choices = typeof defaults;
const imageOptions = {
  none: "No images",
  supplied: "Use supplied images",
  generate: "Generate fitting images",
  both: "Use supplied images and generate missing ones",
};

function createPrompt(c: Choices) {
  const illustrateScene = "Read the whole scene and identify each visually distinct beat, including entrances, actions, reveals, changes of setting and shifts in a character’s expression. Create as many distinct images as the scene supports, covering every such beat from beginning to end, even when several occur in the same setting. Continue beyond two or three illustrations whenever more beats remain. Keep characters, costumes and locations visually consistent.";
  const imageTasks: Record<string, string> = {
    none: "Create a rehearsal without image cues.",
    supplied: "Use relevant pictures from the document or attached files as Show image cues.",
    generate: "Generate original illustrations for the scene. " + illustrateScene,
    both: "Use supplied illustrations for the beats they depict and generate an original image for every remaining beat. " + illustrateScene,
  };
  return [
    "Create a new scene for Stagecue Rehearsal Studio. Deliver a complete, ready-to-use .srs file for offline rehearsal.",
    [
      "Script source: " + (c.source.trim() || "the Word document or PDF attached to this conversation"),
      "Scene title: " + (c.title.trim() || "use the document title"),
      "Dialogue language: " + (c.language.trim() || "infer from the document"),
      "Practice roles: " + (c.roles.trim() || "create a practice script for each lead role"),
      "Partner voices: " + (c.voices.trim() || "choose voices appropriate for the characters"),
    ].join("\n"),
    "Create one script per practice role. The student plays that role and Stagecue speaks the partner lines. Preserve the original dialogue, language, speaker order and stage directions. Keep each uninterrupted turn together even when it spans several sentences. Show stage directions to the actor and exclude them from speech matching and spoken audio. Check right-to-left reading order for Hebrew, including page breaks. For scanned pages, verify OCR against the image. Flag ambiguous wording or speakers.",
    'For each Hebrew virtual_line, default to a text-only action such as {"type":"text_to_speech","voice":"omer","text":"שלום איריס"}. Use "noa" or "omer"; optional speed is 0.75–1.5 and pitch is −6 to +6 semitones. Omit assetId entirely for these actions. Stagecue synthesizes the text offline on the student’s computer. A remote agent can build the complete archive without the voice models or access to Studio. Do not generate or package partner WAVs, silent placeholders, or corresponding audio asset entries. Use play_audio only for explicitly requested recordings or sound effects. For other dialogue languages use suitable supplied or generated audio; the bundled voices speak Hebrew.',
    [imageTasks[c.images], c.images !== "none" && "Embed each illustration and show it on the relevant dramatic beat in every practice role. When an image accompanies a partner line, put show_image and text_to_speech (or play_audio) on the same cue with actionMode set to \"parallel\". Omit durationMs by default so the image stays until replaced. Do not insert a wait before dialogue. Preserve any explicitly requested sequence of speech or effects; if other actions must remain sequential, use an untimed show_image immediately before the relevant speech.", c.images !== "none" && c.art.trim() && "Art direction: " + c.art.trim()].filter(Boolean).join(" "),
    c.media.trim() ? "Sound, SceneMax and cue instructions: " + c.media.trim() + ". Embed supplied resources. Use Play audio for sounds. For SceneMax, use the bundled server and an event the attached project handles. Time effects to the specified phrase." : "Use ordinary Stagecue cues. No SceneMax project or extra sound effects are needed.",
    formatReference.trim(),
    "Save the finished .srs " + (c.destination.trim() ? "to " + c.destination.trim() : "as a downloadable file or to an accessible local output folder") + ". Keep existing files and rehearsals intact.",
    c.install ? "Also install the completed scene into my local Stagecue desktop app. Use the installed Studio’s Open Scene file command to import the .srs into my workspace. Check the scene appears in Active scene, switch practice roles, and verify it is still available after reopening Studio. Import it once. Copying the archive to a folder alone does not import it. If you cannot operate my local Studio, deliver the .srs and tell me to use Open Scene file." : "Deliver the file only. Leave my local Studio workspace untouched. If you can run Stagecue, validate the export in a separate test workspace.",
    "Check that the archive opens, all relative media paths resolve, and a human cue and partner reply work for each role. Report the file location, voice assignments, unclear passages, and checks actually performed. If local installation was requested, report whether you verified it.",
  ].join("\n\n");
}

export function SceneWizard({ close }: { close: () => void }) {
  const [choices, setChoices] = useState(defaults);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const update = <K extends keyof Choices>(key: K, value: Choices[K]) =>
    setChoices(previous => ({ ...previous, [key]: value }));
  const textField = (key: "source" | "title" | "language" | "roles" | "voices" | "art" | "media" | "destination", label: string, hint?: string) => (
    <label>{tr(label)}<input dir="auto" value={choices[key]} placeholder={hint && tr(hint)}
      onChange={e => update(key, e.target.value)} /></label>
  );
  const prompt = createPrompt(choices);
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("Prompt copied");
    } catch {
      field.current?.focus();
      field.current?.select();
      setStatus("Press Ctrl+C to copy the selected prompt.");
    }
  }
  const titles = ["Script and roles", "Artwork and sound", "Delivery", "Your scene prompt"];
  return (
    <dialog ref={dialog} className="general-settings about-dialog ai-help" aria-labelledby="ai-help-title" onClose={close}>
      <h2 id="ai-help-title">{tr("Create a scene with AI")}</h2>
      <h3 ref={heading} tabIndex={-1}>{step + 1} / {titles.length} · {tr(titles[step])}</h3>
      {step === 0 && <>
        {textField("source", "Word or PDF filename or local path", "Attach the script to your agent")}
        {textField("title", "Scene title", "Use the document title")}
        {textField("language", "Language", "Detect from the script")}
        {textField("roles", "Practice roles", "All lead roles")}
        {textField("voices", "Voice assignments", "Choose automatically")}
      </>}
      {step === 1 && <>
        <label>{tr("Images")}<select value={choices.images} onChange={e => update("images", e.target.value)}>
          {Object.entries(imageOptions).map(([key, label]) => <option key={key} value={key}>{tr(label)}</option>)}
        </select></label>
        {choices.images !== "none" && textField("art", "Art direction and moments to illustrate")}
        {textField("media", "Sounds, SceneMax events or cue timing")}
      </>}
      {step === 2 && <>
        {textField("destination", "Output folder or filename", "Let the agent choose")}
        <label className="wizard-check"><input type="checkbox" checked={choices.install} onChange={e => update("install", e.target.checked)} />{tr("Also import the scene into my local Studio")}</label>
        <p>{tr("A local agent with desktop access can import the file. Other agents can deliver it for you to open in Studio.")}</p>
      </>}
      {step === 3 && <>
        <p>{tr("Paste this prompt into your AI agent and attach your Word or PDF script.")}</p>
        <textarea ref={field} readOnly dir="ltr" lang="en" aria-label={tr("Scene creation prompt")} value={prompt} />
      </>}
      <div className="settings-controls">
        {step > 0 && <button onClick={() => { setStatus(""); setStep(step - 1); }}>{tr("Back")}</button>}
        {step < 3 ? <button className="primary" onClick={() => setStep(step + 1)}>{tr(step === 2 ? "Generate prompt" : "Next")}</button>
          : <button className="primary" onClick={copy}>{tr("Copy prompt")}</button>}
        <button onClick={() => dialog.current?.close()}>{tr(step === 3 ? "Done" : "Cancel")}</button>
      </div>
      <span role="status">{status && tr(status)}</span>
    </dialog>
  );
}
