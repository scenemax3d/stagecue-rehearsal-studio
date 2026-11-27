import { restoreOutput } from "./audioOutput";
import { tr } from "./language";
import { language, switchLanguage, type Language, message } from "./language";
import { StageCueFiles } from "./StageCueFiles";
import { SceneRemoval } from "./SceneRemoval";
import { MicrophoneControls } from "./MicrophoneControls";
import { loadScene } from "./sceneLibrary";
import { localGateway } from "./localhost";
import React, { useState, useEffect, useRef, useReducer } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Minus,
  X,
  Copy,
  PanelsTopLeft,
  LibraryBig,
  Ellipsis,
  NotebookPen,
  AudioLines,
  Play,
  Pause,
  Square,
  SkipForward,
  RotateCcw,
  Maximize2,
  Mic,
  Volume2,
  ScrollText,
  ChevronDown,
  Eye,
  EyeOff,
  Activity,
  Radio,
  Check,
  ListMusic,
  Monitor,
  Keyboard,
  Repeat2,
  SlidersHorizontal,
} from "lucide-react";
import { demo, projects, sceneOf, sceneScripts, saveScripts, openDesktopLibrary } from "./storage";
import type { Show } from "./model";
import {
  displayText,
  lineParts,
  type LinePart,
  type WordMark,
} from "./lineMatch";
import { spokenText } from "./engine";
import { Session, names } from "./session";
import { Editor, blankScript } from "./Editor";
import { HelpMenu } from "./HelpMenu";
import { GeneralSettings } from "./GeneralSettings";
import {
  loadBinding,
  saveBinding,
  watchGamepads,
  type ButtonBinding,
} from "./joystick";
import "./style.css";
void restoreOutput().catch(console.warn);
const pad = (n: number) => String(n).padStart(2, "0");
function MarkedLine({
  parts,
  marks,
}: {
  parts: LinePart[];
  marks?: WordMark[];
}) {
  let word = 0;
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "direction")
          return (
            <em className="stage-direction" key={i}>
              {p.text}
            </em>
          );
        const status =
          p.kind === "optional"
            ? "optional"
            : p.kind === "word"
              ? marks?.[word++]
              : undefined;
        return status ? (
          <span
            key={i}
            className={"match-" + status}
            title={
              {
                heard: tr("Recognized"),
                unheard: tr("Missed or different"),
                pending: tr("Not heard yet"),
                optional: tr("Skipped in matching"),
              }[status]
            }
          >
            {p.text}
          </span>
        ) : (
          p.text
        );
      })}
    </>
  );
}
type WindowBridge = {
  postMessage(command: string): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
};
const windowBridge = (
  window as Window & { chrome?: { webview?: WindowBridge } }
).chrome?.webview;
function WindowControls({ bridge }: { bridge: WindowBridge }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const changed = (e: MessageEvent) => {
      if (e.data === "window:maximized" || e.data === "window:normal")
        setMaximized(e.data === "window:maximized");
    };
    bridge.addEventListener("message", changed);
    bridge.postMessage("window:state");
    return () => bridge.removeEventListener("message", changed);
  }, [bridge]);
  const maximizeLabel = tr(maximized ? "Restore window" : "Maximize window");
  return (
    <div className="window-controls">
      <button
        aria-label={tr("Minimize window")}
        title={tr("Minimize window")}
        onClick={() => bridge.postMessage("window:minimize")}
      >
        <Minus />
      </button>
      <button
        aria-label={maximizeLabel}
        title={maximizeLabel}
        onClick={() => bridge.postMessage("window:toggle")}
      >
        {maximized ? <Copy /> : <Square />}
      </button>
      <button
        aria-label={tr("Close window")}
        title={tr("Close window")}
        onClick={() => bridge.postMessage("window:close")}
      >
        <X />
      </button>
    </div>
  );
}
function studioView() {
  if (location.hash === "#editor") return "editor";
  if (location.hash === "#player" || (!location.hash && new URLSearchParams(location.search).has("show"))) return "player";
  return "home";
}
function Studio() {
  const [list, setList] = useState(projects),
    [show, setShow] = useState(
      () =>
        list.find(
          (s) =>
            s.showId ===
            (new URLSearchParams(location.search).get("show") ||
              localStorage.getItem("stagecue.selected")),
        ) || list[0] || demo,
    ),
    [view, setView] = useState(studioView);
  const [menuSlot, setMenuSlot] = useState<HTMLDivElement | null>(null);
  const edit = view === "editor";
  const home = view === "home" || !list.length;
  const [manage, setManage] = useState<{ id: string; title: string; removed: boolean } | null>(null);
  const removedScenes = React.useMemo(() => Array.from(new Map(
    projects(true).map(s => [sceneOf(s).id, sceneOf(s)])
  ).values()), [list]);
  useEffect(() => {
    const f = () => setView(studioView());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const [locale, setLocale] = useState(language);
  const localDate = React.useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short",
  }), [locale]);
  const scenes = Array.from(
    new Map(list.map((s) => [sceneOf(s).id, sceneOf(s)])).values(),
  );
  const scripts = sceneScripts(show, list);
  const [settings, setSettings] = useState(false);
  const [binding, setBinding] = useState(loadBinding);
  const change = React.useCallback((next: ButtonBinding | null) => {
    saveBinding(next);
    setBinding(next);
  }, []);
  const choose = (s: Show) => {
    const url = new URL(location.href);
    if (url.searchParams.has("show")) {
      url.searchParams.set("show", s.showId);
      history.replaceState(null, "", url);
    }
    localStorage.setItem("stagecue.selected", s.showId);
    setShow(s);
  };
  const activate = (script: Show) => {
    choose(script);
    location.hash = "player";
  };
  return (
    <>
      <header className={windowBridge ? "desktop-header" : undefined}>
        <div className="headwrap">
          <a className="brand" href="#home" dir="ltr">
            <img src="/stagecue.png" className="brandmark" alt="" />
            Stagecue
          </a>
          <nav>
            <a className={view === "home" ? "selected" : ""} href="#home">
              <LibraryBig />{tr("Home")}
            </a>
            {!!list.length && <><a className={view === "player" ? "selected" : ""} href="#player">
              <PanelsTopLeft />
              {tr("Rehearsal")}{" "}
            </a>
            <a className={edit ? "selected" : ""} href="#editor">
              <NotebookPen />
              {tr("Scene Editor")}{" "}
            </a></>}
          </nav>
          {!home && !edit && <div className="menu-transport transport" ref={setMenuSlot} />}
          <HelpMenu />
          <button
            className="settings-trigger"
            aria-label={tr("General settings")}
            title={tr("General settings")}
            onClick={() => setSettings(true)}
          >
            <SlidersHorizontal />
          </button>
          <span className="local">
            <i /> {tr("Local workspace")}{" "}
          </span>
        </div>
        {windowBridge && <WindowControls bridge={windowBridge} />}
      </header>
      {settings && (
        <GeneralSettings
          locale={locale}
          changeLanguage={(value: Language) => {
            switchLanguage(value);
            setLocale(value);
          }}
          binding={binding}
          change={change}
          close={() => setSettings(false)}
        />
      )}
      <main>
        {home ? <section className="scene-library">
          <div className="library-hero">
            <h1>{tr("Scene library")}</h1>
            <StageCueFiles opened={s => { setList(projects()); activate(s); }} />
          </div>
          <h2>{tr("Available scenes")} <span>{scenes.length}</span></h2>
          {!list.length && <button onClick={async () => {
            const next = blankScript(demo, true);
            try { await saveScripts([next]); } catch (error) { window.alert(String(error)); return; }
            setList(projects());
            choose(next);
            location.hash = "editor";
          }}>{tr("New scene")}</button>}
          <div className="library-grid">
            {scenes.map(scene => {
              const members = list.filter(script => sceneOf(script).id === scene.id);
              return <div className="scene-card" key={scene.id}><button className="library-scene" onClick={() =>
                activate(members.find(script => script.showId === show.showId) ?? members[0])
              }>
                <ScrollText aria-hidden="true" />
                <strong dir="auto">{scene.title}</strong>
                <span>{tr("Scripts in scene")} · {members.length}</span>
                <Play className="library-play" aria-hidden="true" />
                <span className="library-date">{scene.added ? <>
                  {tr(scene.added.via === "imported" ? "Imported" : "Created")} ·{" "}
                  <time dateTime={scene.added.at}>{localDate.format(new Date(scene.added.at))}</time>
                </> : tr("Date added unavailable")}</span>
              </button><button className="scene-options" aria-label={tr("Manage scene") + " · " + scene.title}
                title={tr("Manage scene")} onClick={() => setManage({...scene, removed:false})}><Ellipsis /></button></div>;
            })}
          </div>
          {removedScenes.length > 0 && <details className="removed-scenes">
            <summary>{tr("Removed scenes")} · {removedScenes.length}</summary>
            {removedScenes.map(scene => <button key={scene.id} onClick={() => setManage({...scene, removed:true})}>
              <span dir="auto">{scene.title}</span><Ellipsis />
            </button>)}
          </details>}
          {manage && <SceneRemoval scene={manage} removed={manage.removed} close={() => setManage(null)} changed={() => {
            const available = projects();
            setList(available);
            if (!available.some(s => s.showId === show.showId) || !list.length) {
              if (available.length) choose(available[0]);
              else localStorage.removeItem("stagecue.selected");
            }
            setManage(null);
          }} />}
        </section> : <>
        <div className="pagehead">
          <div>
            <div className="eyebrow kicker">
              <span />
              {tr("ACTOR WORKSPACE")}{" "}
            </div>
            <h1>{edit ? tr("Scene Editor") : tr("Rehearsal studio")}</h1>
            <p>
              {edit
                ? tr(
                    "Shape your scene, record your cues, and prepare to rehearse.",
                  )
                : tr("Practice your lines with a responsive scene partner.")}
            </p>
          </div>
          <div className="project-switch">
            <label className="project">
              <span className="eyebrow">{tr("Active scene")}</span>
              <span className="selectwrap">
                <ScrollText />
                <select
                  aria-label={tr("Active scene")}
                  value={sceneOf(show).id}
                  onChange={(e) =>
                    choose(list.find((s) => sceneOf(s).id === e.target.value)!)
                  }
                >
                  {scenes.map((scene) => (
                    <option key={scene.id} value={scene.id}>
                      {scene.title}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </span>
            </label>
            {!edit && scripts.length > 1 && (
              <label>
                {tr("Active script")}{" "}
                <select
                  value={show.showId}
                  onChange={(e) =>
                    choose(scripts.find((s) => s.showId === e.target.value)!)
                  }
                >
                  {scripts.map((s) => (
                    <option key={s.showId} value={s.showId}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
        {edit ? (
          <Editor
            key={JSON.stringify(show)}
            show={show}
            saved={(s) => {
              setList(projects());
              choose(s);
            }}
          />
        ) : (
          <Player
            menuSlot={menuSlot}
            key={JSON.stringify(show)}
            show={show}
            binding={settings ? null : binding}
          />
        )}
        </>}
        <footer>
          <span>Stagecue</span>
          <span>{tr("Rehearsal workspace")}</span>
        </footer>
      </main>
    </>
  );
}
function Player({
  menuSlot,
  show,
  binding,
}: {
  show: Show;
  menuSlot: HTMLDivElement | null;
  binding: ButtonBinding | null;
}) {
  const [, draw] = useReducer((n) => n + 1, 0),
    [s] = useState(() => {
      const session = new Session(show, draw);
      const params = new URLSearchParams(location.search);
      const cue = show.states.find((t) => t.id === params.get("cue"));
      if (cue && params.get("show") === show.showId) session.e.id = cue.id;
      return session;
    }),
    [hidden, hide] = useState(false),
    [input, setInput] = useState(""),
    [diag, setDiag] = useState(false);
  const stage = useRef<HTMLDivElement>(null),
    video = useRef<HTMLDivElement>(null),
    sheet = useRef<HTMLDivElement>(null);
  useEffect(() => () => s.dispose(), [s]);
  const e = s.e,
    t = e.turn,
    index = show.states.indexOf(t),
    active = !["IDLE", "ERROR", "FINISHED"].includes(e.phase),
    finished = e.phase === "FINISHED",
    done = finished ? show.states.length : index;
  const parts = React.useMemo(() => lineParts(t.expectedText, t.scriptedTurn), [t.expectedText, t.scriptedTurn]);
  React.useLayoutEffect(() => {
    const preview = stage.current;
    const header = menuSlot?.closest("header");
    if (!active || !preview || !header) return;
    const measure = () => {
      const top = preview.getBoundingClientRect().top + window.scrollY;
      preview.style.setProperty("--preview-top", top + "px");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [active, menuSlot]);
  const yourTurn = t.kind === "human_line" && e.armed &&
    (e.phase === "LISTENING" || e.phase === "CANDIDATE");
  const embed =
    !!show.scenePackage ||
    (show.sceneMax &&
      show.sceneMax.projectGuid === "stagecue-elevator" &&
      show.sceneMax.sessionId === 1000 &&
      show.sceneMax.scene === "main");
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!binding || s.mode !== "mock") return;
    if (binding.kind === "gamepad")
      return watchGamepads((press) => {
        if (
          press.kind === "gamepad" &&
          press.device === binding.device &&
          press.button === binding.button &&
          s.mode === "mock" &&
          s.e.armed
        )
          s.advance();
      });
    function key(ev: KeyboardEvent) {
      if (
        binding?.kind !== "key" ||
        ev.code !== binding.code ||
        ev.ctrlKey ||
        ev.metaKey ||
        ev.altKey ||
        (ev.target as Element | null)?.closest?.(
          "input,textarea,select,[contenteditable=true]",
        ) ||
        s.mode !== "mock" ||
        !document.hasFocus()
      )
        return;
      // Suppress native button activation for Space/Enter, including held repeats.
      if (!s.e.armed && !ev.repeat) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (!ev.repeat && s.e.armed) s.advance();
    }
    const iframe = frame.current;
    let child: Document | null = null;
    function listenInFrame() {
      child?.removeEventListener("keydown", key, true);
      child = iframe?.contentDocument ?? null;
      child?.addEventListener("keydown", key, true);
    }
    listenInFrame();
    iframe?.addEventListener("load", listenInFrame);
    window.addEventListener("keydown", key, true);
    return () => {
      iframe?.removeEventListener("load", listenInFrame);
      child?.removeEventListener("keydown", key, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [binding, s, s.mode]);
  const [playerStatus, setPlayerStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [attempt, retry] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!embed) return;
    const size = new ResizeObserver(([{ contentRect }]) => {
      frame.current?.style.setProperty(
        "--scale",
        String(Math.min(contentRect.width / 900, contentRect.height / 600)),
      );
    });
    size.observe(stage.current!);
    const timer = setTimeout(() => setPlayerStatus("error"), 60000);
    function receive(event: MessageEvent) {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "stagecue-player"
      )
        return;
      if (
        event.data.status === "request-scene" &&
        show.scenePackage &&
        show.sceneMax
      ) {
        const child = frame.current?.contentWindow;
        const room = show.sceneMax;
        void loadScene(show.scenePackage.id)
          .then((bundle) =>
            child?.postMessage(
              {
                type: "stagecue-scene",
                bundle,
                room: { ...room, gateway: localGateway },
                password: "",
              },
              location.origin,
            ),
          )
          .catch((error) =>
            child?.postMessage(
              { type: "stagecue-scene", error: String(error) },
              location.origin,
            ),
          );
        return;
      }
      if (event.data.status === "ready" || event.data.status === "error") {
        clearTimeout(timer);
        setPlayerStatus(event.data.status);
        if (event.data.status === "ready") s.syncScene();
      }
    }
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timer);
      size.disconnect();
      window.removeEventListener("message", receive);
    };
  }, [embed, attempt, s]);
  const output = s.player.stage;
  const timer = s.player.countdown;
  useEffect(() => {
    if (video.current)
      video.current.replaceChildren(...(output ? [output] : []));
  }, [output]);
  React.useLayoutEffect(() => {
    const box = sheet.current;
    if (!box) return;
    const rows = Array.from(box.children).slice(index, index + 3);
    if (!rows.length) return;
    const follow = () => {
      const first = rows[0].getBoundingClientRect();
      const last = rows[rows.length - 1].getBoundingClientRect();
      const style = getComputedStyle(box);
      const topPad = parseFloat(style.paddingTop);
      const bottomPad = parseFloat(style.paddingBottom);
      // Let long, wrapped dialogue use the space it needs for the three-cue window.
      const required = Math.ceil(last.bottom - first.top + topPad + bottomPad);
      box.style.setProperty("--cue-window-height", required + "px");
      const top = box.getBoundingClientRect().top + box.clientTop;
      const bottom = top + box.clientHeight;
      if (first.top < top + topPad)
        box.scrollTop += Math.floor(first.top - top - topPad);
      else if (last.bottom > bottom - bottomPad)
        box.scrollTop += Math.ceil(last.bottom - bottom + bottomPad);
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(box);
    rows.forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [index, hidden]);
  const phase: Record<string, string> = {
    IDLE: tr("Ready"),
    LISTENING: tr("Listening"),
    CANDIDATE: tr("Candidate detected"),
    EXECUTING: tr("Cue fired"),
    WAITING_FOR_PLAYBACK: tr("Playing cue"),
    PAUSED: tr("Paused"),
    ERROR: tr("Error"),
    FINISHED: tr("Scene complete"),
  };
  const elapsed = s.timings
    .filter((x) => x.onset !== undefined && x.endpoint !== undefined)
    .map((x) => x.onset! - x.endpoint!)
    .sort((a, b) => a - b);
  const quant = (p: number) =>
    elapsed.length
      ? Math.round(elapsed[Math.ceil(elapsed.length * p) - 1]) + " " + tr("ms")
      : "—";
  const rehearsalButton = (
    <button
      className="primary"
      disabled={
        s.busy || (!active && embed && playerStatus === "loading")
      }
      onClick={() =>
        active
          ? s.pause()
          : void s.start(finished ? show.startStateId : e.id)
      }
    >
      {active && e.phase !== "PAUSED" ? (
        <Pause />
      ) : (
        <Play fill="currentColor" />
      )}
      {embed && !active && playerStatus === "loading"
        ? tr("Loading SceneMax…")
        : s.busy
          ? tr("Connecting…")
          : active
            ? e.phase === "PAUSED"
              ? tr("Resume")
              : tr("Pause rehearsal")
            : tr("Start rehearsal")}
    </button>
  );
  return (
    <>
      {menuSlot && createPortal(
        <>
          {rehearsalButton}
          <button
            title={tr("Stop rehearsal")}
            aria-label={tr("Stop rehearsal")}
            disabled={!active && !finished && !output}
            onClick={() => s.stop()}
          >
            <Square />
          </button>
          <button
            title={tr("Replay last cue")}
            aria-label={tr("Replay last cue")}
            disabled={!e.last || !e.armed}
            onClick={() => s.replay()}
          >
            <Repeat2 />
          </button>
          <button
            title={tr("Manually fire current cue")}
            aria-label={tr("Manually fire current cue")}
            disabled={!e.armed}
            onClick={() => s.advance()}
          >
            <SkipForward />
          </button>
          <button
            title={tr("Restart rehearsal")}
            aria-label={tr("Restart rehearsal")}
            onClick={() => void s.start(show.startStateId)}
          >
            <RotateCcw />
          </button>
        </>, menuSlot
      )}
      <div className={active || s.busy ? "upper rehearsing" : "upper"}>
        <section className="card monitor">
          <div
            className={embed ? "stage embedded" : "stage"}
            ref={stage}
            style={
              embed
                ? undefined
                : { backgroundImage: 'url("/assets/stage.webp")' }
            }
          >
            {embed && (
              <iframe
                key={attempt}
                ref={frame}
                title={tr("SceneMax rehearsal player")}
                className="scenemax-frame"
                src={
                  show.scenePackage
                    ? "/scenemax/index.html?external"
                    : "/scenemax/index.html"
                }
              />
            )}
            <div className="stagevideo" ref={video} hidden={!output} />
            <div className="stagetop">
              <span className="stagebadge">
                <Monitor size={14} /> {embed ? "SCENEMAX" : tr("STAGE MONITOR")}
              </span>
              <button
                className="expand"
                aria-label={tr("Toggle fullscreen")}
                onClick={() =>
                  document.fullscreenElement
                    ? void document.exitFullscreen()
                    : void stage.current?.requestFullscreen()
                }
              >
                <Maximize2 size={16} />
              </button>
            </div>
            <div className="stagecaption">
              <span className="sceneindex">{tr("REHEARSAL SCRIPT")}</span>
              <h2 dir="auto">{show.title}</h2>
              <div className="stagemeta">
                <span>
                  {show.language === "he-IL" ? tr("Hebrew") : show.language}
                </span>
                <b>·</b>
                <span>
                  {show.states.length} {tr("cues")}
                </span>
              </div>
            </div>
            <span
              className={"phase " + (yourTurn ? "your-turn" : active ? "live" : "")}
              aria-live="polite"
            >
              {yourTurn ? <Mic size={32} aria-label={tr("Your turn to speak")} role="img" /> : <i />}
              {phase[e.phase]}
            </span>
            <span className="stage-speaker" role="img"
              aria-label={tr(t.kind === "human_line" ? "ACTOR LINE" : "VIRTUAL PARTNER")}
              title={tr(t.kind === "human_line" ? "ACTOR LINE" : "VIRTUAL PARTNER")}>
              {t.kind === "human_line" ? <Mic size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
            </span>
            {timer && (
              <div className="cue-countdown" data-audio={timer.label === "Preparing speech" || timer.label === "Audio playback"}>
                <div><strong>{tr(timer.label)}</strong><span>
                  {e.phase === "PAUSED" && tr("Paused") + (timer.total ? " · " : "")}
                  {timer.total > 0 && tr("{n} s remaining").replace("{n}", (Math.ceil(timer.remaining / 100) / 10).toLocaleString(language))}
                </span></div>
                <progress aria-label={tr(timer.label)} max={timer.total || 1} value={timer.total ? timer.total - timer.remaining : undefined} />
              </div>
            )}
          </div>
          {embed && playerStatus === "error" && (
            <div className="player-retry" role="status">
              {tr("SceneMax is unavailable. You can continue rehearsing.")}{" "}
              <button
                onClick={() => {
                  setPlayerStatus("loading");
                  retry();
                }}
              >
                {tr("Reload player")}{" "}
              </button>
            </div>
          )}
          <div className="linepanel" key={t.id}>
            <div className="line" dir={hidden ? "ltr" : "auto"}>
              {hidden ? (
                tr("Script hidden")
              ) : (
                <MarkedLine
                  parts={parts.map(p => p.kind === "direction" ? { kind: "punctuation", text: " " } : p)}
                  marks={
                    e.feedback?.turnId === t.id && !e.feedback.alternative
                      ? e.feedback.marks
                      : undefined
                  }
                />
              )}
            </div>
            {!hidden && parts.filter(p => p.kind === "direction").map((p, i) => (
              <div className="reading-note" dir="auto" key={i}>{p.text}</div>
            ))}
            <div className="actor">
              <span /> {t.actor}
            </div>
          </div>
        </section>
        <section className="card sheet">
          <div className="cardhead">
            <div className="headingicon">
              <ListMusic />
              <h2>{tr("Cue sheet")}</h2>
            </div>
            <span className="chip">
              {show.states.length} {tr("cues")}
            </span>
          </div>
          <div className="sheetlist" ref={sheet}>
            {show.states.map((turn, i) => (
              <button
                key={turn.id}
                className={"cue " + (i === index && !finished ? "current" : "")}
                onClick={() => s.jump(turn.id)}
                disabled={
                  s.busy || (!active && embed && playerStatus === "loading")
                }
                title={tr("Jump to") + " " + turn.id}
              >
                <span className="num">
                  {i < done ? <Check size={14} /> : pad(i + 1)}
                </span>
                <span className="cuebody">
                  <span className="cuecaption">
                    {turn.kind === "human_line"
                      ? <span className="speaker-label actor-label"><Mic aria-hidden="true" />{tr("Your line")}</span>
                      : <span className="speaker-label partner-label"><Volume2 aria-hidden="true" />{tr("Virtual partner")}</span>}
                    {i === index && !finished && <b>{tr("Current")}</b>}
                  </span>
                  <strong dir="auto">
                    {hidden ? "••••••" : displayText(turn.expectedText)}
                  </strong>
                </span>
              </button>
            ))}
          </div>
          <div className="sheetfoot">
            <div className="between row">
              <span>{tr("Scene progress")}</span>
              <b>
                {done} / {show.states.length}
              </b>
            </div>
            <div className="track">
              <i style={{ width: (done / show.states.length) * 100 + "%" }} />
            </div>
            <button className="textbtn" onClick={() => hide(!hidden)}>
              {hidden ? <EyeOff /> : <Eye />}
              {hidden ? tr("Show script") : tr("Hide script")}
            </button>
          </div>
        </section>
      </div>
      {s.error && (
        <div className="error" role="alert">
          {message(s.error)}
        </div>
      )}
      <details className="session-details" key={active ? "live" : "idle"}>
        <summary>{tr("Rehearsal details")}</summary>
      </details>
      <div className="lower">
        <section className="card">
          <div className="cardhead">
            <div className="headingicon">
              <AudioLines />
              <h2>{tr("Speech recognition")}</h2>
            </div>
            <span className={"chip " + (s.mic ? "on" : "")}>
              {s.mic
                ? tr("Mic on")
                : s.mode === "mock"
                  ? tr("Simulated")
                  : tr("Mic off")}
            </span>
          </div>
          <div className="inside">
            <label className="eyebrow">{tr("INPUT SOURCE")}</label>
            <div className="source">
              <span className="selectwrap">
                <Mic />
                <select
                  aria-label={tr("Input source")}
                  disabled={active || s.busy}
                  value={s.mode}
                  onChange={(ev) => {
                    s.mode = ev.target.value as typeof s.mode;
                    draw();
                  }}
                >
                  {Object.entries(names).map(([v, n]) => (
                    <option value={v} key={v}>
                      {tr(n)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </span>
              <div className="meter" title={tr("Microphone level")}>
                {Array.from({ length: 24 }, (_, i) => (
                  <i
                    key={i}
                    style={{
                      height: 5 + ((i * 7) % 15) + "px",
                      background: i < s.level * 160 ? "#b64931" : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
            {s.mode === "local-hebrew-asr" && (
              <MicrophoneControls
                locked={active || s.busy}
                activeName={s.mic ? s.inputName : ""}
                threshold={s.show.recognition.vadThreshold}
              />
            )}
            {s.mode === "mock" ? (
              <form
                className="mock"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  s.simulate(input || spokenText(t));
                  setInput("");
                }}
              >
                <input
                  aria-label={tr("Simulated Hebrew utterance")}
                  dir="auto"
                  placeholder={tr("Type a line or use the current cue")}
                  value={input}
                  onChange={(ev) => setInput(ev.target.value)}
                />
                <button disabled={!e.armed}>
                  <Keyboard />
                  {tr("Simulate")}{" "}
                </button>
              </form>
            ) : (
              <p className="hint">
                {s.mode === "local-hebrew-asr"
                  ? tr("Hebrew recognition runs on this computer.")
                  : tr("Browser speech may use an online service.")}
              </p>
            )}
            <div className="readout">
              <span>{tr("Latest hypothesis")}</span>
              <strong dir="auto">
                {e.hypothesis || s.samples[0]?.text || "—"}
              </strong>
            </div>
            {!hidden && e.feedback && (
              <div className="word-feedback">
                <span className="eyebrow">
                  {tr("Word match ·")} {e.feedback.turnId}
                  {e.feedback.alternative
                    ? " " + tr("· Alternative phrasing")
                    : ""}
                </span>
                <p dir="auto">
                  <MarkedLine
                    parts={e.feedback.parts}
                    marks={e.feedback.marks}
                  />
                </p>
                <small>
                  <span className="match-heard">{tr("Recognized")}</span> ·{" "}
                  <span className="match-unheard">
                    {tr("Missed or different")}
                  </span>{" "}
                  · <span className="match-pending">{tr("Not heard yet")}</span>{" "}
                  · <span className="match-optional">{tr("Optional")}</span>
                </small>
              </div>
            )}
            <button className="textbtn" onClick={() => setDiag(!diag)}>
              <SlidersHorizontal />
              {diag ? tr("Hide diagnostics") : tr("Match diagnostics")}
            </button>
            {diag && (
              <div className="diagnostics">
                <p>
                  {tr("Endpoint to media onset · p50")} {quant(0.5)} · p95{" "}
                  {quant(0.95)}
                </p>
                {s.timings.slice(-3).map((v, i) => (
                  <p key={i}>
                    {tr("Silence")} {v.silenceMs?.toFixed(0) ?? "—"}{" "}
                    {tr("ms · Decoder tail")} {v.decodeMs?.toFixed(0) ?? "—"}{" "}
                    {tr("ms · Endpoint")} {v.endpoint?.toFixed(0) ?? "—"}{" "}
                    {tr("· ASR")} {v.asr.toFixed(0)} {tr("· Decision")}{" "}
                    {v.decision.toFixed(0)} {tr("· Dispatch")}{" "}
                    {v.dispatch.toFixed(0)} {tr("· Onset")}{" "}
                    {v.onset?.toFixed(0) ?? "—"} {tr("ms")}{" "}
                  </p>
                ))}
                {s.samples.slice(0, 6).map((v, i) => (
                  <p key={i}>
                    {v.text} {tr("· line")} {v.current.toFixed(2)}{" "}
                    {tr("· context")} {v.context.toFixed(2)} {tr("· match")}{" "}
                    {v.score.toFixed(2)} · {tr(v.reason)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="card">
          <div className="cardhead">
            <div className="headingicon">
              <Activity />
              <h2>{tr("Session log")}</h2>
            </div>
            <span className="chip">
              {s.logs.length} {tr("events")}
            </span>
          </div>
          <div className="logs">
            {s.logs.length ? (
              s.logs.map((l, i) => (
                <div className="entry" key={i}>
                  <time>{l.time}</time>
                  {message(l.detail)}
                </div>
              ))
            ) : (
              <div className="empty">
                <Radio />
                <div>
                  <strong>{tr("Waiting for rehearsal")}</strong>
                  <p>{tr("Cue events will appear here when you start.")}</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
const root = createRoot(document.getElementById("root")!);
async function openStudio() {
  root.render(<main className="library-startup" role="status">{tr("Opening scene library…")}</main>);
  try {
    await openDesktopLibrary();
    root.render(<Studio />);
  } catch (error) {
    root.render(<main className="library-startup" role="alert">
      <p>{tr("Could not open the scene library.")} {String(error)}</p>
      <button onClick={() => void openStudio()}>{tr("Retry")}</button>
    </main>);
  }
}
void openStudio();
