import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runtimePythonCommands, withRuntimePath } from "./RuntimeCommandPaths";

export type ArtifactAstSpan = {
  text: string;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
};

export type ArtifactAstNode = {
  type:
    | "HEADING_1"
    | "HEADING_2"
    | "BODY_TEXT"
    | "BULLET_ITEM"
    | "NUMBERED_ITEM"
    | "QUOTE"
    | "SLIDE_TITLE"
    | "SLIDE_BREAK"
    | "SPACER"
    | "BAR_CHART";
  text?: string | undefined;
  spans?: ArtifactAstSpan[] | undefined;
  bold_prefix?: string | undefined;
  boldPrefix?: string | undefined;
  data?: Array<{ label?: string | undefined; value?: number | string | undefined }> | undefined;
  items?: Array<{ label?: string | undefined; value?: number | string | undefined }> | undefined;
};

export type ArtifactAstPayload = {
  meta?: {
    filename?: string | undefined;
    title?: string | undefined;
    layout_mode?: "PORTRAIT" | "LANDSCAPE" | string | undefined;
    layoutMode?: "PORTRAIT" | "LANDSCAPE" | string | undefined;
    primary_color?: string | undefined;
    primaryColor?: string | undefined;
  } | undefined;
  nodes?: ArtifactAstNode[] | undefined;
};

export type CreateToolArtifactInput = {
  filename?: string | undefined;
  title?: string | undefined;
  text?: string | undefined;
  contentBase64?: string | undefined;
  mimeType?: string | undefined;
  documentType?: string | undefined;
  astPayload?: ArtifactAstPayload | unknown;
  ast_payload?: ArtifactAstPayload | unknown;
};

export type ToolArtifactResult = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
};

function visibleBasename(value: string, fallback: string): string {
  const cleaned = (value || fallback || "artifact").replace(/\0/g, "").trim();
  const withoutTrailingSeparators = cleaned.replace(/[\\/]+$/g, "");
  const parts = withoutTrailingSeparators.split(/[\\/]+/);
  const basename = parts[parts.length - 1]?.trim() || fallback || "artifact";
  return basename === "." || basename === ".." ? fallback || "artifact" : basename;
}

function ensureExtension(filename: string, extension: string): string {
  return path.extname(filename) ? filename : `${filename}${extension}`;
}

function bufferFromInput(input: CreateToolArtifactInput, fallbackText = ""): Buffer {
  if (input.contentBase64) {
    return Buffer.from(input.contentBase64, "base64");
  }

  return Buffer.from(input.text ?? fallbackText, "utf8");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function zipStore(entries: Array<{ name: string; content: string | Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const checksum = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + content.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

const artifactGeneratorScript = String.raw`
import json
import os
import re
import sys
import unicodedata
from fpdf import FPDF

SUPPORTED_TYPES = {
    "HEADING_1",
    "HEADING_2",
    "BODY_TEXT",
    "BULLET_ITEM",
    "NUMBERED_ITEM",
    "QUOTE",
    "SLIDE_TITLE",
    "SLIDE_BREAK",
    "SPACER",
    "BAR_CHART",
}

def clean_text(value):
    text = "" if value is None else str(value)
    text = text.replace("\r", " ").replace("\t", " ")
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text)
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"__(.*?)__", r"\1", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.*?)\*(?!\*)", r"\1", text)
    text = re.sub(r"(?<!_)_(?!_)(.*?)_(?!_)", r"\1", text)
    text = re.sub(r"^\s*[-*]\s+", "", text)
    text = re.sub(r"^\s*\d+[.)]\s+", "", text)
    text = text.replace(chr(96), "")
    text = text.replace("–", "-").replace("—", "-").replace("…", "...")
    text = text.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    text = text.translate(str.maketrans({
        "•": "-",
        "▪": "-",
        "●": "-",
        "→": "->",
        "←": "<-",
        "↑": "^",
        "↓": "v",
        "×": "x",
        "−": "-",
        "≤": "<=",
        "≥": ">=",
        "≈": "~",
        "█": "#",
        "▇": "#",
        "▆": "#",
        "▅": "#",
        "▄": "#",
        "▃": "#",
        "▂": "#",
        "▁": "#",
    }))
    text = unicodedata.normalize("NFKC", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return "".join(ch for ch in text if ch == "\n" or ch == "\t" or ch == " " or ord(ch) >= 32).strip()

def latin_safe_text(value):
    return clean_text(value).encode("latin-1", errors="replace").decode("latin-1")

def first_existing(paths):
    for candidate in paths:
        if candidate and os.path.exists(candidate):
            return candidate
    return None

def basename_exact(filename):
    raw = "" if filename is None else str(filename)
    raw = raw.replace(chr(0), "").strip() or "generated_artifact.pdf"
    raw = raw.rstrip("\\/")
    base = re.split(r"[\\/]+", raw)[-1].strip() or "generated_artifact.pdf"
    if base in {".", ".."}:
        base = "generated_artifact.pdf"
    if not base.lower().endswith(".pdf"):
        base += ".pdf"
    return base

class SecondBrainCompiler(FPDF):
    def __init__(self, layout_mode="PORTRAIT", primary_color="#006666"):
        self.layout_mode = "LANDSCAPE" if str(layout_mode).upper() == "LANDSCAPE" else "PORTRAIT"
        orientation = "L" if self.layout_mode == "LANDSCAPE" else "P"
        format_size = (180, 320) if self.layout_mode == "LANDSCAPE" else "A4"
        super().__init__(orientation=orientation, unit="mm", format=format_size)
        self.set_auto_page_break(auto=self.layout_mode == "PORTRAIT", margin=18)
        margin = 14 if self.layout_mode == "LANDSCAPE" else 20
        self.set_margins(margin, margin, margin)
        self.primary_color = primary_color if re.match(r"^#[0-9a-fA-F]{6}$", str(primary_color)) else "#006666"
        self.ordered_index = 1
        self.font_family_name = "Helvetica"
        self.available_font_styles = {"", "B", "I", "BI"}
        self.unicode_font = self.register_unicode_fonts()

    def register_unicode_fonts(self):
        candidates = [
            {
                "": [
                    os.environ.get("SECOND_BRAIN_PDF_FONT_REGULAR", ""),
                    "C:/Windows/Fonts/arial.ttf",
                    "C:/Windows/Fonts/segoeui.ttf",
                    "/System/Library/Fonts/Supplemental/Arial.ttf",
                    "/Library/Fonts/Arial.ttf",
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                ],
                "B": [
                    os.environ.get("SECOND_BRAIN_PDF_FONT_BOLD", ""),
                    "C:/Windows/Fonts/arialbd.ttf",
                    "C:/Windows/Fonts/segoeuib.ttf",
                    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                    "/Library/Fonts/Arial Bold.ttf",
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                ],
                "I": [
                    os.environ.get("SECOND_BRAIN_PDF_FONT_ITALIC", ""),
                    "C:/Windows/Fonts/ariali.ttf",
                    "C:/Windows/Fonts/segoeuii.ttf",
                    "/System/Library/Fonts/Supplemental/Arial Italic.ttf",
                    "/Library/Fonts/Arial Italic.ttf",
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
                    "/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
                ],
                "BI": [
                    os.environ.get("SECOND_BRAIN_PDF_FONT_BOLD_ITALIC", ""),
                    "C:/Windows/Fonts/arialbi.ttf",
                    "C:/Windows/Fonts/segoeuiz.ttf",
                    "/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf",
                    "/Library/Fonts/Arial Bold Italic.ttf",
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf",
                    "/usr/share/fonts/truetype/noto/NotoSans-BoldItalic.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf",
                ],
            }
        ]
        for candidate in candidates:
            regular = first_existing(candidate[""])
            if not regular:
                continue
            try:
                family = "SecondBrainSans"
                self.add_font(family, "", regular)
                available = {""}
                for style in ("B", "I", "BI"):
                    font_path = first_existing(candidate[style])
                    if font_path:
                        self.add_font(family, style, font_path)
                        available.add(style)
                self.font_family_name = family
                self.available_font_styles = available
                return True
            except Exception:
                self.font_family_name = "Helvetica"
                self.available_font_styles = {"", "B", "I", "BI"}
        return False

    def pdf_text(self, value):
        text = clean_text(value)
        if self.unicode_font:
            return text
        return text.encode("latin-1", errors="replace").decode("latin-1")

    def set_doc_font(self, style="", size=11):
        normalized = "".join(ch for ch in str(style).upper() if ch in "BI")
        if normalized not in self.available_font_styles:
            if "B" in normalized and "B" in self.available_font_styles:
                normalized = "B"
            elif "I" in normalized and "I" in self.available_font_styles:
                normalized = "I"
            else:
                normalized = ""
        self.set_font(self.font_family_name, style=normalized, size=size)

    def hex_to_rgb(self, hex_str):
        value = str(hex_str).lstrip("#")
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))

    def primary_rgb(self):
        return self.hex_to_rgb(self.primary_color)

    def usable_width(self):
        return self.w - self.l_margin - self.r_margin

    def add_header(self, title):
        title = self.pdf_text(title) or "Artifact"
        r, g, b = self.primary_rgb()
        self.set_text_color(18, 24, 38)
        self.set_doc_font("B", size=24 if self.layout_mode == "PORTRAIT" else 28)
        self.multi_cell(0, 12, title)
        self.ln(2)
        self.set_draw_color(r, g, b)
        self.set_line_width(0.6)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(7)

    def ensure_space(self, height):
        if self.layout_mode == "PORTRAIT" and self.get_y() + height > self.h - self.b_margin:
            self.add_page()

    def render_spans(self, spans, size=11, line_height=6):
        self.ensure_space(line_height)
        if not isinstance(spans, list):
            spans = []
        if not spans:
            self.ln(line_height)
            return
        x0 = self.get_x()
        max_x = self.w - self.r_margin
        for span in spans:
            if not isinstance(span, dict):
                continue
            text = self.pdf_text(span.get("text", ""))
            if not text:
                continue
            style = ""
            if span.get("bold"):
                style += "B"
            if span.get("italic"):
                style += "I"
            self.set_doc_font(style, size=size)
            for word in text.split(" "):
                chunk = word + " "
                if self.get_x() + self.get_string_width(chunk) > max_x:
                    self.ln(line_height)
                    self.set_x(x0)
                self.write(line_height, chunk)
        self.ln(line_height)

    def render_multiline(self, text, size=11, style="", line_height=6, indent=0, color=None):
        text = self.pdf_text(text)
        if not text:
            self.ln(2)
            return
        self.ensure_space(line_height * 2)
        if color:
            self.set_text_color(*color)
        else:
            self.set_text_color(30, 41, 59)
        self.set_doc_font(style, size=size)
        x = self.l_margin + indent
        self.set_x(x)
        width = self.w - self.r_margin - x
        self.multi_cell(width, line_height, text)
        self.ln(1)

    def render_bullet(self, node):
        prefix = self.pdf_text(node.get("bold_prefix") or node.get("boldPrefix") or "")
        text = self.pdf_text(node.get("text", ""))
        if not prefix:
            match = re.match(r"^([A-Za-z][A-Za-z0-9 /&().-]{1,42}:)\s+(.+)$", text)
            if match:
                prefix = match.group(1)
                text = match.group(2)
        self.ensure_space(10)
        self.set_text_color(30, 41, 59)
        self.set_doc_font("", size=11)
        self.set_x(self.l_margin + 4)
        self.write(6, "- ")
        if prefix:
            self.set_doc_font("B", size=11)
            self.write(6, prefix + (" " if not prefix.endswith(" ") else ""))
        self.set_doc_font("", size=11)
        self.write(6, text)
        self.ln(7)

    def render_numbered(self, node):
        text = self.pdf_text(node.get("text", ""))
        self.ensure_space(10)
        self.set_text_color(30, 41, 59)
        self.set_doc_font("", size=11)
        self.set_x(self.l_margin + 4)
        self.multi_cell(self.usable_width() - 4, 6, f"{self.ordered_index}. {text}")
        self.ordered_index += 1
        self.ln(1)

    def render_slide_title(self, text):
        r, g, b = self.primary_rgb()
        self.set_fill_color(250, 250, 244)
        self.rect(0, 0, self.w, self.h, style="F")
        self.set_text_color(r, g, b)
        self.set_doc_font("B", size=26)
        self.set_xy(self.l_margin, self.t_margin)
        self.multi_cell(self.usable_width(), 11, self.pdf_text(text) or "Slide")
        self.ln(5)

    def chart_items(self, node):
        raw_items = node.get("data") if isinstance(node.get("data"), list) else node.get("items")
        if not isinstance(raw_items, list):
            return []
        items = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            label = self.pdf_text(item.get("label", ""))
            try:
                value = float(str(item.get("value", 0)).replace(",", "").strip())
            except Exception:
                value = 0.0
            if label and value >= 0:
                items.append((label, value))
        return items[:12]

    def render_bar_chart(self, node):
        items = self.chart_items(node)
        if not items:
            self.render_multiline(node.get("text", ""), size=11, line_height=6)
            return
        title = self.pdf_text(node.get("text", ""))
        if title:
            self.render_multiline(title, size=12, style="B", line_height=7)
        max_value = max(value for _, value in items) or 1
        r, g, b = self.primary_rgb()
        label_width = 48 if self.layout_mode == "PORTRAIT" else 68
        value_width = 20
        bar_width = max(24, self.usable_width() - label_width - value_width - 8)
        row_height = 8 if self.layout_mode == "PORTRAIT" else 9
        for label, value in items:
            self.ensure_space(row_height + 3)
            x = self.l_margin
            y = self.get_y()
            self.set_text_color(30, 41, 59)
            self.set_doc_font("", size=9 if self.layout_mode == "PORTRAIT" else 11)
            self.set_xy(x, y)
            self.cell(label_width, row_height, label[:34], border=0)
            self.set_fill_color(226, 232, 240)
            self.rect(x + label_width, y + 2, bar_width, 4, style="F")
            self.set_fill_color(r, g, b)
            self.rect(x + label_width, y + 2, bar_width * (value / max_value), 4, style="F")
            self.set_xy(x + label_width + bar_width + 4, y)
            value_label = f"{value:g}"
            self.cell(value_width, row_height, value_label, border=0, align="R")
            self.set_y(y + row_height)
        self.ln(3)

    def compile_ast(self, ast_payload):
        if not isinstance(ast_payload, dict):
            ast_payload = {}
        meta = ast_payload.get("meta") if isinstance(ast_payload.get("meta"), dict) else {}
        title = meta.get("title") or "Artifact"
        nodes = ast_payload.get("nodes") if isinstance(ast_payload.get("nodes"), list) else []
        self.add_page()
        if self.layout_mode == "PORTRAIT":
            self.add_header(title)
        else:
            self.render_slide_title(title)
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_type = str(node.get("type", "")).upper()
            if node_type not in SUPPORTED_TYPES:
                continue
            if node_type == "SLIDE_BREAK":
                if self.layout_mode == "LANDSCAPE":
                    self.add_page()
                    self.render_slide_title(title)
                continue
            if node_type == "SPACER":
                self.ln(6)
                continue
            if node_type == "SLIDE_TITLE":
                if self.layout_mode == "LANDSCAPE":
                    self.render_slide_title(node.get("text", ""))
                else:
                    self.render_multiline(node.get("text", ""), size=18, style="B", line_height=9)
                continue
            if node_type == "HEADING_1":
                self.ln(3)
                self.render_multiline(node.get("text", ""), size=16, style="B", line_height=8, color=(15, 23, 42))
            elif node_type == "HEADING_2":
                self.ln(2)
                r, g, b = self.primary_rgb()
                self.render_multiline(node.get("text", ""), size=13, style="B", line_height=7, color=(r, g, b))
            elif node_type == "BODY_TEXT":
                if isinstance(node.get("spans"), list):
                    self.render_spans(node.get("spans"), size=13 if self.layout_mode == "LANDSCAPE" else 11, line_height=7 if self.layout_mode == "LANDSCAPE" else 6)
                else:
                    self.render_multiline(node.get("text", ""), size=13 if self.layout_mode == "LANDSCAPE" else 11, line_height=7 if self.layout_mode == "LANDSCAPE" else 6)
            elif node_type == "BULLET_ITEM":
                self.render_bullet(node)
            elif node_type == "NUMBERED_ITEM":
                self.render_numbered(node)
            elif node_type == "QUOTE":
                self.render_multiline(node.get("text", ""), size=11, style="I", line_height=6, indent=5, color=(71, 85, 105))
            elif node_type == "BAR_CHART":
                self.render_bar_chart(node)

def run_generation(ast_payload, output_directory):
    meta = ast_payload.get("meta") if isinstance(ast_payload.get("meta"), dict) else {}
    filename = basename_exact(meta.get("filename") or "generated_artifact.pdf")
    filepath = os.path.join(output_directory, filename)
    compiler = SecondBrainCompiler(
        layout_mode=meta.get("layout_mode") or meta.get("layoutMode") or "PORTRAIT",
        primary_color=meta.get("primary_color") or meta.get("primaryColor") or "#006666",
    )
    compiler.compile_ast(ast_payload)
    compiler.output(filepath)
    return filepath

def main():
    if len(sys.argv) < 2:
        raise SystemExit("Output directory argument is required.")
    output_directory = sys.argv[1]
    os.makedirs(output_directory, exist_ok=True)
    ast_payload = json.load(sys.stdin)
    filepath = run_generation(ast_payload, output_directory)
    print(json.dumps({"path": filepath, "filename": os.path.basename(filepath)}, ensure_ascii=False))

if __name__ == "__main__":
    main()
`;

function stripMarkdownMarkers(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)(.*?)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_(?!_)(.*?)_(?!_)/g, "$1")
    .replace(/`+/g, "")
    .trim();
}

function parseInlineSpans(value: string): ArtifactAstSpan[] {
  const spans: ArtifactAstSpan[] = [];
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: stripMarkdownMarkers(value.slice(lastIndex, match.index)) });
    }
    const boldText = match[2] ?? match[3];
    const italicText = match[4] ?? match[5];
    if (boldText) {
      spans.push({ text: stripMarkdownMarkers(boldText), bold: true });
    } else if (italicText) {
      spans.push({ text: stripMarkdownMarkers(italicText), italic: true });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    spans.push({ text: stripMarkdownMarkers(value.slice(lastIndex)) });
  }

  return spans.filter((span) => span.text.trim());
}

function splitBoldPrefix(value: string): { boldPrefix?: string | undefined; text: string } {
  const markdownPrefix = /^\s*(?:\*\*|__)([^*_]{1,56}:)(?:\*\*|__)\s*(.+)$/s.exec(value);
  if (markdownPrefix) {
    return {
      boldPrefix: stripMarkdownMarkers(markdownPrefix[1] ?? ""),
      text: stripMarkdownMarkers(markdownPrefix[2] ?? "")
    };
  }

  const plainPrefix = /^\s*([A-Za-z][A-Za-z0-9 /&().-]{1,42}:)\s+(.+)$/s.exec(stripMarkdownMarkers(value));
  if (plainPrefix) {
    return {
      boldPrefix: plainPrefix[1]?.trim(),
      text: plainPrefix[2]?.trim() ?? ""
    };
  }

  return { text: stripMarkdownMarkers(value) };
}

function normalizeAstPayload(value: unknown): ArtifactAstPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as ArtifactAstPayload;
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  if (nodes.length === 0) {
    return null;
  }

  return {
    meta: record.meta && typeof record.meta === "object" && !Array.isArray(record.meta) ? record.meta : {},
    nodes: nodes
      .filter((node): node is ArtifactAstNode => Boolean(node && typeof node === "object" && !Array.isArray(node)))
      .map((node) => ({
        ...node,
        type: String(node.type).toUpperCase() as ArtifactAstNode["type"]
      }))
  };
}

function inferPdfLayoutMode(documentType: string, text: string): "PORTRAIT" | "LANDSCAPE" {
  return /\b(deck|presentation|slides?|pitch)\b/i.test(`${documentType} ${text}`) ? "LANDSCAPE" : "PORTRAIT";
}

function textToArtifactAst(input: {
  title: string;
  filename: string;
  text: string;
  documentType: string;
}): ArtifactAstPayload {
  const lines = applyDocumentLayout(input.text, input.title, input.documentType).replace(/\r/g, "").split("\n");
  const nodes: ArtifactAstNode[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      nodes.push({ type: "SPACER" });
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      nodes.push({
        type: heading[1]?.length === 1 ? "HEADING_1" : "HEADING_2",
        text: stripMarkdownMarkers(heading[2] ?? "")
      });
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      const split = splitBoldPrefix(bullet[1] ?? "");
      nodes.push({
        type: "BULLET_ITEM",
        bold_prefix: split.boldPrefix,
        text: split.text
      });
      continue;
    }

    const numbered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (numbered) {
      nodes.push({ type: "NUMBERED_ITEM", text: stripMarkdownMarkers(numbered[1] ?? "") });
      continue;
    }

    const quote = /^>\s+(.+)$/.exec(trimmed);
    if (quote) {
      nodes.push({ type: "QUOTE", text: stripMarkdownMarkers(quote[1] ?? "") });
      continue;
    }

    nodes.push({ type: "BODY_TEXT", spans: parseInlineSpans(trimmed) });
  }

  return {
    meta: {
      filename: input.filename,
      title: input.title,
      layout_mode: inferPdfLayoutMode(input.documentType, input.text),
      primary_color: "#006666"
    },
    nodes
  };
}

function wrapLines(value: string, max = 86): string[] {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r/g, "").split("\n")) {
    let current = paragraph.trim();
    if (!current) {
      lines.push("");
      continue;
    }

    while (current.length > max) {
      const splitAt = Math.max(24, current.lastIndexOf(" ", max));
      lines.push(current.slice(0, splitAt).trim());
      current = current.slice(splitAt).trim();
    }
    lines.push(current);
  }
  return lines;
}

type DocumentLine = {
  kind: "heading1" | "heading2" | "heading3" | "bullet" | "numbered" | "blank" | "paragraph";
  text: string;
};

function normalizedDocumentType(value: string | undefined): string {
  const normalized = (value ?? "").toLowerCase().replace(/[^a-z0-9 -]+/g, " ").trim();
  if (/cover letter|letter/.test(normalized)) {
    return "letter";
  }
  if (/resume|cv|curriculum/.test(normalized)) {
    return "resume";
  }
  if (/summary|brief/.test(normalized)) {
    return "summary";
  }
  if (/report|analysis/.test(normalized)) {
    return "report";
  }
  if (/proposal/.test(normalized)) {
    return "proposal";
  }
  if (/invoice/.test(normalized)) {
    return "invoice";
  }
  return normalized || "document";
}

function hasSectionStructure(value: string): boolean {
  return /^#{1,3}\s+\S/m.test(value) || /^\s*[-*]\s+\S/m.test(value) || /^\s*\|.+\|\s*$/m.test(value);
}

function applyDocumentLayout(text: string, title: string, documentType: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return `# ${title}\n\nGenerated artifact.`;
  }

  if (hasSectionStructure(trimmed)) {
    return /^#\s+/m.test(trimmed) ? trimmed : `# ${title}\n\n${trimmed}`;
  }

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const body = paragraphs.join("\n\n");

  if (documentType === "letter") {
    return [`# ${title}`, "", new Date().toLocaleDateString("en-US"), "", "Dear Recipient,", "", body, "", "Sincerely,", "", "[Your Name]"].join("\n");
  }

  if (documentType === "resume") {
    return [`# ${title}`, "", "## Professional Summary", "", body, "", "## Skills", "", "- Add relevant skills", "", "## Experience", "", "- Add relevant experience", "", "## Education", "", "- Add education details"].join("\n");
  }

  if (documentType === "summary") {
    return [`# ${title}`, "", "## Overview", "", body, "", "## Key Points", "", "- Main point", "- Supporting detail", "", "## Next Steps", "", "- Follow up as needed"].join("\n");
  }

  if (documentType === "proposal") {
    return [`# ${title}`, "", "## Objective", "", body, "", "## Approach", "", "- Proposed work", "", "## Deliverables", "", "- Deliverable", "", "## Timeline", "", "- Next milestone"].join("\n");
  }

  if (documentType === "report") {
    return [`# ${title}`, "", "## Executive Summary", "", body, "", "## Findings", "", "- Finding", "", "## Recommendations", "", "- Recommendation"].join("\n");
  }

  return `# ${title}\n\n${body}`;
}

function parseDocumentLines(markdown: string): DocumentLine[] {
  return markdown.replace(/\r/g, "").split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return { kind: "blank", text: "" };
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      return {
        kind: level === 1 ? "heading1" : level === 2 ? "heading2" : "heading3",
        text: heading[2]?.trim() ?? ""
      };
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      return { kind: "bullet", text: bullet[1]?.trim() ?? "" };
    }
    const numbered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (numbered) {
      return { kind: "numbered", text: numbered[1]?.trim() ?? "" };
    }
    return { kind: "paragraph", text: trimmed };
  });
}

function docxParagraph(line: DocumentLine, orderedIndex: number): string {
  if (line.kind === "blank") {
    return "<w:p/>";
  }

  const isHeading = line.kind.startsWith("heading");
  const size = line.kind === "heading1" ? "32" : line.kind === "heading2" ? "26" : line.kind === "heading3" ? "22" : "22";
  const prefix = line.kind === "bullet" ? "- " : line.kind === "numbered" ? `${orderedIndex}. ` : "";
  const runProperties = `<w:rPr>${isHeading ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr>`;
  const paragraphProperties = `<w:pPr><w:spacing w:after="${isHeading ? "180" : "100"}"/></w:pPr>`;
  return `<w:p>${paragraphProperties}<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(prefix + line.text)}</w:t></w:r></w:p>`;
}

function renderDocx(markdown: string, title: string): Buffer {
  let ordered = 1;
  const body = parseDocumentLines(markdown || `# ${title}\n\nGenerated artifact.`)
    .map((line) => docxParagraph(line, line.kind === "numbered" ? ordered++ : ordered))
    .join("");
  return zipStore([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    },
    {
      name: "word/document.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`
    }
  ]);
}

function markdownTableRows(markdown: string): string[][] {
  const tableLines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|") && !/^\|?\s*:?-{3,}/.test(line.replace(/\|/g, "")));

  return tableLines.map((line) =>
    line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim())
  );
}

function columnName(index: number): string {
  let value = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function renderXlsx(markdown: string, title: string): Buffer {
  const rows = markdownTableRows(markdown);
  const fallbackRows = parseDocumentLines(markdown || `# ${title}\n\nGenerated artifact.`)
    .filter((line) => line.kind !== "blank")
    .slice(0, 200)
    .map((line) => [line.kind.startsWith("heading") ? line.text : line.kind === "bullet" ? `- ${line.text}` : line.text]);
  const sheetRows = (rows.length > 0 ? rows : fallbackRows).slice(0, 500);
  const sheetData = sheetRows
    .map(
      (cells, rowIndex) =>
        `<row r="${rowIndex + 1}">${cells
          .map((cell, cellIndex) => `<c r="${columnName(cellIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`)
          .join("")}</row>`
    )
    .join("");
  return zipStore([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Artifact" sheetId="1" r:id="rId1"/></sheets></workbook>'
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`
    }
  ]);
}

function renderSvg(text: string, title: string): Buffer {
  if (/^\s*<svg[\s>]/i.test(text)) {
    return Buffer.from(text, "utf8");
  }

  const lines = wrapLines(text || "Generated artifact.", 58).slice(0, 12);
  const textNodes = lines
    .map((line, index) => `<text x="40" y="${116 + index * 28}" font-size="18" fill="#0f172a">${escapeXml(line)}</text>`)
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#fffaf0"/><rect x="24" y="24" width="912" height="492" rx="16" fill="#ffffff" stroke="#cbd5e1"/><text x="40" y="72" font-size="32" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>${textNodes}</svg>`,
    "utf8"
  );
}

export class ArtifactToolService {
  private readonly rootPath: string;

  constructor(projectRootPath: string) {
    this.rootPath = path.join(projectRootPath, "chat", "tool-artifacts");
  }

  async createArtifact(
    input: CreateToolArtifactInput,
    defaults: { extension: string; mimeType: string; fallbackText?: string | undefined }
  ): Promise<ToolArtifactResult> {
    const now = new Date().toISOString();
    const astPayload = normalizeAstPayload(input.astPayload ?? input.ast_payload);
    const astMeta = astPayload?.meta;
    const title = input.title?.trim() || astMeta?.title?.trim() || "artifact";
    const requestedFilename = input.filename?.trim() || astMeta?.filename?.trim() || title;
    const filename = visibleBasename(ensureExtension(requestedFilename, defaults.extension), `artifact${defaults.extension}`);
    const directory = path.join(this.rootPath, now.slice(0, 10), randomUUID());
    await mkdir(directory, { recursive: true });

    let outputPath = path.join(directory, filename);
    const documentType = normalizedDocumentType(input.documentType);
    const text = input.text ?? defaults.fallbackText ?? "";
    const laidOutText = applyDocumentLayout(text, title, documentType);
    if (input.contentBase64) {
      await writeFile(outputPath, bufferFromInput(input, text));
    } else if (defaults.extension === ".pdf") {
      const pdfAst = this.preparePdfAst(astPayload, {
        title,
        filename,
        text: laidOutText,
        documentType
      });
      outputPath = await this.renderPdfAst(pdfAst, directory);
    } else {
      const buffer =
        defaults.extension === ".docx"
          ? renderDocx(laidOutText, title)
          : defaults.extension === ".xlsx"
            ? renderXlsx(laidOutText, title)
            : defaults.extension === ".svg"
              ? renderSvg(text, title)
              : bufferFromInput({ ...input, text: laidOutText }, laidOutText);
      await writeFile(outputPath, buffer);
    }
    const fileStat = await stat(outputPath);

    return {
      id: randomUUID(),
      filename: path.basename(outputPath),
      mimeType: input.mimeType?.trim() || defaults.mimeType,
      sizeBytes: fileStat.size,
      storagePath: outputPath,
      createdAt: now
    };
  }

  private preparePdfAst(
    astPayload: ArtifactAstPayload | null,
    fallback: { title: string; filename: string; text: string; documentType: string }
  ): ArtifactAstPayload {
    const payload = astPayload ?? textToArtifactAst(fallback);
    const meta = payload.meta ?? {};
    const title = meta.title?.trim() || fallback.title;
    const layoutMode = meta.layout_mode ?? meta.layoutMode ?? inferPdfLayoutMode(fallback.documentType, fallback.text);
    return {
      meta: {
        ...meta,
        title,
        filename: fallback.filename,
        layout_mode: String(layoutMode).toUpperCase() === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT",
        primary_color: meta.primary_color ?? meta.primaryColor ?? "#006666"
      },
      nodes: payload.nodes ?? []
    };
  }

  private async renderPdfAst(astPayload: ArtifactAstPayload, directory: string): Promise<string> {
    const request = JSON.stringify(astPayload);
    const failures: string[] = [];

    for (const command of runtimePythonCommands()) {
      try {
        return await new Promise<string>((resolve, reject) => {
          const child = spawn(command, ["-c", artifactGeneratorScript, directory], {
            env: withRuntimePath(),
            windowsHide: true
          });
          let stdout = "";
          let stderr = "";

          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
          });
          child.on("error", reject);
          child.on("close", (code) => {
            if (code !== 0) {
              reject(new Error(stderr.trim() || `PDF compiler exited with code ${code ?? "unknown"}.`));
              return;
            }

            try {
              const parsed = JSON.parse(stdout) as { path?: unknown };
              const outputPath = typeof parsed.path === "string" ? parsed.path : "";
              if (!outputPath) {
                reject(new Error("PDF compiler did not return an output path."));
                return;
              }
              resolve(outputPath);
            } catch (error) {
              reject(error);
            }
          });
          child.stdin.end(request);
        });
      } catch (error) {
        failures.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(
      [
        "Unable to render PDF artifact with fpdf2.",
        "Install fpdf2 from Settings > Runtime, or run `python3 -m pip install --user --upgrade fpdf2 --break-system-packages`.",
        ...failures.map((failure) => `- ${failure}`)
      ].join("\n")
    );
  }
}
