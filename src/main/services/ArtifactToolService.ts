import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type CreateToolArtifactInput = {
  filename?: string | undefined;
  title?: string | undefined;
  text?: string | undefined;
  contentBase64?: string | undefined;
  mimeType?: string | undefined;
};

export type ToolArtifactResult = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
};

function safeFilePart(value: string): string {
  const parsed = path.parse(value || "artifact");
  const base = (parsed.name || "artifact")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const ext = parsed.ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 18);
  return `${base || "artifact"}${ext}`;
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

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
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
  return lines.slice(0, 46);
}

function renderPdf(text: string, title: string): Buffer {
  const lines = wrapLines(`# ${title}\n\n${text || "Generated artifact."}`);
  const content = [
    "BT",
    "/F1 11 Tf",
    "50 760 Td",
    ...lines.flatMap((line, index) => [
      index === 0 ? "" : "0 -16 Td",
      `(${pdfEscape(line)}) Tj`
    ]),
    "ET"
  ]
    .filter(Boolean)
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(chunks.join("")));
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) {
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(chunks.join(""), "binary");
}

function renderDocx(text: string, title: string): Buffer {
  const paragraphs = [`# ${title}`, "", text || "Generated artifact."].join("\n").split(/\n+/);
  const body = paragraphs
    .map((paragraph) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`)
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

function renderXlsx(text: string, title: string): Buffer {
  const rows = [`# ${title}`, "", text || "Generated artifact."]
    .join("\n")
    .split(/\n/)
    .slice(0, 200)
    .map((line, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>${escapeXml(line)}</t></is></c></row>`)
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
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
    }
  ]);
}

function renderSvg(text: string, title: string): Buffer {
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
    const title = input.title?.trim() || "artifact";
    const filename = safeFilePart(ensureExtension(input.filename?.trim() || title, defaults.extension));
    const directory = path.join(this.rootPath, now.slice(0, 10));
    await mkdir(directory, { recursive: true });

    const parsed = path.parse(filename);
    const outputPath = path.join(directory, `${parsed.name}-${Date.now()}-${randomUUID().slice(0, 8)}${parsed.ext}`);
    const text = input.text ?? defaults.fallbackText ?? "";
    const buffer = input.contentBase64
      ? bufferFromInput(input, text)
      : defaults.extension === ".pdf"
        ? renderPdf(text, title)
        : defaults.extension === ".docx"
          ? renderDocx(text, title)
          : defaults.extension === ".xlsx"
            ? renderXlsx(text, title)
            : defaults.extension === ".svg"
              ? renderSvg(text, title)
              : bufferFromInput(input, text);
    await writeFile(outputPath, buffer);
    const fileStat = await stat(outputPath);

    return {
      id: randomUUID(),
      filename,
      mimeType: input.mimeType?.trim() || defaults.mimeType,
      sizeBytes: fileStat.size,
      storagePath: outputPath,
      createdAt: now
    };
  }
}
