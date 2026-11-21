import type { Action } from "./model";

export async function synthesizeSpeech(
  { text, voice, speed, pitch }: Extract<Action, { type: "text_to_speech" }>,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch("/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed, pitch }),
    signal,
  });
  if (!response.ok) throw new Error(await response.text());
  if (!response.headers.get("content-type")?.startsWith("audio/wav"))
    throw new Error("Speech service unavailable.");
  return response.blob();
}
