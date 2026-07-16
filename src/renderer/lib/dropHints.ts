export type DropTone = "idle" | "text" | "pdf" | "image" | "doc" | "spreadsheet" | "code" | "unknown" | "success" | "error";

export type DropHintKind = Exclude<DropTone, "idle" | "success" | "error">;

export type DropHint = {
  kind: DropHintKind;
  tone: DropTone;
  label: string;
  shortLabel: string;
};

const textPattern = /\.(txt|md|markdown|rtf)$/i;
const codePattern = /\.(c|cc|cpp|cs|css|go|html|java|js|jsx|json|mjs|py|rb|rs|sh|sql|tsx?|xml|yaml|yml)$/i;
const spreadsheetPattern = /\.(csv|tsv|xls|xlsx)$/i;

export function inferDropHint(dataTransfer: DataTransfer): DropHint {
  const items = Array.from(dataTransfer.items);
  const files = Array.from(dataTransfer.files);
  const typeHints = [...items.map((item) => item.type), ...files.map((file) => file.type)];
  const nameHints = files.map((file) => file.name.toLowerCase());

  if (typeHints.some((type) => type.startsWith("image/")) || nameHints.some((name) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name))) {
    return { kind: "image", tone: "image", label: "Image", shortLabel: "IMG" };
  }

  if (typeHints.includes("application/pdf") || nameHints.some((name) => name.endsWith(".pdf"))) {
    return { kind: "pdf", tone: "pdf", label: "PDF", shortLabel: "PDF" };
  }

  if (
    typeHints.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
    typeHints.includes("application/msword") ||
    nameHints.some((name) => name.endsWith(".docx") || name.endsWith(".doc"))
  ) {
    return { kind: "doc", tone: "doc", label: "Document", shortLabel: "DOC" };
  }

  if (
    typeHints.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ||
    typeHints.includes("application/vnd.ms-excel") ||
    typeHints.includes("text/csv") ||
    nameHints.some((name) => spreadsheetPattern.test(name))
  ) {
    return { kind: "spreadsheet", tone: "spreadsheet", label: "Spreadsheet", shortLabel: "XLS" };
  }

  if (nameHints.some((name) => codePattern.test(name))) {
    return { kind: "code", tone: "code", label: "Code", shortLabel: "CODE" };
  }

  if (typeHints.some((type) => type.startsWith("text/")) || nameHints.some((name) => textPattern.test(name))) {
    return { kind: "text", tone: "text", label: "Text", shortLabel: "TXT" };
  }

  return { kind: "unknown", tone: "unknown", label: "File", shortLabel: "FILE" };
}
