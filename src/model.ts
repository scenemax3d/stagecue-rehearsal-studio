import { lineParts } from "./lineMatch";
import { youtubeEmbed } from "./youtube";
import { z } from "zod";
const id = z.string().trim().min(1);
const score = z.number().min(0).max(1);
const ms = z.number().int().min(0).max(3600000);
export const recognition = z.object({
  provider: z
    .enum(["mock", "browser", "local-hebrew-asr"])
    .default("local-hebrew-asr"),
  windowSize: z.number().int().min(0).max(20).default(3),
  maxHistoryAgeMs: ms.default(30000),
  currentLineWeight: score.default(0.7),
  historyWeight: score.default(0.3),
  matchThreshold: score.default(0.82),
  minCurrentLineScore: score.default(0.65),
  requireTerminalEvidence: z.boolean().default(true),
  endpointSilenceMs: ms.min(100).default(400),
  vadThreshold: score.default(0.012),
  gateMicDuringPlayback: z.boolean().default(true),
  cooldownMs: ms.default(220),
});
const asset = z.object({
  id,
  type: z.enum(["audio", "video", "image"]),
  uri: z
    .string()
    .regex(/^assets\/(?!.*\.\.)(?!.*[\\:]).+$/, "Use an assets/ relative path"),
});
const wireText = (max: number) =>
  z
    .string()
    .refine(
      (s) => !s.includes("\0") && new TextEncoder().encode(s).length <= max,
      "Text exceeds the SceneMax packet field",
    );
const room = z.object({
  gateway: z
    .string()
    .url()
    .regex(/^wss?:\/\//, "Use the ws:// or wss:// browser gateway URL"),
  projectGuid: wireText(63).refine(Boolean, "Enter a project GUID"),
  sessionId: z.number().int().min(0).max(4294967295),
  scene: wireText(127).refine(Boolean, "Enter a scene name"),
});
const action = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("youtube"),
    url: z
      .string()
      .refine((s) => !!youtubeEmbed(s), "Enter a YouTube video link"),
  }),
  z.object({
    type: z.literal("scenemax"),
    event: wireText(1189).refine(Boolean, "Enter an event name"),
    message: wireText(1189),
  }),
  z.object({
    type: z.literal("play_audio"),
    assetId: id,
    volume: score.optional(),
    delayMs: ms.optional(),
  }),
  z.object({
    type: z.literal("play_video"),
    assetId: id,
    delayMs: ms.optional(),
  }),
  z.object({
    type: z.literal("show_image"),
    assetId: id,
    durationMs: ms.optional(),
  }),
  z.object({
    type: z.literal("text_to_speech"),
    text: id.max(2000),
    voice: z.enum(["noa", "omer", "asaf"]),
    speed: z.number().min(0.75).max(1.5).optional(),
    pitch: z.number().min(-6).max(6).optional(),
    assetId: z.string().min(1, "Generate speech for this action."),
  }),
  z.object({ type: z.literal("wait"), durationMs: ms }),
  z.object({
    type: z.literal("emit_ws"),
    event: id,
    payload: z.record(z.string(), z.unknown()).default({}),
  }),
]);
const state = z.object({
  id,
  kind: z.enum(["human_line", "virtual_line"]),
  actor: id,
  expectedText: z.string(),
  scriptedTurn: z.boolean().optional(),
  alternatives: z.array(id).default([]),
  trigger: z
    .object({
      mode: z.literal("composite").default("composite"),
      threshold: score.optional(),
      minCurrentLineScore: score.optional(),
      requireTerminalEvidence: z.boolean().optional(),
      requireCurrentLine: z.boolean().default(true),
    })
    .default({ mode: "composite", requireCurrentLine: true }),
  sceneEntryEvent: wireText(1189).refine(Boolean).optional(),
  actionMode: z.enum(["sequential", "parallel"]).optional(),
  actions: z.array(action).default([]),
  nextStateId: id.nullable(),
});
export const structure = z.object({
  schemaVersion: z.literal("1.0"),
  showId: id,
  collection: z.object({ id, title: id }).optional(),
  title: id,
  language: id.default("he-IL"),
  version: id.default("1.0"),
  startStateId: id,
  recognition,
  sceneMax: room.optional(),
  scenePackage: z
    .object({ id: z.string().regex(/^[a-f0-9]{64}$/), name: id })
    .optional(),
  assets: z.array(asset),
  states: z.array(state).min(1),
});
export type Show = z.infer<typeof structure>;
export type Turn = Show["states"][number];
export type Action = Turn["actions"][number];
export const schema = structure.superRefine((s, c) => {
  const issue = (message: string) => c.addIssue({ code: "custom", message });
  if (s.scenePackage && !s.sceneMax)
    issue("The attached scene needs a SceneMax connection.");
  for (const group of [s.states, s.assets])
    if (new Set(group.map((i) => i.id)).size !== group.length)
      issue("IDs must be unique within cues and within assets.");
  if (!s.recognition.currentLineWeight)
    issue("Current line weight must be positive.");
  for (const t of s.states) {
    if (t.kind === "human_line" && !/[\p{L}\p{N}]/u.test(t.expectedText))
      issue(t.id + " needs an actor line.");
    if (
      t.kind === "virtual_line" &&
      !t.actions.some(
        (a) =>
          a.type === "play_audio" ||
          a.type === "play_video" ||
          a.type === "text_to_speech",
      )
    )
      issue(t.id + " needs an audio, video or text-to-speech response.");
    if (
      t.kind === "human_line" &&
      t.expectedText.includes("#") &&
      !lineParts(t.expectedText, t.scriptedTurn).some((p) => p.kind === "word")
    )
      issue(t.id + " needs at least one required spoken word.");
    if (t.nextStateId && !s.states.some((n) => n.id === t.nextStateId))
      issue(t.id + " has a missing next cue.");
    if (t.sceneEntryEvent && !s.sceneMax)
      issue("Configure the SceneMax connection");
    for (const a of t.actions) {
      if (a.type === "scenemax") {
        if (!s.sceneMax) issue("Configure the SceneMax connection");
        if (new TextEncoder().encode(a.event + "\0" + a.message).length > 1190)
          issue(t.id + " exceeds the SceneMax event packet limit");
      }
    }
    for (const a of t.actions)
      if (
        "assetId" in a &&
        !s.assets.some(
          (b) =>
            b.id === a.assetId &&
            b.type ===
              {
                text_to_speech: "audio",
                play_audio: "audio",
                play_video: "video",
                show_image: "image",
              }[a.type],
        )
      )
        issue(t.id + " has a missing or incompatible asset: " + a.assetId);
  }
  const seen = new Set<string>();
  let p: string | null = s.startStateId;
  while (p && !seen.has(p)) {
    seen.add(p);
    const t = s.states.find((n) => n.id === p);
    if (!t) {
      issue("Missing cue " + p);
      break;
    }
    p = t.nextStateId;
  }
  if (p && s.states.some((t) => t.id === p))
    issue("The MVP requires a linear sequence without cycles.");
  for (const t of s.states)
    if (!seen.has(t.id)) issue("Unreachable cue " + t.id);
});
