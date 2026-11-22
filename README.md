# Stagecue

Stagecue is a local React and TypeScript rehearsal studio. In the sample Hebrew scene, **Before the curtain**, you play the actor and Ari answers with five prerecorded lines. A cue can also display an image, play a video, or wait.

## גאון–איריס elevator scene

[Download the complete scene (.srs)](https://raw.githubusercontent.com/scenemax3d/stagecue-rehearsal-studio/main/examples/elevator/Gaon-Iris.srs). In Stagecue 1.3 or later, choose **Open Scene file**, select the downloaded file, and choose either גאון or איריס under **Active script**. Both roles, their generated Hebrew dialogue, the illustrations, and the SceneMax elevator animation travel together. Cue 6 triggers the shake at **היא רועדת**.

## Try a rehearsal

1. Open **http://127.0.0.1:5173/**. Use the same browser and address each time to access your saved scripts and uploads.
2. Choose **Local Hebrew ASR**, click **Start rehearsal**, and allow microphone access. Say **שלום ארי**. After Ari finishes answering, read the next highlighted line. Headphones help keep Ari out of the microphone.
3. To practice the controls without a microphone, stop the rehearsal, choose **Simulator**, start, and click **Simulate**. Leave the text field empty to send the current line or enter a different hypothesis to test the threshold.
4. Click a cue to jump or rearm it. The transport controls pause/resume, stop playback and microphone capture, replay the last cue, fire the current cue manually, and restart the scene. Clicking the next cue skips the current cue's actions. **Hide script** conceals the prompt and cue sheet.

## Run locally

Requires Node 22.12+ and Python 3.10. On Windows, from the repository root:

```powershell
npm.cmd ci
py -3.10 -m venv .venv
.\.venv\Scripts\python -m pip install -r service/requirements.txt
npm.cmd run studio
```

The combined launcher starts Vite on port 5173 and the loopback speech server on port 8765. Wait for **Local Hebrew streaming ASR ready**. Ctrl+C stops both when using this launcher. For the editor, simulator, or browser speech alone, use `npm.cmd run dev`. To start only ASR, use `.\.venv\Scripts\python service/asr.py`.

The first startup downloads about 72 MB of Hebrew model files. Subsequent sessions can run offline with `HF_HUB_OFFLINE=1`. The server runs a quantized Hebrew Zipformer on the local CPU. Audio stays in memory on this computer. The weights are by thewh1teagle, trained on ivrit.ai audio and licensed under CC BY 4.0. [Hebrew streaming model and attribution](https://huggingface.co/thewh1teagle/zipformer2-66m-streaming-he)

For other languages the service loads the original local multilingual Whisper recognizer on demand. To compare that decoder on Hebrew, set `CUE_ASR=whisper` before starting the service. `CUE_MODEL` selects its multilingual model (default `small`). The Whisper model must already be cached for offline use. [Whisper model](https://huggingface.co/Systran/faster-whisper-small)

## Scene Editor and media

Create or duplicate a script, add human and virtual turns, reorder the sequence, and save. Human turns wait for speech. Virtual turns automatically run their recorded actions. Configure speakers, expected text, alternatives and action order. Advanced settings expose cue IDs, next-state references and typed action JSON. Recognition settings contain the remaining matching and microphone parameters. **Test cue** previews the selected actions.

In the Scene Editor, use **Export Scene File** to share a scene with its scripts, recordings, local media and optional SceneMax attachments. Use **Open Scene file** to load an editable copy from a `.srs` archive. Earlier single-script scene files also open here.

The example is in `public/example-show.json`. Its five bundled WAV files are prerecorded Hebrew using the Windows Asaf voice. The stage backdrop is a generated image. The structural JSON Schema is in `public/show.schema.json`. The runtime validator also checks graph reachability, duplicate IDs, broken references, asset types and linear transitions. Schema version 1.0 supports one next state per cue.

## Recognition and cue timing

A 16 kHz Web Audio context resamples microphone input. An AudioWorklet supplies mono PCM frames. After speech starts, the client sends frames plus a short preroll to the loopback WebSocket. The Hebrew recognizer processes audio while the actor speaks. After 128 ms of quiet, it decodes the remaining audio and returns a provisional transcript. Streaming and final transcripts use the same word-matching rule. The recognizer has no access to the script.

When speech resumes, stale provisional results are discarded and recognition continues with the original audio. A recognized prefix of the current line keeps the utterance open for at least 1.5 seconds so an intentional mid-line pause can resolve. Other uncertain matches wait for the configured endpoint (400 ms by default). Browser speech remains selectable and may use an online service.

The protocol starts with start/ready negotiation. Streaming clients send begin (utteranceId), binary mono 16-bit PCM, probe (sequence number), resume when speech continues, and endpoint. Responses carry partial/final text, utterance ID and decoder duration. Stop closes the stream. The previous endpoint-only protocol remains supported.

The matcher aligns transcript words in order with the current cue and each alternative after normalizing punctuation, whitespace and Hebrew marks. A phrasing qualifies at 70% word coverage with evidence of the last required word. Exact words earn full credit. Between two exact words, a transcript word aligned to a different scripted word earns half credit. Omitted words earn none. A finalized transcript word aligned as a substitution at that position counts toward coverage and stays highlighted as different. A missing ending still waits. Optional spans marked with `#` are excluded, as are stage directions on scripted turns. A word’s highlight reports its alignment with the transcript. Stagecue does not receive a per-word confidence value.

A successful match disarms the state before its actions start. Playback completion arms the next cue. Execution IDs, utterance IDs and state-entry generations guard against duplicate and stale results. Playback gates microphone matching by default. With gating disabled, the next completed line can be buffered during playback. Manual jumps clear history. Playback errors release the microphone and display a recovery message. Legacy emit_ws placeholders are logged and skipped. Use a SceneMax broadcast for the Zig multiplayer server.

**Match diagnostics** shows the latest transcript decisions, word coverage and historical context, and endpoint, ASR, dispatch and media-onset timings. Endpoint-to-onset p50/p95 appear when a local speech cue plays media. Here, endpoint estimates the last above-threshold speech frame and onset uses the browser playing event. The panel separates the silence wait and final decoder work. Physical microphone and speaker buffering are outside this measurement.

On the development laptop, Edge replayed five Hebrew Windows Asaf recordings through the microphone capture path. The old local provider fired four of five cues, with waits of 3.24–3.64 seconds, and split the two-sentence cue at its pause. After service readiness, the streaming provider fired all five cues on each of two runs. All ten transcripts matched after normalization. End-of-speech to playback was 188–253 ms (median 197 ms). Replaying cue 2 while cue 1 was armed produced no response. These fixtures measure the software path on this machine. Live actors, room noise, and browser-provider accuracy require separate evaluation.

For a repeatable local comparison, run `node scripts/bench-local.mjs path/to/actor1.wav path/to/actor2.wav ...` with the studio running. Provide one spoken WAV per sample cue, in sequence, padded with leading and trailing silence. The harness feeds each through Edge's microphone capture, the selected local server, the matcher and real response playback. It reports missed cues separately from latency. CUE_BENCH_PORT selects a second local server for comparisons.

## Parallel cues and SceneMax

In **Scene Editor**, select a cue and choose **Run in parallel** under **Action timing**. Upload an image in **Media library**, then select it from **Add action**. Add **YouTube clip** and paste a watch or share link. Add **SceneMax broadcast** and enter the event name and optional message. Save the script. **Test cue** performs the configured actions, including the broadcast.

Images and YouTube clips share the stage monitor. They stay on screen while rehearsal advances until another visual cue replaces them, you jump, or you stop. A YouTube link needs internet access and a video that permits embedding. Use the embedded play control if the browser blocks autoplay. Audio, local video and timed actions finish before the next turn is armed. A sequential cue retains its original action order.

Stagecue routes every scene through its bundled local server, including imported scripts. Choose or enter the event name on the cue.

Start the SceneMax player in the same room. For example, configure the Stagecue event as `animation_cue` and the message as `lift_shakes`. In the player, put your existing animation commands in a handler for that event:

```scenemax
network.on ("animation_cue", msg) = do
  sys.print msg
end do
```

Stagecue authenticates over the gateway, waits for room synchronization, and sends the native broadcast packet. The session log reports send attempts and failures. The relay does not acknowledge whether a projector performed an animation.

## Troubleshooting

- **Microphone denied** — allow microphone access for the local address in the browser and Windows privacy settings, then start again. A regular Edge or Chrome window can be used if an embedded preview restricts permissions.
- **Local ASR offline** — check the speech-service terminal, its model cache and port 8765. Restart a rehearsal to reconnect. Simulator mode works immediately.
- **Missed line** — inspect the recognized text and current/context scores. Add an alternate phrasing for a recurring variation. Increase endpointSilenceMs for dramatic pauses or lower vadThreshold for quiet delivery. Manual cue firing is always available while listening.
- **Missing or unplayable media** — open the media library and reconnect the referenced filename. Use a browser-supported codec and test the cue.
- **Port already in use** — the app may already be running. Open the local link first.

## Verification

```powershell
npm.cmd test
npm.cmd run test:browser
npm.cmd run build
```

Unit tests exercise Hebrew normalization, alternatives, history scoring, terminal evidence, deduplication, manual transport and show validation. The Playwright suite runs against installed Microsoft Edge by default. Set CUE_BROWSER to another installed Chromium channel if needed. Browser tests use isolated storage.


In the גאון ואיריס rehearsal, Gaon uses the Windows Asaf Hebrew voice. Iris's 14 partner recordings use speaker 0 of thewh1teagle's Noa Hebrew Piper model with Renikud pronunciation. The WAV files play locally. [Noa voice model (CC BY 4.0)](https://huggingface.co/thewh1teagle/piper-he-noa) · [Renikud](https://huggingface.co/renikud/renikud)

### Local elevator demonstration

Run `npm run studio` and open the studio at `http://127.0.0.1:5173` in a WebGPU-capable browser. The elevator rehearsals load the actual SceneMax WebAssembly projector inside the stage monitor. The launcher prepares the web scene from `examples/elevator` and starts its loopback Zig server and WebSocket gateway alongside speech recognition and Vite. Use the expand button for a full-screen scene. Pick either elevator rehearsal from the active script menu.

The launcher expects the SceneMax checkout in `C:/dev/scenemax_desktop` (override with `SCENEMAX_DESKTOP`). It uses the installed prebuilt web runtime or a local installer build. Set `SCENEMAX_WEB_RUNTIME` to select a specific runtime directory. To refresh the web assets for a static studio build, run `node scripts/prepare-scenemax.mjs` before building. The web player downloads its runtime from localhost.

[Start at Iris’s elevator speech as Gaon](http://127.0.0.1:5173/?show=gaon-iris-gaon-elevator&cue=turn-06) or [perform Iris’s turn yourself](http://127.0.0.1:5173/?show=gaon-iris-iris-elevator&cue=turn-06). Choose **Simulator** for a microphone-free test. As Gaon, **Start rehearsal** plays Iris’s complete turn. The recorded pause before **היא רועדת** dispatches the shake as her final phrase plays. As Iris, completing the turn dispatches the same event. The elevator doors shake for about 1.2 seconds and settle, ready for another run. Select turn 01 to rehearse from the beginning.
Both elevator rehearsals use four illustrations from the supplied script. Stagecue sends the current shot when a turn starts, including after a jump. SceneMax holds the shot across consecutive turns that share it. The outdoor meeting opens the scene, turn 05 introduces the lift, and turn 08 takes the audience inside. Turn 11 cuts to the magnifying glass and puddle. Turn 27 cuts in twice on Ray for the accusation. The projector listens for `picture_meeting`, `picture_lift`, `picture_cabin`, `picture_evidence`, `picture_clue`, `picture_iris`, and `picture_ray`. The separate `elevator_shake` message animates the illustrated doors during Iris's line.

### Windows installer

Build on x64 Windows using Inno Setup 6, the .NET Framework C# compiler, the SceneMax desktop checkout and its built web runtime, and the studio's tested 64-bit Python 3.10 environment. Install the npm dependencies with `npm ci`. The builder uses the Visual Studio x64 CRT redistributable folder or the path in `STAGECUE_VC_REDIST`. Run `pwsh -File installer/build.ps1` from this repository. The initial build downloads the embedded Python distribution, the WebView2 SDK and offline runtime installer, and the pinned ASR snapshots. The output is `release/Stagecue-Setup-x64.exe`. Use a fresh build workspace for release builds. End-user machines do not need these build tools or the SceneMax checkout.

[Windows user guide and scene import instructions](installer/User-guide.md).

The installer defaults to Hebrew. For an English-default build run `pwsh -File installer/build.ps1 -DefaultLanguage en`. The Inno compiler define `StudioLanguage` also accepts `he`, `en`, `de` and `es`. An existing user preference takes precedence.

For **Text to speech** in development, install the speech dependencies in the Python 3.10 virtual environment and run `.venv/Scripts/python.exe installer/prepare_tts.py` once to stage the pinned models. Vite starts the loopback speech worker. The desktop installer includes Noa, Omer (Pocket TTS with the Hebrew adapter), and Renikud pronunciation. Both voices generate new lines offline. Speed and pitch settings are saved per cue and baked into the shared audio.

Build the Hebrew-only Windows installer with `pwsh -File installer/build.ps1 -HebrewOnly`. It includes local Hebrew recognition, Noa and Omer, offline WebView2 setup, and the two-role elevator scene. The default output is `release/Stagecue-Setup-HebrewOnly-x64.exe`. Both installer editions share the user workspace and run one at a time.
