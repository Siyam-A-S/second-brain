export type ParsedJsonObject = Record<string, unknown>;

const expectedJsonKeys = [
  "tool",
  "input",
  "reason",
  "items",
  "trackable",
  "title",
  "name",
  "event_name",
  "meeting_name",
  "date",
  "time",
  "start_time",
  "endTime",
  "end_time",
  "timezone",
  "location",
  "place",
  "link",
  "join_link",
  "url",
  "context",
  "description",
  "summary"
] as const;

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractObjectText(value: string): string {
  const cleaned = stripCodeFence(value);
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return cleaned.slice(objectStart, objectEnd + 1);
  }

  return cleaned;
}

function escapeControlCharsInStrings(value: string): string {
  let output = "";
  let inString = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of value) {
    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }

      if (char === quote) {
        output += char;
        inString = false;
        quote = null;
        continue;
      }

      if (char === "\n") {
        output += "\\n";
        continue;
      }

      if (char === "\r") {
        continue;
      }
    } else if (char === '"' || char === "'") {
      inString = true;
      quote = char;
    }

    output += char;
  }

  return output;
}

function repairLooseJson(value: string): string {
  return escapeControlCharsInStrings(value)
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/([{,]\s*)'([^']+)'\s*:/g, "$1\"$2\":")
    .replace(/:\s*'([^']*)'/g, (_match, inner: string) => `: ${JSON.stringify(inner)}`)
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, "$1\"$2\":")
    .replace(/,\s*([}\]])/g, "$1");
}

function parseExpectedFields(value: string): ParsedJsonObject | null {
  const result: ParsedJsonObject = {};

  for (const key of expectedJsonKeys) {
    const quotedPattern = new RegExp(`[\"']?${key}[\"']?\\s*:\\s*([\"'])([\\s\\S]*?)\\1`, "i");
    const unquotedPattern = new RegExp(`[\"']?${key}[\"']?\\s*:\\s*([^,}\\n]+)`, "i");
    const quoted = quotedPattern.exec(value);
    const unquoted = unquotedPattern.exec(value);
    const extracted = quoted?.[2] ?? unquoted?.[1];

    if (extracted?.trim()) {
      result[key] = extracted.trim();
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

export function parseLocalModelJsonObject(content: string): ParsedJsonObject {
  const objectText = extractObjectText(content);
  const attempts = [objectText, repairLooseJson(objectText)];

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as ParsedJsonObject;
      }
    } catch {
      continue;
    }
  }

  const looseFields = parseExpectedFields(objectText);
  if (looseFields) {
    return looseFields;
  }

  throw new Error(`Local AI response was not valid JSON: ${objectText.slice(0, 240)}`);
}
