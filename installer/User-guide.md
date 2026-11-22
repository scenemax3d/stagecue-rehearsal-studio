# Stagecue Rehearsal Studio for Windows

Launch Stagecue from the Start menu. Closing its window stops its local services. The app includes the Hebrew recognizer, a multilingual Whisper fallback in the full edition, prerecorded partner audio, the SceneMax WebGPU projector, the multiplayer relay and the browser gateway. Local recognition runs offline. Browser speech and YouTube depend on external services. SceneMax rendering requires a WebGPU-capable graphics driver. The installer targets 64-bit Windows 10 build 19041 or later and includes the offline Microsoft WebView2 installer.

## Updating Stagecue

Close Studio and run setup under the same Windows account. Both desktop editions use `%LOCALAPPDATA%\Stagecue\Workspace\Library`. The installer updates a separate program folder.

The library contains a JSON catalog, scene folders with dialogue and cue JSON, media files, and shared SceneMax packages. To back up the entire library, close Studio and copy the Library folder. Use Open Scene file and Export Scene File to exchange individual scenes.

On first launch with this version, Studio copies existing scenes from the earlier WebView workspace. It publishes the new catalog after copying the media and SceneMax attachments. Subsequent launches read the folder library directly. The original WebView data is retained as a migration backup.

## Attach a scene to a play

1. In SceneMax, export the complete scene for **Web**. Keep the export ZIP intact, including its manifest. Alternatively select a project folder containing a single entry named `scripts/main.smx` or `scripts/main` and its resource tree.
2. In **Scene Editor → SceneMax attachment for this script**, choose **Scene ZIP** or **Scene folder**. Wait for the attached filename and click **Save scene**. Each rehearsal script can have its own scene.
3. Add a **SceneMax** action to the relevant cue. Choose the event your scene handles or enter a custom event name. Expand Advanced settings on the action to supply an optional message. Stagecue connects the cue and the embedded player to its bundled local server automatically.
4. Return to Rehearsal and start the scene. The stage monitor runs the installed SceneMax runtime with the imported scripts and resources.

For example, a scene can listen for a cue named `lights_amber`:

```text
network.on ("lights_amber", msg) = do
  UI.stage.overlay.backdrop.image = "sprites/scenery/amber.png"
end do
```

This example assumes the scene has loaded a UI named `stage` with the indicated layer and image widget. Register cue handlers during startup. Include each referenced image, model, audio file, secondary script and effect dependency in the scene. For projects with a custom entry point, asset aliases, or effect distortion, use the Web export so its manifest supplies those settings. The player mounts the export's game data and uses its own installed runtime. A project that needs newer SceneMax language or rendering features requires a compatible player update.

## Share or back up a rehearsal

In Scene Editor choose **Export Scene File**. Share the resulting `.srs` with students. In the rehearsal studio choose **Open Scene file** to open a downloaded package. Each import creates a separate editable copy. A StageCue file is a ZIP containing the show, its local recordings and media, and its attached SceneMax scripts and resources. Linked services such as YouTube still require network access. Earlier single-script .srs files also open in the Scene Editor.

In General settings choose the interface language: עברית, English, Deutsch or Español. This preference is independent of the rehearsal language and stays on the student's machine.

## Runtime components

The installed HTTP host, ASR service, browser gateway and Zig relay listen on loopback ports 21870, 21871, 21872 and 21873 respectively. Startup diagnostics are in `%LOCALAPPDATA%\Stagecue\Workspace\studio.log`.

The demonstration uses the user-supplied Gaon–Iris play and illustrations. Iris’s local recordings use thewh1teagle’s [Noa Hebrew Piper voice (CC BY 4.0)](https://huggingface.co/thewh1teagle/piper-he-noa) with [Renikud](https://huggingface.co/renikud/renikud). Local recognition uses [Hebrew Zipformer](https://huggingface.co/thewh1teagle/zipformer2-66m-streaming-he) and [faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small). Component notices are included with the installed files.

A scene can contain several scripts. Choose **Add script** in Scene Editor to create one, or **Duplicate script** to make a variation. Each script has its own cues, media and optional SceneMax attachment. Choose the script in the rehearsal screen before starting. Under **Cue actions**, select an action type and choose **Add action**. Use the up and down arrows to reorder actions. Sequential playback follows the rows from top to bottom. Use the trash icon at the far right of a row to delete that action. **Export Scene File** includes all scripts.

In the cue editor, **Play audio**, **Show image**, and **Play video** each take a file. Choose an existing file from the script library or use **Browse files…** in the action row. Browsed files travel with the exported scene. For **Wait**, enter a duration in seconds, such as 0.25 for a quarter of a second.

**Text to speech** speaks Hebrew locally at rehearsal time. Enter the line, choose Noa or Omer, adjust speed and pitch, and save. The default scene stores the text and voice. **Generate speech** optionally embeds a WAV for immediate playback, as in older scenes.

The Hebrew-only edition includes the גאון–איריס elevator rehearsal and a shareable copy in the installation’s `examples/Gaon-Iris.srs` file. Its local recognizer accepts Hebrew dialogue. The interface language is configured separately.
