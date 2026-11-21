import { tr } from "./language";
import { StageCueFiles } from "./StageCueFiles";
import { importScene } from "./sceneLibrary";
import { localGateway } from "./localhost";
import { roomPassword, setRoomPassword } from "./scenemax";
import { useState, useRef, useEffect } from "react";
import {
  Plus,
  Save,
  Copy,
  Upload,
  Trash2,
  ChevronUp,
  ChevronDown,
  Play,
  Square,
} from "lucide-react";
import { schema, type Show, type Turn } from "./model";
import {
  sceneOf,
  sceneScripts,
  scriptsWithDraft,
  saveScripts,
  save,
  putMedia,
  mediaUrl,
} from "./storage";
import { Playback } from "./playback";
const mediaTypes = {
  play_audio: "audio",
  show_image: "image",
  play_video: "video",
} as const;
type MediaAction = Extract<
  Turn["actions"][number],
  { type: keyof typeof mediaTypes }
>;
type ActionChoice =
  keyof typeof mediaTypes | "text_to_speech" | "wait" | "youtube" | "scenemax";

const fresh = (): Turn => ({
  id: "cue-" + crypto.randomUUID().slice(0, 8),
  actor: "השחקן",
  kind: "human_line",
  expectedText: "שורה חדשה",
  alternatives: [],
  trigger: { mode: "composite", requireCurrentLine: true },
  actions: [],
  nextStateId: null,
});
const stitch = (states: Turn[]) =>
  states.map((t, i) => ({ ...t, nextStateId: states[i + 1]?.id ?? null }));
function AlternativePhrasings({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [rows, setRows] = useState(() =>
    values.map((text, id) => ({ id, text })),
  );
  const nextId = useRef(rows.length);
  const focusRow = useRef<number | null>(null);
  function update(next: typeof rows) {
    setRows(next);
    onChange(next.map((row) => row.text.trim()).filter(Boolean));
  }
  return (
    <fieldset className="alternatives">
      <legend>{tr("Alternative phrasings")}</legend>
      {rows.map((row, i) => (
        <div className="phrasing-row" key={row.id}>
          <input
            type="text"
            dir="auto"
            aria-label={tr("Alternative phrasing") + " " + (i + 1)}
            value={row.text}
            ref={(el) => {
              if (el && focusRow.current === row.id) {
                el.focus();
                focusRow.current = null;
              }
            }}
            onChange={(e) =>
              update(
                rows.map((r) =>
                  r.id === row.id ? { ...r, text: e.target.value } : r,
                ),
              )
            }
          />
          <button
            type="button"
            aria-label={tr("Remove phrasing") + " " + (i + 1)}
            title={tr("Remove phrasing")}
            onClick={() => update(rows.filter((r) => r.id !== row.id))}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const id = nextId.current++;
          focusRow.current = id;
          setRows([...rows, { id, text: "" }]);
        }}
      >
        <Plus aria-hidden="true" />
        {tr("Add phrasing")}
      </button>
    </fieldset>
  );
}
function JsonField({
  onValid,
  value,
  apply,
  label,
}: {
  value: unknown;
  apply: (x: unknown) => void;
  onValid: (ok: boolean) => void;
  label: string;
}) {
  const original = JSON.stringify(value, null, 2),
    [text, set] = useState(original),
    [error, err] = useState("");
  useEffect(() => {
    set(original);
    err("");
    onValid(true);
  }, [original, onValid]);
  return (
    <label>
      {label}
      <textarea
        className="code"
        value={text}
        onChange={(e) => {
          set(e.target.value);
          try {
            const v = JSON.parse(e.target.value);
            apply(v);
            onValid(true);
            err("");
          } catch (ex) {
            onValid(false);
            err(String(ex));
          }
        }}
      />
      {error && <span className="bad">{error}</span>}
    </label>
  );
}
export function Editor({
  show,
  saved,
}: {
  show: Show;
  saved: (s: Show) => void;
}) {
  const [d, set] = useState<Show>(() => ({
      ...structuredClone(show),
      collection: sceneOf(show),
    })),
    [idx, index] = useState(0),
    [msg, note] = useState(""),
    [preview, setPreview] = useState(""),
    [previewType, setPreviewType] = useState(""),
    [missing, setMissing] = useState<string[]>([]),
    [testing, test] = useState(false),
    [actionsValid, setActionsValid] = useState(true),
    [settingsValid, setSettingsValid] = useState(true);
  const scriptLine = useRef<HTMLTextAreaElement>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [importingScene, setImportingScene] = useState(false);
  async function attachScene(files: File[]) {
    if (!files.length) return;
    setImportingScene(true);
    try {
      const scenePackage = await importScene(files);
      set((old) => ({
        ...old,
        scenePackage,
        sceneMax: {
          gateway: localGateway,
          sessionId: 1000,
          scene: "main",
          ...old.sceneMax,
          projectGuid:
            old.sceneMax?.projectGuid ||
            "stagecue-" + scenePackage.id.slice(0, 24),
        },
      }));
      note(tr("Scene attached. Save the script to use it in rehearsal."));
    } catch (error) {
      note(String(error));
    } finally {
      setImportingScene(false);
    }
  }
  const media = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController>(null),
    player = useRef<Playback>(null),
    visual = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      player.current?.dispose();
    },
    [],
  );
  useEffect(
    () => () => {
      if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    let active = true;
    async function check() {
      const errors = await Promise.all(
        d.assets.map(async (a) => {
          try {
            const url = await mediaUrl(d, a);
            if (url.startsWith("blob:")) {
              URL.revokeObjectURL(url);
              return "";
            }
            const res = await fetch(url, { method: "HEAD" });
            return res.ok &&
              res.headers.get("content-type")?.startsWith(a.type + "/")
              ? ""
              : a.uri;
          } catch {
            return a.uri;
          }
        }),
      );
      if (active) setMissing(errors.filter(Boolean));
    }
    void check();
    return () => {
      active = false;
    };
  }, [d.assets, d.showId]);
  const t = d.states[idx],
    result = schema.safeParse(d);
  const patch = (s: Partial<Show>) => {
    set({ ...d, ...s });
    note(tr("Unsaved changes"));
  };
  const turn = (p: Partial<Turn>) =>
    patch({ states: d.states.map((a, i) => (i === idx ? { ...a, ...p } : a)) });
  function sequence(a: Turn[], pos: number) {
    patch({ states: stitch(a), startStateId: a[0].id });
    index(pos);
  }
  const persist = (s: Show) => {
    try {
      save(s);
      saved(s);
      note(tr("Saved locally"));
    } catch (e) {
      note(String(e));
    }
  };
  async function duplicate() {
    try {
      const s = {
        ...schema.parse(d),
        showId: crypto.randomUUID(),
        title: d.title + " (copy)",
      };
      for (const a of d.assets) {
        const u = await mediaUrl(d, a);
        if (u.startsWith("blob:")) {
          try {
            await putMedia(
              s.showId + "/" + a.uri,
              new File([await (await fetch(u)).blob()], a.uri),
            );
          } finally {
            URL.revokeObjectURL(u);
          }
        }
      }
      const collection = sceneOf(d);
      saveScripts([
        ...scriptsWithDraft({ ...d, collection }),
        { ...s, collection },
      ]);
      saved({ ...s, collection });
    } catch (e) {
      note(String(e));
    }
  }
  async function testCue() {
    player.current?.dispose();
    visual.current?.replaceChildren();
    const ctrl = (controller.current = new AbortController());
    let feedback = "";
    const p = (player.current = new Playback(
      d,
      () => {
        if (visual.current) {
          if (p.stage && visual.current.firstChild !== p.stage)
            visual.current.replaceChildren(p.stage);
          else if (!p.stage) visual.current.replaceChildren();
        }
      },
      (message) => {
        feedback = message;
        note(message);
      },
    ));
    try {
      test(true);
      await p.preload();
      await p.run(t.actions, ctrl.signal, () => {}, t.actionMode);
      await p.settleNetwork();
      if (!ctrl.signal.aborted) note(feedback || tr("Cue test complete"));
    } catch (e) {
      if (!ctrl.signal.aborted) note(String(e));
    } finally {
      if (ctrl.signal.aborted || !p.stage) p.dispose();
      test(false);
    }
  }
  const [actionType, setActionType] = useState<ActionChoice>("wait");
  const scripts = sceneScripts(show);
  const invalid =
    importingScene ||
    uploadingMedia ||
    !result.success ||
    !actionsValid ||
    !settingsValid;
  function moveAction(from: number, offset: number) {
    const to = from + offset;
    if (to < 0 || to >= t.actions.length) return;
    const actions = [...t.actions];
    [actions[from], actions[to]] = [actions[to], actions[from]];
    turn({ actions });
  }
  function addAction() {
    const v = actionType;
    if (v === "text_to_speech")
      turn({
        actions: [
          ...t.actions,
          { type: v, voice: "noa", text: "", assetId: "" },
        ],
      });
    else if (v === "youtube")
      turn({
        actions: [...t.actions, { type: "youtube", url: "" }],
      });
    else if (v === "scenemax")
      patch({
        sceneMax: d.sceneMax ?? {
          gateway: localGateway,
          projectGuid: "",
          sessionId: 1000,
          scene: "main",
        },
        states: d.states.map((state, i) =>
          i === idx
            ? {
                ...state,
                actions: [
                  ...state.actions,
                  {
                    type: "scenemax",
                    event: "",
                    message: "",
                  },
                ],
              }
            : state,
        ),
      });
    else if (v === "wait")
      turn({
        actions: [...t.actions, { type: "wait", durationMs: 500 }],
      });
    else {
      turn({ actions: [...t.actions, { type: v, assetId: "" }] });
    }
  }
  async function uploadActionFile(action: MediaAction, file: File) {
    const type = mediaTypes[action.type];
    setUploadingMedia(true);
    try {
      if (file.type && !file.type.startsWith(type + "/"))
        throw Error(tr("Media type mismatch"));
      const id = crypto.randomUUID();
      const asset = schema.shape.assets.element.parse({
        type,
        id,
        uri: "assets/" + id + "/" + file.name,
      });
      await putMedia(d.showId + "/" + asset.uri, file);
      set((current) => {
        if (!current.states.some((state) => state.actions.includes(action)))
          return current;
        return {
          ...current,
          assets: [...current.assets, asset],
          states: current.states.map((state) => ({
            ...state,
            actions: state.actions.map((item) =>
              item === action ? { ...action, assetId: id } : item,
            ),
          })),
        };
      });
      note(tr("Unsaved changes"));
    } catch (error) {
      note(String(error));
    } finally {
      setUploadingMedia(false);
    }
  }
  async function generateSpeech(
    action: Extract<Turn["actions"][number], { type: "text_to_speech" }>,
  ) {
    setUploadingMedia(true);
    note(tr("Generating speech…"));
    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice: action.voice,
          text: action.text,
          speed: action.speed,
          pitch: action.pitch,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      if (!response.headers.get("content-type")?.startsWith("audio/wav"))
        throw new Error("Speech service unavailable.");
      const id = crypto.randomUUID();
      const asset = {
        id,
        type: "audio" as const,
        uri: "assets/speech/" + id + ".wav",
      };
      await putMedia(
        d.showId + "/" + asset.uri,
        new File([await response.blob()], id + ".wav", { type: "audio/wav" }),
      );
      set((current) => {
        if (!current.states.some((state) => state.actions.includes(action)))
          return current;
        return {
          ...current,
          assets: [...current.assets, asset],
          states: current.states.map((state) => ({
            ...state,
            actions: state.actions.map((item) =>
              item === action ? { ...action, assetId: id } : item,
            ),
          })),
        };
      });
      note(tr("Speech ready"));
    } catch (error) {
      note(String(error));
    } finally {
      setUploadingMedia(false);
    }
  }
  function createScript(newScene: boolean) {
    const line = fresh(),
      id = crypto.randomUUID();
    const collection = newScene
      ? { id: crypto.randomUUID(), title: tr("Untitled scene") }
      : sceneOf(d);
    const next = schema.parse({
      schemaVersion: "1.0",
      version: "1",
      recognition: d.recognition,
      language: d.language,
      showId: id,
      title: tr("Untitled script"),
      collection,
      sceneMax: newScene ? undefined : d.sceneMax,
      assets: [],
      states: [line],
      startStateId: line.id,
    });
    try {
      saveScripts([...scriptsWithDraft(d), next]);
      saved(next);
    } catch (e) {
      note(String(e));
    }
  }
  return (
    <>
      <section className="card editor">
        <div className="tools">
          <button
            className="primary"
            disabled={invalid}
            onClick={() => persist(d)}
          >
            <Save />
            {tr("Save scene")}{" "}
          </button>
          <button disabled={invalid} onClick={() => createScript(true)}>
            <Plus />
            {tr("New scene")}
          </button>
          <StageCueFiles draft={d} opened={saved} disabled={invalid} />

          <span className="statusmsg" role="status">
            {msg}
          </span>
        </div>
        <div className="editbody">
          <details className="scene-settings">
            <summary>{tr("Scene general settings")}</summary>
            {d.sceneMax ? (
              <fieldset>
                <legend>{tr("SceneMax connection")}</legend>
                <div className="fields two">
                  {(
                    ["gateway", "projectGuid", "sessionId", "scene"] as const
                  ).map((key, i) => (
                    <label key={key}>
                      {
                        [
                          tr("WebSocket gateway"),
                          tr("Project GUID"),
                          tr("Session ID"),
                          tr("Scene"),
                        ][i]
                      }
                      <input
                        type={key === "sessionId" ? "number" : "text"}
                        value={d.sceneMax![key]}
                        onChange={(e) =>
                          patch({
                            sceneMax: {
                              ...d.sceneMax!,
                              [key]:
                                key === "sessionId"
                                  ? Number(e.target.value)
                                  : e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                  <label>
                    {tr("Server password (this tab only)")}{" "}
                    <input
                      key={JSON.stringify([
                        d.sceneMax.gateway,
                        d.sceneMax.projectGuid,
                      ])}
                      type="password"
                      autoComplete="off"
                      defaultValue={roomPassword(d.sceneMax)}
                      onChange={(e) =>
                        setRoomPassword(d.sceneMax!, e.target.value)
                      }
                    />
                  </label>
                </div>
                <button
                  disabled={scriptsWithDraft(d).some(
                    (s) =>
                      s.scenePackage ||
                      s.states.some(
                        (t) =>
                          t.sceneEntryEvent ||
                          t.actions.some((a) => a.type === "scenemax"),
                      ),
                  )}
                  onClick={() => patch({ sceneMax: undefined })}
                >
                  {tr("Remove connection")}{" "}
                </button>
              </fieldset>
            ) : (
              <button
                onClick={() =>
                  patch({
                    sceneMax: {
                      gateway: localGateway,
                      projectGuid: "",
                      sessionId: 1000,
                      scene: "main",
                    },
                  })
                }
              >
                {tr("Configure SceneMax connection")}
              </button>
            )}
          </details>
          <div className="scene-scripts">
            <label htmlFor="scene-title">{tr("Scene title")}</label>
            <input
              id="scene-title"
              dir="auto"
              value={sceneOf(d).title}
              onChange={(e) =>
                patch({
                  collection: { ...sceneOf(d), title: e.target.value },
                })
              }
            />
            <label htmlFor="scene-script">{tr("Scripts in scene")}</label>
            <select
              id="scene-script"
              value={d.showId}
              disabled={invalid}
              onChange={(e) => {
                try {
                  save(d);
                  const next = sceneScripts(d).find(
                    (s) => s.showId === e.target.value,
                  );
                  if (next) saved(next);
                } catch (err) {
                  note(String(err));
                }
              }}
            >
              {scripts.map((s) => (
                <option key={s.showId} value={s.showId}>
                  {s.showId === d.showId ? d.title : s.title}
                </option>
              ))}
            </select>
            <button disabled={invalid} onClick={() => createScript(false)}>
              <Plus />
              {tr("Add script")}
            </button>
            <button disabled={invalid} onClick={() => void duplicate()}>
              <Copy />
              {tr("Duplicate script")}
            </button>
          </div>
          <div className="fields">
            <label>
              {tr("Script title")}{" "}
              <input
                dir="auto"
                value={d.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </label>
            <label>
              {tr("Language")}{" "}
              <input
                value={d.language}
                onChange={(e) => patch({ language: e.target.value })}
              />
            </label>
            <label>
              {tr("Version")}{" "}
              <input
                value={d.version}
                onChange={(e) => patch({ version: e.target.value })}
              />
            </label>
          </div>
          <details className="scene-import">
            <summary>{tr("SceneMax attachment for this script")}</summary>
            <p>
              {d.scenePackage?.name ||
                tr(
                  "Attach a SceneMax web export or a complete project folder.",
                )}
            </p>
            <label>
              {tr("Scene ZIP")}{" "}
              <input
                type="file"
                accept=".zip"
                disabled={importingScene}
                onChange={(ev) => {
                  void attachScene(Array.from(ev.target.files ?? []));
                  ev.target.value = "";
                }}
              />
            </label>
            <label>
              {tr("Scene folder")}{" "}
              <input
                type="file"
                multiple
                ref={(el) => el?.setAttribute("webkitdirectory", "")}
                disabled={importingScene}
                onChange={(ev) => {
                  void attachScene(Array.from(ev.target.files ?? []));
                  ev.target.value = "";
                }}
              />
            </label>
            {d.scenePackage && (
              <button onClick={() => patch({ scenePackage: undefined })}>
                {tr("Detach scene")}{" "}
              </button>
            )}
            {importingScene && <p>{tr("Importing scene…")}</p>}
          </details>
          <div className="editgrid">
            <div>
              <div className="editheading">
                <h2>{tr("Cue sequence")}</h2>
                <button
                  title={tr("Add cue")}
                  onClick={() =>
                    sequence([...d.states, fresh()], d.states.length)
                  }
                >
                  <Plus />
                </button>
              </div>
              {d.states.map((v, i) => (
                <button
                  key={i}
                  className={"editcue " + (idx === i ? "current" : "")}
                  onClick={() => index(i)}
                >
                  <span className="num">{String(i + 1).padStart(2, "0")}</span>
                  <strong dir="auto">{v.expectedText || v.id}</strong>
                </button>
              ))}
            </div>
            <div className="cueform">
              <div className="between row">
                <h2>
                  {tr("Cue")} {idx + 1}
                </h2>
                <div className="row">
                  {[-1, 1].map((j) => (
                    <button
                      key={j}
                      aria-label={j < 0 ? tr("Move up") : tr("Move down")}
                      disabled={!d.states[idx + j]}
                      onClick={() => {
                        const a = d.states.slice();
                        [a[idx], a[idx + j]] = [a[idx + j], a[idx]];
                        sequence(a, idx + j);
                      }}
                    >
                      {j < 0 ? <ChevronUp /> : <ChevronDown />}
                    </button>
                  ))}
                  <button
                    aria-label={tr("Remove cue")}
                    disabled={d.states.length === 1}
                    onClick={() =>
                      sequence(
                        d.states.filter((_, i) => i !== idx),
                        Math.min(idx, d.states.length - 2),
                      )
                    }
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>
              <div className="fields two">
                <label>
                  {tr("Speaker")}{" "}
                  <input
                    dir="auto"
                    value={t.actor}
                    onChange={(e) => turn({ actor: e.target.value })}
                  />
                </label>
                <label>
                  {tr("Turn type")}{" "}
                  <select
                    value={t.kind}
                    onChange={(e) =>
                      turn({ kind: e.target.value as Turn["kind"] })
                    }
                  >
                    <option value="human_line">{tr("Human actor")}</option>
                    <option value="virtual_line">
                      {tr("Virtual partner")}
                    </option>
                  </select>
                </label>
              </div>
              <label>
                {tr("Script line")}{" "}
                <textarea
                  dir="auto"
                  ref={scriptLine}
                  value={t.expectedText}
                  onChange={(e) => turn({ expectedText: e.target.value })}
                />
              </label>
              {t.kind === "human_line" && (
                <div className="optional-edit">
                  <p>
                    {tr("Wrap optional words in # signs, for example")}{" "}
                    <bdi dir="rtl">#לעשות עם זה#</bdi>
                    {tr(". You can say them or leave them out.")}{" "}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const field = scriptLine.current;
                      if (!field) return;
                      const {
                        selectionStart: start,
                        selectionEnd: end,
                        value,
                      } = field;
                      if (start === end || !value.slice(start, end).trim()) {
                        field.focus();
                        note(tr("Select words in the script line first."));
                        return;
                      }
                      turn({
                        expectedText:
                          value.slice(0, start) +
                          "#" +
                          value.slice(start, end) +
                          "#" +
                          value.slice(end),
                      });
                      field.focus();
                    }}
                  >
                    {tr("Mark selection optional")}{" "}
                  </button>
                </div>
              )}
              <AlternativePhrasings
                key={t.id}
                values={t.alternatives}
                onChange={(alternatives) => turn({ alternatives })}
              />
              <div className="fields two">
                <label>
                  {tr("Match threshold")}{" "}
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step=".01"
                    placeholder={String(d.recognition.matchThreshold)}
                    value={t.trigger.threshold ?? ""}
                    onChange={(e) =>
                      turn({
                        trigger: {
                          ...t.trigger,
                          threshold:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              </div>
              <h3>{tr("Cue actions")}</h3>
              <div className="action-picker">
                <label htmlFor="cue-action-type">{tr("Action type")}</label>
                <select
                  id="cue-action-type"
                  value={actionType}
                  onChange={(e) =>
                    setActionType(e.target.value as ActionChoice)
                  }
                >
                  <option value="play_audio">{tr("Play audio")}</option>
                  <option value="text_to_speech">{tr("Text to speech")}</option>
                  <option value="show_image">{tr("Show image")}</option>
                  <option value="play_video">{tr("Play video")}</option>
                  <option value="wait">{tr("Wait")}</option>
                  <option value="youtube">{tr("YouTube clip")}</option>
                  <option value="scenemax">{tr("SceneMax broadcast")}</option>
                </select>
                <button type="button" onClick={addAction}>
                  <Plus />
                  {tr("Add action")}
                </button>
              </div>
              <label>
                {tr("Action timing")}{" "}
                <select
                  value={t.actionMode ?? "sequential"}
                  onChange={(e) =>
                    turn({ actionMode: e.target.value as Turn["actionMode"] })
                  }
                >
                  <option value="sequential">{tr("Run in sequence")}</option>
                  <option value="parallel">{tr("Run in parallel")}</option>
                </select>
              </label>
              {t.actions.length > 0 && (
                <table
                  className="actionlist"
                  dir="ltr"
                  aria-label={tr("Cue actions")}
                >
                  <colgroup>
                    <col className="action-type-col" />
                    <col />
                    <col className="action-order-col" />
                    <col className="action-delete-col" />
                  </colgroup>
                  <tbody>
                    {t.actions.map((a, i) => (
                      <tr key={i}>
                        <th scope="row">
                          <div className="action-content">
                            {tr(a.type.replaceAll("_", " "))}
                          </div>
                        </th>
                        <td>
                          <div className="action-content">
                            {a.type === "youtube" ? (
                              <label>
                                {tr("YouTube link")}{" "}
                                <input
                                  value={a.url}
                                  placeholder="https://youtu.be/…"
                                  onChange={(e) =>
                                    turn({
                                      actions: t.actions.map((x, j) =>
                                        j === i
                                          ? { ...a, url: e.target.value }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                              </label>
                            ) : a.type === "scenemax" ? (
                              <div className="fields two">
                                <label>
                                  {tr("Event name")}{" "}
                                  <input
                                    value={a.event}
                                    placeholder="animation_cue"
                                    onChange={(e) =>
                                      turn({
                                        actions: t.actions.map((x, j) =>
                                          j === i
                                            ? { ...a, event: e.target.value }
                                            : x,
                                        ),
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  {tr("Message")}{" "}
                                  <input
                                    dir="auto"
                                    value={a.message}
                                    onChange={(e) =>
                                      turn({
                                        actions: t.actions.map((x, j) =>
                                          j === i
                                            ? { ...a, message: e.target.value }
                                            : x,
                                        ),
                                      })
                                    }
                                  />
                                </label>
                              </div>
                            ) : a.type === "text_to_speech" ? (
                              <div>
                                <label>
                                  {tr("Voice")}
                                  <select
                                    value={a.voice}
                                    disabled={uploadingMedia}
                                    onChange={(e) =>
                                      turn({
                                        actions: t.actions.map((item, j) =>
                                          j === i
                                            ? {
                                                ...a,
                                                voice: e.target
                                                  .value as typeof a.voice,
                                                assetId: "",
                                              }
                                            : item,
                                        ),
                                      })
                                    }
                                  >
                                    <option value="noa">
                                      {tr("Noa · Hebrew")}
                                    </option>
                                    <option value="omer">
                                      {tr("Omer · bundled Hebrew")}
                                    </option>
                                    <option value="asaf">
                                      {tr("Asaf · Windows Hebrew")}
                                    </option>
                                  </select>
                                </label>
                                {(["speed", "pitch"] as const).map((key) => {
                                  const speed = key === "speed";
                                  const value = a[key] ?? (speed ? 1 : 0);
                                  const label = tr(
                                    speed
                                      ? "Speaking speed"
                                      : "Pitch (semitones)",
                                  );
                                  return (
                                    <label key={key}>
                                      {label} · {value}
                                      {speed ? "×" : ""}
                                      <input
                                        type="range"
                                        aria-label={label}
                                        min={speed ? 0.75 : -6}
                                        max={speed ? 1.5 : 6}
                                        step={speed ? 0.05 : 1}
                                        disabled={uploadingMedia}
                                        value={value}
                                        onChange={(e) =>
                                          turn({
                                            actions: t.actions.map((item, j) =>
                                              i === j
                                                ? {
                                                    ...a,
                                                    [key]: Number(
                                                      e.target.value,
                                                    ),
                                                    assetId: "",
                                                  }
                                                : item,
                                            ),
                                          })
                                        }
                                      />
                                    </label>
                                  );
                                })}
                                <label>
                                  {tr("Spoken text")}
                                  <textarea
                                    dir="auto"
                                    maxLength={2000}
                                    value={a.text}
                                    disabled={uploadingMedia}
                                    onChange={(e) =>
                                      turn({
                                        actions: t.actions.map((item, j) =>
                                          j === i
                                            ? {
                                                ...a,
                                                text: e.target.value,
                                                assetId: "",
                                              }
                                            : item,
                                        ),
                                      })
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  disabled={
                                    !a.text.trim() ||
                                    uploadingMedia ||
                                    !!a.assetId
                                  }
                                  onClick={() => void generateSpeech(a)}
                                >
                                  {a.assetId
                                    ? tr("Speech ready")
                                    : tr("Generate speech")}
                                </button>
                              </div>
                            ) : "assetId" in a ? (
                              <div className="action-media">
                                <select
                                  aria-label={tr("Media file")}
                                  value={a.assetId}
                                  onChange={(e) =>
                                    turn({
                                      actions: t.actions.map((item, j) =>
                                        i === j
                                          ? { ...a, assetId: e.target.value }
                                          : item,
                                      ),
                                    })
                                  }
                                >
                                  <option value="" disabled>
                                    {tr("Choose from library")}
                                  </option>
                                  {d.assets
                                    .filter(
                                      (asset) =>
                                        asset.type === mediaTypes[a.type],
                                    )
                                    .map((asset) => (
                                      <option key={asset.id} value={asset.id}>
                                        {asset.uri.split("/").at(-1)}
                                      </option>
                                    ))}
                                </select>
                                <label className="action-upload">
                                  {tr("Browse files…")}
                                  <input
                                    type="file"
                                    disabled={uploadingMedia}
                                    accept={mediaTypes[a.type] + "/*"}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      e.target.value = "";
                                      if (file) void uploadActionFile(a, file);
                                    }}
                                  />
                                </label>
                              </div>
                            ) : a.type === "wait" ? (
                              <label>
                                {tr("Wait (seconds)")}
                                <input
                                  type="number"
                                  min="0"
                                  max="3600"
                                  step="0.001"
                                  value={
                                    Number.isFinite(a.durationMs)
                                      ? a.durationMs / 1000
                                      : ""
                                  }
                                  onChange={(e) =>
                                    turn({
                                      actions: t.actions.map((item, j) =>
                                        i === j
                                          ? {
                                              ...a,
                                              durationMs: Math.round(
                                                e.target.valueAsNumber * 1000,
                                              ),
                                            }
                                          : item,
                                      ),
                                    })
                                  }
                                />
                              </label>
                            ) : (
                              a.event
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="action-order">
                            <button
                              type="button"
                              title={tr("Move action up")}
                              aria-label={tr("Move action up")}
                              disabled={i === 0}
                              onClick={() => moveAction(i, -1)}
                            >
                              <ChevronUp size={16} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              title={tr("Move action down")}
                              aria-label={tr("Move action down")}
                              disabled={i === t.actions.length - 1}
                              onClick={() => moveAction(i, 1)}
                            >
                              <ChevronDown size={16} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                        <td className="action-delete">
                          <button
                            title={tr("Delete action")}
                            aria-label={tr("Delete action")}
                            onClick={() =>
                              turn({
                                actions: t.actions.filter((_, j) => j !== i),
                              })
                            }
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button
                disabled={
                  !actionsValid ||
                  !settingsValid ||
                  !result.success ||
                  !t.actions.length
                }
                onClick={() =>
                  testing ? controller.current?.abort() : void testCue()
                }
              >
                {testing ? <Square /> : <Play />}
                {testing ? tr("Stop test") : tr("Test cue")}
              </button>
              <div className="preview" ref={visual} />
              {player.current?.stage && !testing && (
                <button
                  onClick={() => {
                    player.current?.dispose();
                    visual.current?.replaceChildren();
                    note(tr("Preview closed"));
                  }}
                >
                  {tr("Close preview")}{" "}
                </button>
              )}
              <details>
                <summary>{tr("Advanced cue settings")}</summary>
                <label>
                  {tr("Minimum current-line score")}{" "}
                  <input
                    type="number"
                    step=".01"
                    min="0"
                    max="1"
                    placeholder={String(d.recognition.minCurrentLineScore)}
                    value={t.trigger.minCurrentLineScore ?? ""}
                    onChange={(e) =>
                      turn({
                        trigger: {
                          ...t.trigger,
                          minCurrentLineScore:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  {tr("Terminal evidence")}{" "}
                  <select
                    value={
                      t.trigger.requireTerminalEvidence === undefined
                        ? "default"
                        : String(t.trigger.requireTerminalEvidence)
                    }
                    onChange={(e) =>
                      turn({
                        trigger: {
                          ...t.trigger,
                          requireTerminalEvidence:
                            e.target.value === "default"
                              ? undefined
                              : e.target.value === "true",
                        },
                      })
                    }
                  >
                    <option value="default">{tr("Use script setting")}</option>
                    <option value="true">{tr("Required")}</option>
                    <option value="false">{tr("Optional")}</option>
                  </select>
                </label>
                <label>
                  {tr("Cue ID")}{" "}
                  <input
                    value={t.id}
                    onChange={(e) => {
                      const v = e.target.value;
                      patch({
                        startStateId:
                          d.startStateId === t.id ? v : d.startStateId,
                        states: d.states.map((s, i) => ({
                          ...s,
                          id: i === idx ? v : s.id,
                          nextStateId:
                            s.nextStateId === t.id ? v : s.nextStateId,
                        })),
                      });
                    }}
                  />
                </label>
                <label>
                  {tr("Next cue")}{" "}
                  <select
                    value={t.nextStateId ?? ""}
                    onChange={(e) =>
                      turn({ nextStateId: e.target.value || null })
                    }
                  >
                    <option value="">{tr("End scene")}</option>
                    {d.states.map((s) => (
                      <option key={s.id}>{s.id}</option>
                    ))}
                  </select>
                </label>
                <JsonField
                  key={t.id}
                  onValid={setActionsValid}
                  label={tr("Cue actions (JSON)")}
                  value={t.actions}
                  apply={(v) =>
                    turn({
                      actions:
                        schema.shape.states.element.shape.actions.parse(v),
                    })
                  }
                />
              </details>
            </div>
          </div>
          <details>
            <summary>
              {tr("Media library ·")} {d.assets.length} {tr("assets")}
            </summary>
            <p className="hint">
              {tr(
                "Upload matching filenames to reconnect imported media. Files stay in this browser.",
              )}{" "}
            </p>
            <button onClick={() => media.current?.click()}>
              <Upload />
              {tr("Add or reconnect media")}{" "}
            </button>
            <input
              hidden
              type="file"
              multiple
              ref={media}
              accept="audio/*,image/*,video/*"
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                try {
                  const assets = [...d.assets];
                  for (const f of files) {
                    const type = f.type.split("/")[0] as
                      "audio" | "image" | "video";
                    if (!["audio", "image", "video"].includes(type))
                      throw Error(tr("Unsupported file") + " " + f.name);
                    const matches = assets.filter(
                      (a) => a.uri.split("/").at(-1) === f.name,
                    );
                    if (matches.length > 1)
                      throw Error(tr("Ambiguous file mapping:") + " " + f.name);
                    const a = matches[0] ?? {
                      id: crypto.randomUUID(),
                      uri: "assets/" + f.name,
                      type,
                    };
                    if (a.type !== type) throw Error(tr("Media type mismatch"));
                    await putMedia(d.showId + "/" + a.uri, f);
                    if (!matches.length) assets.push(a);
                  }
                  patch({ assets });
                } catch (ex) {
                  note(String(ex));
                }
              }}
            />
            {d.assets.map((a) => (
              <div className="assetrow" key={a.id}>
                <span>{a.uri}</span>
                <button
                  onClick={async () => {
                    setPreviewType(a.type);
                    setPreview(await mediaUrl(d, a));
                  }}
                >
                  {tr("Preview")}{" "}
                </button>
              </div>
            ))}
            {preview && (
              <div className="preview">
                {previewType === "image" ? (
                  <img src={preview} />
                ) : (
                  <video
                    src={preview}
                    controls
                    onError={() =>
                      note(
                        tr("Preview unavailable. Reconnect the matching file."),
                      )
                    }
                  />
                )}
              </div>
            )}
          </details>
          <details>
            <summary>{tr("Recognition settings")}</summary>
            <JsonField
              onValid={setSettingsValid}
              label={tr(
                "Provider, speech detection, thresholds and history weights",
              )}
              value={d.recognition}
              apply={(v) =>
                patch({ recognition: schema.shape.recognition.parse(v) })
              }
            />
          </details>
          {missing.length > 0 && (
            <div className="error">
              {tr("Reconnect missing media in the library:")}{" "}
              {missing.join(", ")}
            </div>
          )}
          {!result.success && (
            <div className="error" role="alert">
              {result.error.issues.map((v, i) => (
                <div key={i}>
                  {v.path.join(".")} {v.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
