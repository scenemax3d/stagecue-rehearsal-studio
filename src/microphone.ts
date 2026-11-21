const deviceKey = "stagecue.microphone";
export const microphoneId = () => localStorage.getItem(deviceKey) || "";
export function selectMicrophone(id: string) {
  if (id) localStorage.setItem(deviceKey, id);
  else localStorage.removeItem(deviceKey);
}
export function inputThreshold(scriptThreshold: number) {
  return localStorage.getItem("stagecue.quietMic") === "1"
    ? Math.min(scriptThreshold, 0.003)
    : scriptThreshold;
}
export async function openMicrophone() {
  const id = microphoneId();
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(id ? { deviceId: { exact: id } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    if (e instanceof DOMException) {
      if (e.name === "OverconstrainedError" || e.name === "NotFoundError")
        throw Error(
          "Microphone unavailable. Choose a connected microphone or System default.",
        );
      if (e.name === "NotAllowedError")
        throw Error(
          "Microphone permission denied. Allow microphone access for Stagecue and enable desktop app access in Windows microphone privacy settings.",
        );
      if (e.name === "NotReadableError")
        throw Error(
          "Windows could not open the microphone. Check its connection or select another input.",
        );
    }
    throw e;
  }
}
