import type { Show } from "./model";

export const diskLibrary = location.origin === "http://127.0.0.1:21870" &&
  !!(window as Window & {chrome?: {webview?: unknown}}).chrome?.webview;
export type LibraryData = { scripts: Show[]; removed: string[]; deletedDefaults: string[]; revision: number };
export let library: LibraryData = {scripts: [], removed: [], deletedDefaults: [], revision: 0};

export async function libraryRequest(op: string, body?: BodyInit, params: Record<string,string> = {}) {
  const response = await fetch("/api/library?" + new URLSearchParams({op, ...params}), {
    method: "POST", headers: {"X-Stagecue-Library": "1"}, body,
  });
  if (!response.ok && !(response.status === 404 && (op === "getMedia" || op === "getPackage")))
    throw Error("Scene library: " + (await response.text()).slice(0,300));
  return response;
}

export async function loadCatalog() {
  const data: LibraryData | null = await (await libraryRequest("read")).json();
  if (data) library = data;
  return data !== null;
}

export async function commitCatalog(changes: Partial<Omit<LibraryData, "revision">>) {
  const next = {...library, ...changes};
  const revision: number = await (await libraryRequest("save", JSON.stringify(next))).json();
  library = {...next, revision};
}
