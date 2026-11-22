export const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/['"״׳’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

export type LinePart = {
  text: string;
  kind: "word" | "optional" | "direction" | "punctuation";
};
export function lineParts(text: string, scripted = false): LinePart[] {
  const parts: LinePart[] = [];
  for (const section of scripted
    ? text.split(/(\([^)]*\)|\[[^\]]*\])/g)
    : [text]) {
    if (scripted && /^[([]/.test(section) && /[)\]]$/.test(section)) {
      parts.push({ text: section, kind: "direction" });
      continue;
    }
    for (const chunk of section.split(/(#[^#]+#)/g)) {
      if (chunk.length > 1 && chunk.startsWith("#") && chunk.endsWith("#")) {
        parts.push({ text: chunk.slice(1, -1), kind: "optional" });
      } else {
        for (const token of chunk.split(
          /([\p{L}\p{N}][\p{L}\p{M}\p{N}'"״׳’]*)/gu,
        ))
          if (token)
            parts.push({
              text: token,
              kind: normalize(token) ? "word" : "punctuation",
            });
      }
    }
  }
  return parts;
}
export function displayText(text: string) {
  return text.replace(/#([^#]+)#/g, "$1");
}

export type WordMark = "heard" | "unheard" | "pending";
export function alignLine(parts: LinePart[], raw: string) {
  const tokens = parts.filter(
    (p) => p.kind === "word" || p.kind === "optional",
  );
  const spoken = raw.split(" ").filter(Boolean);
  const width = spoken.length + 1;
  const steps = new Uint8Array((tokens.length + 1) * width);
  let prev = Array.from({ length: width }, (_, j) => j);
  // Trace the minimum word-edit alignment. An optional span consumes zero or
  // more transcript words at its position, including a mistaken transcription.
  const pair = 1,
    omit = 2,
    extra = 3,
    ignore = 4;
  for (let i = 1; i <= tokens.length; i++) {
    const optional = tokens[i - 1].kind === "optional";
    const expected = normalize(tokens[i - 1].text);
    const row = [prev[0] + Number(!optional)];
    steps[i * width] = omit;
    for (let j = 1; j < width; j++) {
      const same = expected === spoken[j - 1];
      const diagonal = optional ? Infinity : prev[j - 1] + (same ? 0 : 1);
      const skip = prev[j] + Number(!optional);
      const insert = row[j - 1] + Number(!optional);
      const cost = Math.min(diagonal, skip, insert);
      // On ties, leave a repeated word available to the earlier scripted word.
      const step =
        cost === skip
          ? omit
          : cost === diagonal
            ? pair
            : optional
              ? ignore
              : extra;
      steps[i * width + j] = step;
      row[j] = cost;
    }
    prev = row;
  }
  const marks: WordMark[] = tokens.map(() => "pending");
  const endingIndex = tokens.findLastIndex(t => t.kind === "word");
  let endingSubstitution = false;
  let hasExactWordToRight = false;
  let pendingSubstitutions = 0;
  let anchoredSubstitutions = 0;
  const kept = spoken.map(() => true);
  let i = tokens.length,
    j = spoken.length,
    lastAligned = -1;
  while (i > 0) {
    const step = steps[i * width + j];
    if (step === pair) {
      lastAligned = Math.max(lastAligned, i - 1);
      marks[i - 1] =
        normalize(tokens[i - 1].text) === spoken[j - 1] ? "heard" : "unheard";
      // Traceback runs right to left. Credit substitutions only once exact
      // words anchor both sides. An omitted word never enters this count.
      if (marks[i - 1] === "heard") {
        anchoredSubstitutions += pendingSubstitutions;
        pendingSubstitutions = 0;
        hasExactWordToRight = true;
      } else if (hasExactWordToRight) {
        pendingSubstitutions++;
      }
      if (i - 1 === endingIndex && marks[i - 1] === "unheard") {
        // An optional span can tie with a substitution during alignment.
        // Its own words cannot stand in for the mandatory ending.
        let start = endingIndex;
        while (start > 0 && tokens[start - 1].kind === "optional") start--;
        endingSubstitution = !tokens.slice(start).some(t =>
          t.kind === "optional" && normalize(t.text).split(" ").includes(spoken[j - 1])
        );
      }
      i--;
      j--;
    } else if (step === omit) i--;
    else {
      if (step === ignore) kept[j - 1] = false;
      j--;
    }
  }
  const words = tokens.filter((t) => t.kind === "word");
  return {
    endingSubstitution,
    anchoredSubstitutions,
    line: words.map((p) => normalize(p.text)).join(" "),
    input: spoken.filter((_, k) => kept[k]).join(" "),
    marks: marks.flatMap((m, k) =>
      tokens[k].kind === "word"
        ? [m === "pending" && k < lastAligned ? "unheard" : m]
        : [],
    ),
  };
}
