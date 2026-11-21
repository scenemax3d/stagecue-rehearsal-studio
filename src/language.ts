import messages from "./interface-text.json";
export const languages = {
  he: "עברית",
  en: "English",
  de: "Deutsch",
  es: "Español",
};
export type Language = keyof typeof languages;
declare global {
  interface Window {
    stagecueDefaultLanguage?: Language;
  }
}
const saved =
  localStorage.getItem("stagecue.interface-language") ||
  window.stagecueDefaultLanguage ||
  "en";
export let language: Language = Object.hasOwn(languages, saved)
  ? (saved as Language)
  : "en";
function apply() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "he" ? "rtl" : "ltr";
  document.title = "Stagecue · " + tr("Rehearsal studio");
}
export function switchLanguage(value: Language) {
  language = value;
  localStorage.setItem("stagecue.interface-language", value);
  apply();
}
export function tr(key: string): string {
  if (language === "en") return key;
  return (
    (messages as Record<string, string[]>)[key]?.[
      { he: 0, de: 1, es: 2 }[language]
    ] ?? key
  );
}
export function message(value: string): string {
  if (value.startsWith("Error: ") && language !== "en")
    return message(value.slice(7));
  const exact = tr(value);
  if (exact !== value || language === "en") return exact;
  for (const key of [
    "Rehearsal started",
    "Cue fired",
    "Selected",
    "Replay",
    "Missing file:",
    "Import failed:",
  ]) {
    if (value.startsWith(key + " "))
      return tr(key) + value.slice(key.length).split(" · ").map(tr).join(" · ");
  }
  return value;
}
apply();
