type OutputDevices = MediaDevices & {
  setPreferredSinkId?: (id: string) => Promise<void>;
};

const key = "stagecue.audio-output";
export const selectedOutput = () => localStorage.getItem(key) || "";
const devices = navigator.mediaDevices as OutputDevices | undefined;
const activeMedia = new Set<HTMLMediaElement>();

// WebView2 routes the whole page, including its embedded players. Ordinary
// browsers without page routing can still route Stagecue's own media elements.
export async function selectOutput(id: string) {
  if (devices?.setPreferredSinkId) {
    await devices.setPreferredSinkId(id);
  } else {
    const probe = document.createElement("audio");
    if (id || probe.setSinkId) await probe.setSinkId(id);
    await Promise.all([...activeMedia].map(m => applySink(m, id)));
  }
  localStorage.setItem(key, id);
}

async function applySink(media: HTMLMediaElement, id: string) {
  if ((media.sinkId || "") !== id) await media.setSinkId(id);
}

export async function routeMedia(media: HTMLMediaElement) {
  activeMedia.add(media);
  try {
    if (!devices?.setPreferredSinkId) await applySink(media, selectedOutput());
  } catch (error) {
    activeMedia.delete(media);
    throw error;
  }
}

export function releaseMedia(media: HTMLMediaElement) {
  activeMedia.delete(media);
}

export async function restoreOutput() {
  const id = selectedOutput();
  if (!id) return;
  try {
    await selectOutput(id);
  } catch {
    await selectOutput("");
  }
}
