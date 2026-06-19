import { createHash, randomUUID } from "node:crypto";
import { exec, execFile } from "node:child_process";
import type { ExecFileOptions, ExecOptions } from "node:child_process";
import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  AiSettings,
  CallflowHtmlDocument,
  FilesDroppedPayload,
  GraphDefinitionStatus,
  GraphHtmlDocument,
  GraphifyIngestionResult,
  ProcessDroppedItem,
  ResearchDependencyReport
} from "../../shared/ipc";
import { LlmService } from "./LlmService";
import type { GraphCardDefinitionInput, GraphifyMcpToolSpec } from "./LlmService";

type GraphifyGraph = {
  nodes?: unknown[];
  links?: unknown[];
  edges?: unknown[];
};
type GraphifyNodeRecord = Record<string, unknown> & {
  id?: unknown;
  label?: unknown;
  title?: unknown;
  type?: unknown;
  node_type?: unknown;
  file_type?: unknown;
  summary?: unknown;
  description?: unknown;
  source_file?: unknown;
  sourceFile?: unknown;
  source_location?: unknown;
  community?: unknown;
  contextual_definition?: unknown;
};
type GraphifyLinkRecord = {
  source?: unknown;
  target?: unknown;
};
type GraphifyProviderConfig = {
  base_url: string;
  default_model: string;
  model_env_key: string;
  env_key: string;
  pricing: {
    input: number;
    output: number;
  };
  temperature: number;
  max_completion_tokens: number;
};
type GraphifyLocalModelSettings = {
  temperature: number;
  maxTokens: number;
};
type AiSettingsProvider = () => Promise<AiSettings>;
type GraphifyInvocation = {
  label: string;
  command: string;
  args: string[];
  shell?: boolean | undefined;
};

const graphifyToolPackage = "graphifyy[pdf,office,openai,mcp]";
const updateTimeoutMs = 10 * 60 * 1_000;
const maxExecBuffer = 10 * 1024 * 1024;
const graphifyProviderName = "second-brain-local";
const defaultLocalModelEndpoint = "http://localhost:8080/v1/chat/completions";
const defaultLocalModelName = "local-model";
const defaultGraphifyTemperature = 0.6;
const defaultGraphifyMaxTokens = 8192;
const defaultGraphifyRetryTemperature = 0;
const defaultGraphifyRetryMaxTokens = 4096;
const defaultHtmlCommand = "graphify export html --graph graphify-out/graph.json";
const defaultCallflowCommand = "graphify export callflow-html";
const sourceCommentDirectoryName = "source-comments";
const spreadsheetComponentDirectoryName = "spreadsheet-components";
const paperComponentDirectoryName = "paper-components";
const collapsibleTextExtensions = new Set([
  ".c",
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".markdown",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sql",
  ".txt",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml"
]);

function safeFilePart(value: string): string {
  const parsed = path.parse(value);
  const base = (parsed.name || "dropped-file")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const ext = parsed.ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 16);

  return `${base || "dropped-file"}${ext}`;
}

function sourceCommentFileName(sourceFile: string): string {
  const hash = createHash("sha1").update(sourceFile).digest("hex").slice(0, 12);
  const base = path
    .basename(sourceFile || "source")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

  return `${base || "source"}-${hash}.md`;
}

function spreadsheetComponentFileName(sourceFile: string): string {
  const hash = createHash("sha1").update(sourceFile).digest("hex").slice(0, 12);
  const base = path
    .basename(sourceFile, path.extname(sourceFile))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

  return `${base || "spreadsheet"}-${hash}.components.md`;
}

function paperComponentDirectoryNameForSource(sourceFile: string): string {
  const hash = createHash("sha1").update(sourceFile).digest("hex").slice(0, 12);
  const base = path
    .basename(sourceFile, path.extname(sourceFile))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

  return `${base || "paper"}-${hash}`;
}

function bufferFromDroppedValue(value: unknown): Buffer | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return Buffer.from(value);
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  return null;
}

function looksComplete(stdout: string): boolean {
  return /graph complete|graph:\s+\d+\s+nodes|report updated|outputs in|generation complete|wrote graph/i.test(stdout);
}

function parseArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeOpenAiBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");

  return trimmed.replace(/\/chat\/completions$/i, "");
}

function numberFromEnv(value: string | undefined, fallback: number, minimum = 0): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function endpointHostLabel(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint.trim() || "AI endpoint";
  }
}

function defaultIngestCommand(settings: GraphifyLocalModelSettings): string {
  const concurrency = numberFromEnv(process.env.SECOND_BRAIN_GRAPHIFY_MAX_CONCURRENCY, 1, 1);
  const tokenBudget = numberFromEnv(process.env.SECOND_BRAIN_GRAPHIFY_TOKEN_BUDGET, settings.maxTokens, 256);

  return `graphify extract . --out . --backend ${graphifyProviderName} --max-concurrency ${concurrency} --token-budget ${tokenBudget}`;
}

function quoteCommandPart(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, "\\\"")}"` : value;
}

function formatInvocation(invocation: GraphifyInvocation): string {
  return [invocation.command, ...invocation.args].map(quoteCommandPart).join(" ");
}

function isCmdShim(filePath: string): boolean {
  return /\.cmd$/i.test(filePath) || /\.bat$/i.test(filePath);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isCollapsibleTextSource(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return collapsibleTextExtensions.has(extension);
}

function isSpreadsheetSource(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".xlsx";
}

function isPaperSource(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".pdf";
}

function spreadsheetComponentScript(): string {
  return [
    "import json, re, sys",
    "from pathlib import Path",
    "from graphify.detect import xlsx_extract_structure",
    "",
    "def _node_id(*parts):",
    "    raw = '_'.join(str(part) for part in parts if str(part).strip())",
    "    return re.sub(r'[^a-z0-9_]+', '_', raw.lower()).strip('_') or 'spreadsheet_component'",
    "",
    "def _component_node(node_id, label, kind, relative_source, location):",
    "    return {",
    "        'id': node_id,",
    "        'label': label,",
    "        'type': kind,",
    "        'node_type': kind,",
    "        'file_type': 'document',",
    "        'source_file': relative_source,",
    "        'source_location': location,",
    "    }",
    "",
    "def _component_edge(source_id, target_id, relation='contains'):",
    "    return {",
    "        'source': source_id,",
    "        'target': target_id,",
    "        'relation': relation,",
    "        'confidence': 'EXTRACTED',",
    "        'weight': 1.0,",
    "    }",
    "",
    "def _add_node(nodes, seen_nodes, node_id, label, kind, relative_source, location):",
    "    if node_id not in seen_nodes:",
    "        nodes.append(_component_node(node_id, label, kind, relative_source, location))",
    "        seen_nodes.add(node_id)",
    "    return node_id",
    "",
    "def _add_edge(edges, seen_edges, source_id, target_id, relation='contains'):",
    "    key = (source_id, target_id, relation)",
    "    if source_id and target_id and key not in seen_edges:",
    "        edges.append(_component_edge(source_id, target_id, relation))",
    "        seen_edges.add(key)",
    "",
    "source = Path(sys.argv[1])",
    "output = Path(sys.argv[2])",
    "relative_source = sys.argv[3]",
    "structure = xlsx_extract_structure(source)",
    "nodes = structure.get('nodes') or []",
    "edges = structure.get('edges') or []",
    "seen_nodes = {str(node.get('id')) for node in nodes if node.get('id')}",
    "seen_edges = {(str(edge.get('source')), str(edge.get('target')), str(edge.get('relation') or 'contains')) for edge in edges if edge.get('source') and edge.get('target')}",
    "stem = _node_id(source.stem)",
    "file_id = str(nodes[0].get('id')) if nodes and nodes[0].get('id') else _node_id(stem, 'file')",
    "_add_node(nodes, seen_nodes, file_id, source.name, 'spreadsheet_file', relative_source, relative_source)",
    "try:",
    "    import openpyxl",
    "    from openpyxl.utils import range_boundaries",
    "    workbook = openpyxl.load_workbook(str(source), read_only=False, data_only=True)",
    "    try:",
    "        for sheet_name in workbook.sheetnames:",
    "            worksheet = workbook[sheet_name]",
    "            sheet_id = _node_id(stem, sheet_name, 'sheet')",
    "            _add_node(nodes, seen_nodes, sheet_id, f'{sheet_name} (sheet)', 'spreadsheet_sheet', relative_source, f'{relative_source}#{sheet_name}')",
    "            _add_edge(edges, seen_edges, file_id, sheet_id)",
    "            table_ranges = []",
    "            tables = getattr(worksheet, 'tables', {})",
    "            table_values = tables.values() if hasattr(tables, 'values') else []",
    "            for table in table_values:",
    "                table_name = getattr(table, 'displayName', None) or getattr(table, 'name', None) or 'Table'",
    "                table_ref = getattr(table, 'ref', '') or ''",
    "                table_id = _node_id(stem, sheet_name, table_name, 'table')",
    "                _add_node(nodes, seen_nodes, table_id, f'{table_name} (table)', 'spreadsheet_table', relative_source, f'{relative_source}#{sheet_name}!{table_ref}')",
    "                _add_edge(edges, seen_edges, sheet_id, table_id)",
    "                if table_ref:",
    "                    table_ranges.append(table_ref)",
    "                    min_col, min_row, max_col, _max_row = range_boundaries(table_ref)",
    "                    for cell in worksheet[min_row][min_col - 1:max_col]:",
    "                        value = str(cell.value).strip() if cell.value is not None else ''",
    "                        if value:",
    "                            column_id = _node_id(stem, sheet_name, table_name, value, 'column')",
    "                            _add_node(nodes, seen_nodes, column_id, f'{value} (column)', 'spreadsheet_column', relative_source, f'{relative_source}#{sheet_name}!{cell.coordinate}')",
    "                            _add_edge(edges, seen_edges, table_id, column_id)",
    "            header_row = None",
    "            for row in worksheet.iter_rows(min_row=1, max_row=min(25, worksheet.max_row), values_only=False):",
    "                values = [str(cell.value).strip() for cell in row if cell.value is not None and str(cell.value).strip()]",
    "                if values:",
    "                    header_row = row",
    "                    break",
    "            if header_row:",
    "                for cell in header_row:",
    "                    value = str(cell.value).strip() if cell.value is not None else ''",
    "                    if value:",
    "                        column_id = _node_id(stem, sheet_name, value, 'column')",
    "                        _add_node(nodes, seen_nodes, column_id, f'{value} (column)', 'spreadsheet_column', relative_source, f'{relative_source}#{sheet_name}!{cell.coordinate}')",
    "                        _add_edge(edges, seen_edges, sheet_id, column_id)",
    "    finally:",
    "        workbook.close()",
    "except Exception as exc:",
    "    print(f'[second-brain] spreadsheet component augmentation warning for {relative_source}: {exc}', file=sys.stderr)",
    "structure = {'nodes': nodes, 'edges': edges}",
    "if len(nodes) <= 1:",
    "    raise SystemExit('Graphify xlsx_extract_structure produced no spreadsheet components. Install graphifyy[office] and verify the workbook is readable.')",
    "labels = {node.get('id'): node.get('label') or node.get('id') for node in nodes}",
    "lines = [",
    "    f'# Spreadsheet Components: {source.name}',",
    "    '',",
    "    f'Source workbook: {relative_source}',",
    "    '',",
    "    'This generated file lets Graphify treat workbook sheets, named tables, and column headers as separate graph components.',",
    "    '',",
    "    '## Component Nodes',",
    "    '',",
    "    '| Component | Graphify ID | Kind |',",
    "    '| --- | --- | --- |',",
    "]",
    "for node in nodes:",
    "    label = str(node.get('label') or node.get('id') or '').replace('|', '\\\\|')",
    "    node_id = str(node.get('id') or '').replace('|', '\\\\|')",
    "    kind = str(node.get('file_type') or 'document').replace('|', '\\\\|')",
    "    lines.append(f'| {label} | `{node_id}` | {kind} |')",
    "lines.extend(['', '## Component Relationships', '', '| Parent | Relation | Child |', '| --- | --- | --- |'])",
    "for edge in edges:",
    "    source_label = str(labels.get(edge.get('source'), edge.get('source') or '')).replace('|', '\\\\|')",
    "    target_label = str(labels.get(edge.get('target'), edge.get('target') or '')).replace('|', '\\\\|')",
    "    relation = str(edge.get('relation') or 'related').replace('|', '\\\\|')",
    "    lines.append(f'| {source_label} | {relation} | {target_label} |')",
    "lines.extend(['', '## Raw Graphify Structure', '', '```json', json.dumps(structure, ensure_ascii=False, indent=2), '```', ''])",
    "output.parent.mkdir(parents=True, exist_ok=True)",
    "output.write_text('\\n'.join(lines), encoding='utf-8')",
    "print(f'[second-brain] spreadsheet components: {relative_source} -> {output.name} ({len(nodes)} nodes, {len(edges)} edges)')"
  ].join("\n");
}

function paperComponentScript(): string {
  return [
    "import json, re, sys, hashlib",
    "from pathlib import Path",
    "",
    "source = Path(sys.argv[1])",
    "output = Path(sys.argv[2])",
    "relative_source = sys.argv[3]",
    "",
    "def _slug(*parts):",
    "    raw = '_'.join(str(part) for part in parts if str(part).strip())",
    "    return re.sub(r'[^a-z0-9_]+', '_', raw.lower()).strip('_') or 'paper_component'",
    "",
    "def _node(node_id, label, kind, location='', summary='', extra=None):",
    "    data = {",
    "        'id': node_id,",
    "        'label': label,",
    "        'type': kind,",
    "        'node_type': kind,",
    "        'file_type': 'paper',",
    "        'source_file': relative_source,",
    "        'source_location': location or relative_source,",
    "        'summary': summary,",
    "    }",
    "    if extra:",
    "        data.update(extra)",
    "    return data",
    "",
    "def _edge(source_id, target_id, relation='contains', confidence='EXTRACTED', weight=1.0):",
    "    return {",
    "        'source': source_id,",
    "        'target': target_id,",
    "        'relation': relation,",
    "        'confidence': confidence,",
    "        'weight': weight,",
    "    }",
    "",
    "def _compact(value):",
    "    return re.sub(r'\\s+', ' ', value or '').strip()",
    "",
    "def _safe_name(value, fallback):",
    "    clean = re.sub(r'[^a-zA-Z0-9._-]+', '-', value or '').strip('-').lower()",
    "    return (clean or fallback)[:90]",
    "",
    "def _csv(value):",
    "    text = str(value or '').replace('\"', '\"\"')",
    "    return f'\"{text}\"'",
    "",
    "def _sentences(text):",
    "    return [_compact(part) for part in re.split(r'(?<=[.!?])\\s+', text or '') if _compact(part)]",
    "",
    "def _extract_text():",
    "    warnings = []",
    "    try:",
    "        import pymupdf4llm",
    "        markdown = pymupdf4llm.to_markdown(str(source))",
    "        if markdown and markdown.strip():",
    "            return markdown, 'pymupdf4llm', warnings",
    "    except Exception as exc:",
    "        warnings.append(f'pymupdf4llm unavailable: {exc}')",
    "    try:",
    "        import fitz",
    "        doc = fitz.open(str(source))",
    "        pages = []",
    "        for index, page in enumerate(doc, start=1):",
    "            pages.append(f'\\n\\n<!-- page:{index} -->\\n' + (page.get_text('text') or ''))",
    "        doc.close()",
    "        text = '\\n'.join(pages)",
    "        if text.strip():",
    "            return text, 'pymupdf', warnings",
    "    except Exception as exc:",
    "        warnings.append(f'pymupdf unavailable: {exc}')",
    "    try:",
    "        from pypdf import PdfReader",
    "        reader = PdfReader(str(source))",
    "        pages = []",
    "        for index, page in enumerate(reader.pages, start=1):",
    "            pages.append(f'\\n\\n<!-- page:{index} -->\\n' + (page.extract_text() or ''))",
    "        return '\\n'.join(pages), 'pypdf', warnings",
    "    except Exception as exc:",
    "        raise SystemExit('Unable to extract PDF text. Install researcher dependencies with uv and verify the PDF is readable. Last error: ' + str(exc))",
    "",
    "def _title(lines):",
    "    for line in lines[:40]:",
    "        clean = _compact(re.sub(r'^#+\\s*', '', line))",
    "        if len(clean) >= 8 and not re.match(r'^(abstract|keywords|introduction|references)$', clean, re.I):",
    "            return clean[:180]",
    "    return source.stem",
    "",
    "def _abstract(text):",
    "    match = re.search(r'(?is)\\babstract\\b\\s*[:\\-]?\\s*(.*?)(?=\\n\\s*(?:#{1,4}\\s*)?(?:1\\.?\\s*)?(?:introduction|keywords|index terms)\\b)', text)",
    "    if match:",
    "        return _compact(match.group(1))[:1600]",
    "    return ''",
    "",
    "def _reference_block(text):",
    "    match = re.search(r'(?is)\\n\\s*(?:#{1,4}\\s*)?(references|bibliography)\\s*\\n(.*)$', text)",
    "    return match.group(2) if match else ''",
    "",
    "def _split_references(block):",
    "    if not block.strip():",
    "        return []",
    "    entries = re.split(r'\\n\\s*(?:\\[?\\d+\\]?\\.?|\\d+\\.)\\s+', '\\n' + block)",
    "    refs = [_compact(entry) for entry in entries if len(_compact(entry)) > 20]",
    "    if len(refs) <= 1:",
    "        refs = [_compact(entry) for entry in re.split(r'\\n{2,}', block) if len(_compact(entry)) > 20]",
    "    return refs[:80]",
    "",
    "def _split_sections(text):",
    "    heading = re.compile(r'(?im)^\\s*(?:#{1,4}\\s*)?(?:(\\d+(?:\\.\\d+)*)\\s+)?(abstract|introduction|background|related work|methodology|methods?|approach|experiments?|evaluation|results?|discussion|limitations?|conclusion|references|bibliography|appendix(?:\\s+[a-z])?)\\s*$', re.I)",
    "    matches = list(heading.finditer(text))",
    "    sections = []",
    "    for index, match in enumerate(matches):",
    "        title = _compact(match.group(0).lstrip('#'))",
    "        start = match.end()",
    "        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)",
    "        content = _compact(text[start:end])",
    "        if title and content and not re.search(r'^(references|bibliography)$', title, re.I):",
    "            sections.append({'title': title[:140], 'content': content[:2600]})",
    "    if not sections:",
    "        sections.append({'title': 'Paper Overview', 'content': _compact(text)[:2600]})",
    "    return sections[:32]",
    "",
    "def _extract_figures(text):",
    "    figures = []",
    "    pattern = re.compile(r'(?im)\\b(?:fig\\.?|figure)\\s*\\d+[a-z]?\\s*[:.\\-]?\\s+(.{20,260})')",
    "    for index, match in enumerate(pattern.finditer(text), start=1):",
    "        caption = _compact(match.group(0))",
    "        figures.append({'label': f'Figure {index}', 'caption': caption[:320]})",
    "        if len(figures) >= 24:",
    "            break",
    "    return figures",
    "",
    "def _extract_tables(text):",
    "    tables = []",
    "    pattern = re.compile(r'(?im)\\btable\\s*\\d+[a-z]?\\s*[:.\\-]?\\s+(.{20,260})')",
    "    for index, match in enumerate(pattern.finditer(text), start=1):",
    "        caption = _compact(match.group(0))",
    "        tables.append({'label': f'Table {index}', 'caption': caption[:320]})",
    "        if len(tables) >= 24:",
    "            break",
    "    return tables",
    "",
    "def _find_sentences(text, pattern, limit):",
    "    found = []",
    "    for sentence in _sentences(text):",
    "        if re.search(pattern, sentence, re.I) and 45 <= len(sentence) <= 420:",
    "            found.append(sentence)",
    "        if len(found) >= limit:",
    "            break",
    "    return found",
    "",
    "text, extractor, warnings = _extract_text()",
    "lines = [line for line in text.splitlines() if _compact(line)]",
    "paper_title = _title(lines)",
    "digest = hashlib.sha1(relative_source.encode('utf-8')).hexdigest()[:12]",
    "base = _slug(source.stem, digest)",
    "paper_id = _slug(base, 'paper')",
    "nodes = [_node(paper_id, paper_title, 'paper_file', relative_source, f'Research paper extracted from {source.name}.', {'extractor': extractor})]",
    "edges = []",
    "",
    "abstract = _abstract(text)",
    "if abstract:",
    "    abstract_id = _slug(base, 'abstract')",
    "    nodes.append(_node(abstract_id, 'Abstract', 'paper_abstract', f'{relative_source}#abstract', abstract))",
    "    edges.append(_edge(paper_id, abstract_id))",
    "",
    "section_ids = []",
    "for index, section in enumerate(_split_sections(text), start=1):",
    "    section_id = _slug(base, f'section_{index}', section['title'])",
    "    section_ids.append(section_id)",
    "    nodes.append(_node(section_id, section['title'], 'paper_section', f'{relative_source}#section-{index}', section['content']))",
    "    edges.append(_edge(paper_id, section_id))",
    "",
    "for index, figure in enumerate(_extract_figures(text), start=1):",
    "    figure_id = _slug(base, f'figure_{index}')",
    "    nodes.append(_node(figure_id, figure['label'], 'paper_figure', f'{relative_source}#figure-{index}', figure['caption']))",
    "    edges.append(_edge(paper_id, figure_id))",
    "",
    "for index, table in enumerate(_extract_tables(text), start=1):",
    "    table_id = _slug(base, f'table_{index}')",
    "    nodes.append(_node(table_id, table['label'], 'paper_table', f'{relative_source}#table-{index}', table['caption']))",
    "    edges.append(_edge(paper_id, table_id))",
    "",
    "for index, reference in enumerate(_split_references(_reference_block(text)), start=1):",
    "    ref_id = _slug(base, f'reference_{index}')",
    "    label = reference[:110]",
    "    nodes.append(_node(ref_id, label, 'paper_reference', f'{relative_source}#reference-{index}', reference))",
    "    edges.append(_edge(paper_id, ref_id, 'cites'))",
    "",
    "heuristics = [",
    "    ('paper_claim', 'claim', r'\\b(we show|we demonstrate|we propose|our contribution|this paper presents|we find|we prove)\\b'),",
    "    ('paper_method', 'method', r'\\b(method|approach|algorithm|architecture|framework|pipeline|model)\\b'),",
    "    ('paper_dataset', 'dataset', r'\\b(dataset|corpus|benchmark|participants|samples|measurements|data set)\\b'),",
    "    ('paper_result', 'result', r'\\b(result|outperform|improve|accuracy|precision|recall|significant|achieves|reduction|increase)\\b'),",
    "]",
    "for kind, name, pattern in heuristics:",
    "    for index, sentence in enumerate(_find_sentences(text, pattern, 10), start=1):",
    "        node_id = _slug(base, name, index)",
    "        nodes.append(_node(node_id, f'{name.title()} {index}', kind, f'{relative_source}#{name}-{index}', sentence))",
    "        relation = 'uses_method' if kind == 'paper_method' else 'uses_dataset' if kind == 'paper_dataset' else 'contains'",
    "        edges.append(_edge(paper_id, node_id, relation, 'INFERRED' if kind in {'paper_method', 'paper_dataset'} else 'AMBIGUOUS'))",
    "        if kind in {'paper_claim', 'paper_result'} and section_ids:",
    "            edges.append(_edge(section_ids[min(index - 1, len(section_ids) - 1)], node_id, 'evidence_for', 'AMBIGUOUS', 0.6))",
    "",
    "output.mkdir(parents=True, exist_ok=True)",
    "artifact_index = []",
    "component_root = Path('paper-components') / output.name",
    "kind_dirs = {",
    "    'paper_abstract': ('sections', 'markdown'),",
    "    'paper_section': ('sections', 'markdown'),",
    "    'paper_figure': ('figures', 'markdown'),",
    "    'paper_table': ('tables', 'csv'),",
    "    'paper_reference': ('references', 'csv'),",
    "    'paper_claim': ('claims', 'markdown'),",
    "    'paper_method': ('methods', 'markdown'),",
    "    'paper_dataset': ('datasets', 'markdown'),",
    "    'paper_result': ('results', 'markdown'),",
    "}",
    "for node in nodes:",
    "    kind = str(node.get('type') or 'artifact')",
    "    if kind == 'paper_file':",
    "        continue",
    "    artifact_kind = kind.replace('paper_', '')",
    "    folder, llm_format = kind_dirs.get(kind, ('artifacts', 'markdown'))",
    "    folder_path = output / folder",
    "    folder_path.mkdir(parents=True, exist_ok=True)",
    "    artifact_file_base = _safe_name(str(node.get('label') or node.get('id')), str(node.get('id') or 'artifact'))",
    "    artifact_id = str(node.get('id'))",
    "    summary = _compact(str(node.get('summary') or ''))",
    "    if llm_format == 'csv':",
    "        extension = 'csv'",
    "        body = 'artifact_id,kind,title,source_file,location,content\\n' + ','.join([_csv(artifact_id), _csv(artifact_kind), _csv(node.get('label')), _csv(relative_source), _csv(node.get('source_location')), _csv(summary)]) + '\\n'",
    "    else:",
    "        extension = 'md'",
    "        body = '\\n'.join([",
    "            f'# {node.get(\"label\") or artifact_id}',",
    "            '',",
    "            f'- Artifact ID: `{artifact_id}`',",
    "            f'- Kind: {artifact_kind}',",
    "            f'- Source PDF: {relative_source}',",
    "            f'- Location: {node.get(\"source_location\") or relative_source}',",
    "            '',",
    "            '## LLM-Ingestible Context',",
    "            '',",
    "            summary or 'No extractable text was found for this artifact.',",
    "            ''",
    "        ])",
    "    artifact_path = folder_path / f'{artifact_file_base}.{extension}'",
    "    artifact_path.write_text(body, encoding='utf-8')",
    "    relative_artifact_path = (component_root / folder / artifact_path.name).as_posix()",
    "    node.update({",
    "        'artifact_id': artifact_id,",
    "        'artifact_kind': artifact_kind,",
    "        'artifact_path': relative_artifact_path,",
    "        'llm_format': 'csv' if extension == 'csv' else 'markdown',",
    "        'preview': summary[:320],",
    "    })",
    "    artifact_index.append({",
    "        'artifactId': artifact_id,",
    "        'artifactKind': artifact_kind,",
    "        'title': str(node.get('label') or artifact_id),",
    "        'sourceFile': relative_source,",
    "        'artifactPath': relative_artifact_path,",
    "        'graphNodeId': artifact_id,",
    "        'page': None,",
    "        'preview': summary[:320],",
    "        'llmFormat': 'csv' if extension == 'csv' else 'markdown',",
    "    })",
    "references = [item for item in artifact_index if item['artifactKind'] == 'reference']",
    "if references:",
    "    ref_dir = output / 'references'",
    "    ref_dir.mkdir(parents=True, exist_ok=True)",
    "    ref_lines = ['artifact_id,title,source_file,artifact_path']",
    "    for item in references:",
    "        ref_lines.append(','.join([_csv(item['artifactId']), _csv(item['title']), _csv(item['sourceFile']), _csv(item['artifactPath'])]))",
    "    (ref_dir / 'references.csv').write_text('\\n'.join(ref_lines) + '\\n', encoding='utf-8')",
    "    artifact_index.append({",
    "        'artifactId': _slug(base, 'references_index'),",
    "        'artifactKind': 'reference',",
    "        'title': 'References Index',",
    "        'sourceFile': relative_source,",
    "        'artifactPath': (component_root / 'references' / 'references.csv').as_posix(),",
    "        'graphNodeId': '',",
    "        'page': None,",
    "        'preview': f'{len(references)} extracted references.',",
    "        'llmFormat': 'csv',",
    "    })",
    "(output / 'artifact-index.json').write_text(json.dumps({'sourceFile': relative_source, 'artifacts': artifact_index}, ensure_ascii=False, indent=2), encoding='utf-8')",
    "",
    "structure = {'nodes': nodes, 'edges': edges, 'warnings': warnings}",
    "lines_out = [",
    "    f'# Paper Components: {source.name}',",
    "    '',",
    "    f'Source paper: {relative_source}',",
    "    f'Extractor: {extractor}',",
    "    '',",
    "    'This generated file lets Graphify treat the research paper as sections, figures, tables, references, claims, methods, datasets, and results.',",
    "    '',",
    "    '## Research Paper',",
    "    '',",
    "    f'- Title: {paper_title}',",
    "    f'- Source: {relative_source}',",
    "]",
    "if abstract:",
    "    lines_out.extend(['', '## Abstract', '', abstract])",
    "lines_out.extend(['', '## Paper Components', '', '| Component | Graphify ID | Kind | Context |', '| --- | --- | --- | --- |'])",
    "for node in nodes:",
    "    label = str(node.get('label') or node.get('id') or '').replace('|', '\\\\|')",
    "    node_id = str(node.get('id') or '').replace('|', '\\\\|')",
    "    kind = str(node.get('type') or '').replace('|', '\\\\|')",
    "    summary = _compact(str(node.get('summary') or '')).replace('|', '\\\\|')[:180]",
    "    lines_out.append(f'| {label} | `{node_id}` | {kind} | {summary} |')",
    "lines_out.extend(['', '## Component Relationships', '', '| Parent | Relation | Child | Confidence |', '| --- | --- | --- | --- |'])",
    "labels = {node['id']: node['label'] for node in nodes}",
    "for edge in edges:",
    "    lines_out.append(f\"| {str(labels.get(edge['source'], edge['source'])).replace('|', '\\\\|')} | {edge['relation']} | {str(labels.get(edge['target'], edge['target'])).replace('|', '\\\\|')} | {edge['confidence']} |\")",
    "if warnings:",
    "    lines_out.extend(['', '## Extraction Warnings', '', *[f'- {warning}' for warning in warnings]])",
    "lines_out.extend(['', '## Raw Graphify Structure', '', '```json', json.dumps(structure, ensure_ascii=False, indent=2), '```', ''])",
    "(output / 'paper.md').write_text('\\n'.join(lines_out), encoding='utf-8')",
    "print(f'[second-brain] paper components: {relative_source} -> {output.name}/ ({len(nodes)} nodes, {len(edges)} edges, {len(artifact_index)} artifacts, extractor={extractor})')",
  ].join("\n");
}

function researchDependencyStatusScript(): string {
  return [
    "import importlib, json, sys",
    "deps = [",
    "  ('Graphify', 'graphify', True, 'Graph generation and MCP server'),",
    "  ('pypdf', 'pypdf', True, 'Plain PDF text fallback'),",
    "  ('PyMuPDF', 'fitz', False, 'PDF pages, images, layout blocks, and source locations'),",
    "  ('pymupdf4llm', 'pymupdf4llm', False, 'Rich PDF-to-Markdown extraction for research papers'),",
    "  ('numpy', 'numpy', False, 'Layout scoring and future research analytics'),",
    "  ('matplotlib', 'matplotlib', False, 'Future figure previews and visual summaries'),",
    "]",
    "items = []",
    "for name, import_name, required, purpose in deps:",
    "    try:",
    "        module = importlib.import_module(import_name)",
    "        version = str(getattr(module, '__version__', 'installed'))",
    "        installed = True",
    "    except Exception:",
    "        version = ''",
    "        installed = False",
    "    items.append({",
    "        'name': name,",
    "        'importName': import_name,",
    "        'installed': installed,",
    "        'version': version,",
    "        'required': required,",
    "        'purpose': purpose,",
    "        'guidance': 'Install into the Graphify tool environment with uv --with.' if not installed else '',",
    "    })",
    "print(json.dumps({'runtime': sys.executable, 'dependencies': items}, ensure_ascii=False))",
  ].join("\n");
}

function linkEndpointId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  const record = asRecord(value);
  return record ? asString(record.id) : "";
}

function normalizeGraphNodes(value: unknown): GraphifyNodeRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((node): node is GraphifyNodeRecord => Boolean(node))
    : [];
}

function normalizeGraphLinks(value: unknown): GraphifyLinkRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((link): link is GraphifyLinkRecord => Boolean(link))
    : [];
}

export class GraphifyController {
  private readonly graphOutPath: string;
  private readonly graphPath: string;
  private readonly graphHtmlPath: string;
  private readonly reportPath: string;
  private lastUpdate: Promise<GraphifyIngestionResult> = Promise.resolve({
    completed: true,
    writtenFileCount: 0,
    graphPath: "",
    reportPath: "",
    stdout: "",
    updatedAt: new Date(0).toISOString()
  });
  private mcpClient: Client | null = null;
  private mcpTransport: StdioClientTransport | null = null;
  private readonly llm: LlmService;
  private cardDefinitionUpdate: Promise<void> | null = null;
  private cardDefinitionQueued = false;
  private definitionStatus: GraphDefinitionStatus = {
    running: false,
    pendingCount: 0,
    updatedCount: 0,
    failedBatchCount: 0,
    updatedAt: new Date(0).toISOString(),
    endpointHost: ""
  };

  constructor(
    private readonly rawVaultPath: string,
    private readonly settingsProvider: AiSettingsProvider = async () => ({
      endpoint: process.env.SECOND_BRAIN_LLM_ENDPOINT ?? defaultLocalModelEndpoint,
      apiKey:
        process.env.SECOND_BRAIN_GRAPHIFY_LLM_API_KEY ??
        process.env.SECOND_BRAIN_LLM_API_KEY ??
        process.env.OPENAI_API_KEY ??
        "second-brain-local",
      model: process.env.SECOND_BRAIN_LLM_MODEL ?? process.env.OPENAI_MODEL ?? defaultLocalModelName,
      updatedAt: new Date().toISOString()
    })
  ) {
    this.graphOutPath = path.join(rawVaultPath, "graphify-out");
    this.graphPath = path.join(this.graphOutPath, "graph.json");
    this.graphHtmlPath = path.join(this.graphOutPath, "graph.html");
    this.reportPath = path.join(this.graphOutPath, "GRAPH_REPORT.md");
    this.llm = new LlmService(settingsProvider);
  }

  getRawVaultPath(): string {
    return this.rawVaultPath;
  }

  getGraphPath(): string {
    return this.graphPath;
  }

  getGraphHtmlPath(): string {
    return this.graphHtmlPath;
  }

  getDefinitionStatus(): GraphDefinitionStatus {
    return { ...this.definitionStatus };
  }

  getMcpServerCommand(): string {
    return `${process.env.SECOND_BRAIN_GRAPHIFY_MCP_COMMAND ?? "python"} -m graphify.serve ${this.graphPath}`;
  }

  async readGraphHtml(): Promise<GraphHtmlDocument> {
    await this.ensureGraphHtml();

    const [html, htmlStat] = await Promise.all([readFile(this.graphHtmlPath, "utf8"), stat(this.graphHtmlPath)]);

    return {
      html,
      path: this.graphHtmlPath,
      updatedAt: htmlStat.mtime.toISOString()
    };
  }

  async generateCallflowHtml(nodeId: string): Promise<CallflowHtmlDocument> {
    await this.initialize();
    const graphExists = await this.fileExists(this.graphPath);

    if (!graphExists) {
      throw new Error(`Graphify graph is not available at ${this.graphPath}.`);
    }

    const settings = this.getGraphifyLocalModelSettings();
    const aiSettings = await this.getAiSettings();
    const command = (
      process.env.SECOND_BRAIN_GRAPHIFY_CALLFLOW_COMMAND ?? defaultCallflowCommand
    ).replace(/\{nodeId\}/g, nodeId);
    const before = await this.listCallflowHtmlCandidates();
    const stdout =
      command === defaultCallflowCommand
        ? await this.runGraphifyCli(["export", "callflow-html"], settings, "Graphify call flow export failed", aiSettings)
        : await this.runGraphifyCommand(command, settings, "Graphify call flow export failed", aiSettings);
    const after = await this.listCallflowHtmlCandidates();
    const beforePaths = new Set(before.map((candidate) => candidate.path));
    const created = after.find((candidate) => !beforePaths.has(candidate.path)) ?? after[0];

    if (!created) {
      throw new Error(
        [
          "Graphify call flow export finished but did not create an HTML artifact.",
          `Command: ${command}`,
          stdout ? `Graphify output:\n${stdout}` : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    }

    return {
      html: await readFile(created.path, "utf8"),
      path: created.path,
      updatedAt: created.updatedAt,
      stdout
    };
  }

  async initialize(): Promise<void> {
    await mkdir(this.rawVaultPath, { recursive: true });
    await this.ensureGraphifyProviderConfig();
  }

  async getResearchDependencyStatus(): Promise<ResearchDependencyReport> {
    const checkedAt = new Date().toISOString();
    const invocations = await this.getGraphifyPythonInvocations(["-c", researchDependencyStatusScript()]);
    const failures: string[] = [];

    for (const invocation of invocations) {
      try {
        const stdout = await this.runGraphifyUtilityInvocation(invocation);
        const parsed = JSON.parse(stdout) as Pick<ResearchDependencyReport, "runtime" | "dependencies">;
        const missingRequired = parsed.dependencies.filter((dependency) => dependency.required && !dependency.installed);
        const missingRich = parsed.dependencies.filter((dependency) => !dependency.required && !dependency.installed);

        return {
          available: missingRequired.length === 0,
          checkedAt,
          runtime: parsed.runtime,
          dependencies: parsed.dependencies,
          guidance: [
            missingRequired.length > 0
              ? "Install the base Graphify PDF runtime: uv tool install --upgrade \"graphifyy[pdf,office,openai,mcp]\""
              : "",
            missingRich.length > 0
              ? "For rich research-paper breakdowns, add researcher packages to the Graphify tool environment: uv tool install --upgrade \"graphifyy[pdf,office,openai,mcp]\" --with pymupdf --with pymupdf4llm --with numpy --with matplotlib"
              : "",
            process.env.SECOND_BRAIN_PAPER_COMPONENTS === "0"
              ? "Paper component extraction is disabled by SECOND_BRAIN_PAPER_COMPONENTS=0."
              : ""
          ].filter(Boolean)
        };
      } catch (error) {
        failures.push(`${invocation.label}: ${errorMessage(error)}`);
      }
    }

    return {
      available: false,
      checkedAt,
      runtime: "",
      dependencies: [],
      guidance: [
        "Second Brain could not inspect the Graphify Python runtime.",
        "Install Graphify with: uv tool install --upgrade \"graphifyy[pdf,office,openai,mcp]\"",
        ...failures.map((failure) => `- ${failure}`)
      ]
    };
  }

  async ingestFilesDrop(payload: FilesDroppedPayload): Promise<GraphifyIngestionResult> {
    const fileItems = payload.files.map((file) => ({
      name: file.name,
      path: file.path,
      type: file.type,
      buffer: file.buffer
    }));
    const textItems = payload.text
      ? [
          {
            name: "dropped-text.txt",
            type: "text/plain",
            text: payload.text
          }
        ]
      : [];

    return this.ingestDroppedItems([...fileItems, ...textItems]);
  }

  async removeSource(sourceFile: string): Promise<GraphifyIngestionResult> {
    await this.initialize();
    const sourcePath = this.resolveRemovableSourcePath(sourceFile);
    await rm(sourcePath, { force: true });
    await this.removeSourceComment(sourceFile);
    await this.removeGeneratedComponentsForSource(sourceFile);
    await this.resetGraphifyOutputs();

    if (!(await this.hasRawSourceFiles())) {
      return this.writeEmptyGraphResult();
    }

    return this.queueUpdate(0);
  }

  async collapseSourceInto(sourceFile: string, targetSourceFile: string): Promise<GraphifyIngestionResult> {
    await this.initialize();

    const sourcePath = this.resolveRemovableSourcePath(sourceFile);
    const targetPath = this.resolveRemovableSourcePath(targetSourceFile);

    if (sourcePath === targetPath) {
      throw new Error("Choose a different source to collapse into.");
    }

    if (!isCollapsibleTextSource(sourcePath) || !isCollapsibleTextSource(targetPath)) {
      throw new Error("Source collapse currently supports text-like files only.");
    }

    const [sourceContent, targetContent] = await Promise.all([
      readFile(sourcePath, "utf8"),
      readFile(targetPath, "utf8")
    ]);
    const collapsedBlock = [
      "",
      "",
      "---",
      `Collapsed source: ${path.basename(sourcePath)}`,
      `Collapsed at: ${new Date().toISOString()}`,
      "---",
      "",
      sourceContent.trim(),
      ""
    ].join("\n");

    await writeFile(targetPath, `${targetContent.trimEnd()}${collapsedBlock}`, "utf8");
    await this.mergeSourceComment(sourceFile, targetSourceFile);
    await rm(sourcePath, { force: true });
    await this.removeGeneratedComponentsForSource(sourceFile);
    await this.resetGraphifyOutputs();

    return this.queueUpdate(0);
  }

  async renameSource(sourceFile: string, newName: string): Promise<GraphifyIngestionResult> {
    await this.initialize();
    const sourcePath = this.resolveRemovableSourcePath(sourceFile);
    const trimmedName = newName.trim();

    if (!trimmedName) {
      throw new Error("Enter a source name.");
    }

    const parsedCurrent = path.parse(sourcePath);
    const parsedNext = path.parse(trimmedName);
    const nextFileName = safeFilePart(parsedNext.ext ? parsedNext.base : `${parsedNext.name || trimmedName}${parsedCurrent.ext}`);
    const nextPath = path.join(parsedCurrent.dir, nextFileName);

    if (sourcePath === nextPath) {
      throw new Error("Enter a different source name.");
    }

    try {
      await stat(nextPath);
      throw new Error(`A source named ${nextFileName} already exists.`);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }

    await rename(sourcePath, nextPath);
    await this.renameSourceComment(sourceFile, path.relative(this.rawVaultPath, nextPath));
    await this.removeGeneratedComponentsForSource(sourceFile);
    await this.resetGraphifyOutputs();

    return this.queueUpdate(0);
  }

  async commentSource(sourceFile: string, comment: string): Promise<GraphifyIngestionResult> {
    await this.initialize();
    const sourcePath = this.resolveRemovableSourcePath(sourceFile);
    const trimmed = comment.trim();

    if (!trimmed) {
      await this.removeSourceComment(sourceFile);
    } else {
      const commentPath = this.resolveSourceCommentPath(sourceFile);
      await mkdir(path.dirname(commentPath), { recursive: true });
      await writeFile(
        commentPath,
        [
          `# Source context: ${path.basename(sourcePath)}`,
          "",
          `Source file: ${path.relative(this.rawVaultPath, sourcePath)}`,
          `Updated: ${new Date().toISOString()}`,
          "",
          trimmed,
          ""
        ].join("\n"),
        "utf8"
      );
    }

    await this.resetGraphifyOutputs();
    return this.queueUpdate(0);
  }

  async ingestDroppedItems(items: ProcessDroppedItem[]): Promise<GraphifyIngestionResult> {
    await this.initialize();
    const writtenFiles = await this.writeRawItems(items);

    if (writtenFiles.length === 0) {
      throw new Error("No dropped files or text were available for Graphify ingestion.");
    }

    return this.queueUpdate(writtenFiles.length);
  }

  async listMcpTools(): Promise<GraphifyMcpToolSpec[]> {
    const client = await this.ensureMcpClient();
    const result = await client.listTools();

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }

  async stopMcp(): Promise<void> {
    const client = this.mcpClient;
    this.mcpClient = null;

    if (client) {
      await client.close();
    }

    if (this.mcpTransport) {
      await this.mcpTransport.close();
      this.mcpTransport = null;
    }
  }

  private async writeRawItems(items: ProcessDroppedItem[]): Promise<string[]> {
    const written: string[] = [];

    for (const [index, item] of items.entries()) {
      const outputPath = this.createRawDestination(item, index);
      const buffer = bufferFromDroppedValue(item.buffer);

      if (buffer) {
        await writeFile(outputPath, buffer);
        written.push(outputPath);
        continue;
      }

      if (item.path) {
        try {
          const fileStat = await stat(item.path);
          if (fileStat.isFile()) {
            await copyFile(item.path, outputPath);
            written.push(outputPath);
            continue;
          }
        } catch {
          // Fall through to text/content handling below.
        }
      }

      const text = item.text ?? item.content;
      if (text?.trim()) {
        await writeFile(outputPath, text, "utf8");
        written.push(outputPath);
      }
    }

    return written;
  }

  private async prepareSpreadsheetComponents(): Promise<string> {
    if (process.env.SECOND_BRAIN_XLSX_COMPONENTS === "0") {
      await this.resetSpreadsheetComponentSidecars();
      return "Spreadsheet component sidecars disabled by SECOND_BRAIN_XLSX_COMPONENTS=0.";
    }

    const sources = await this.listSpreadsheetSources();

    if (sources.length === 0) {
      return "";
    }

    const output: string[] = [];
    for (const sourcePath of sources) {
      output.push(await this.prepareSpreadsheetComponent(sourcePath));
    }

    return output.filter(Boolean).join("\n");
  }

  private async preparePaperComponents(): Promise<string> {
    if (process.env.SECOND_BRAIN_PAPER_COMPONENTS === "0") {
      await this.resetPaperComponentSidecars();
      return "Paper component sidecars disabled by SECOND_BRAIN_PAPER_COMPONENTS=0.";
    }

    const sources = await this.listPaperSources();

    if (sources.length === 0) {
      return "";
    }

    const output: string[] = [];
    for (const sourcePath of sources) {
      output.push(await this.preparePaperComponent(sourcePath));
    }

    return output.filter(Boolean).join("\n");
  }

  private async preparePaperComponent(sourcePath: string): Promise<string> {
    const relativeSource = path.relative(this.rawVaultPath, sourcePath).split(path.sep).join(path.posix.sep);
    const outputPath = path.join(
      this.rawVaultPath,
      paperComponentDirectoryName,
      paperComponentDirectoryNameForSource(relativeSource)
    );
    const indexPath = path.join(outputPath, "artifact-index.json");
    if (await this.isGeneratedOutputFresh(sourcePath, indexPath)) {
      return "";
    }

    await rm(outputPath, { recursive: true, force: true });
    const script = paperComponentScript();
    const invocations = await this.getGraphifyPythonInvocations(["-c", script, sourcePath, outputPath, relativeSource]);
    const failures: string[] = [];

    for (const invocation of invocations) {
      try {
        return await this.runGraphifyUtilityInvocation(invocation);
      } catch (error) {
        failures.push(`${invocation.label}: ${errorMessage(error)}`);
      }
    }

    return [
      `[second-brain] unable to generate research paper components for ${relativeSource}.`,
      "The PDF will still be available to Graphify's plain extraction path.",
      "For richer paper breakdowns, install: uv tool install --upgrade \"graphifyy[pdf,office,openai,mcp]\" --with pymupdf --with pymupdf4llm --with numpy --with matplotlib",
      "Tried:",
      ...failures.map((failure) => `- ${failure}`)
    ].join("\n");
  }

  private async listPaperSources(directory = this.rawVaultPath): Promise<string[]> {
    let entries: Dirent[];

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      if (
        entry.name === "graphify-out" ||
        entry.name === ".graphify" ||
        entry.name === sourceCommentDirectoryName ||
        entry.name === spreadsheetComponentDirectoryName ||
        entry.name === paperComponentDirectoryName
      ) {
        continue;
      }

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.listPaperSources(entryPath)));
        continue;
      }

      if (entry.isFile() && isPaperSource(entryPath)) {
        files.push(entryPath);
      }
    }

    return files.sort((left, right) => left.localeCompare(right));
  }

  private async resetPaperComponentSidecars(): Promise<void> {
    await rm(path.join(this.rawVaultPath, paperComponentDirectoryName), { recursive: true, force: true });
  }

  private async prepareSpreadsheetComponent(sourcePath: string): Promise<string> {
    const relativeSource = path.relative(this.rawVaultPath, sourcePath).split(path.sep).join(path.posix.sep);
    const outputPath = path.join(
      this.rawVaultPath,
      spreadsheetComponentDirectoryName,
      spreadsheetComponentFileName(relativeSource)
    );
    if (await this.isGeneratedOutputFresh(sourcePath, outputPath)) {
      return "";
    }

    const script = spreadsheetComponentScript();
    const invocations = await this.getGraphifyPythonInvocations(["-c", script, sourcePath, outputPath, relativeSource]);
    const failures: string[] = [];

    for (const invocation of invocations) {
      try {
        return await this.runGraphifyUtilityInvocation(invocation);
      } catch (error) {
        failures.push(`${invocation.label}: ${errorMessage(error)}`);
      }
    }

    return [
      `[second-brain] unable to generate spreadsheet components for ${relativeSource}.`,
      "Install Graphify with office support: uv tool install --upgrade \"graphifyy[pdf,office,openai,mcp]\".",
      "Tried:",
      ...failures.map((failure) => `- ${failure}`)
    ].join("\n");
  }

  private async listSpreadsheetSources(directory = this.rawVaultPath): Promise<string[]> {
    let entries: Dirent[];

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      if (
        entry.name === "graphify-out" ||
        entry.name === ".graphify" ||
        entry.name === sourceCommentDirectoryName ||
        entry.name === spreadsheetComponentDirectoryName ||
        entry.name === paperComponentDirectoryName
      ) {
        continue;
      }

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.listSpreadsheetSources(entryPath)));
        continue;
      }

      if (entry.isFile() && isSpreadsheetSource(entryPath)) {
        files.push(entryPath);
      }
    }

    return files.sort((left, right) => left.localeCompare(right));
  }

  private async resetSpreadsheetComponentSidecars(): Promise<void> {
    await rm(path.join(this.rawVaultPath, spreadsheetComponentDirectoryName), { recursive: true, force: true });
  }

  private async removeGeneratedComponentsForSource(sourceFile: string): Promise<void> {
    await Promise.all([
      rm(path.join(this.rawVaultPath, spreadsheetComponentDirectoryName, spreadsheetComponentFileName(sourceFile)), {
        force: true
      }),
      rm(path.join(this.rawVaultPath, paperComponentDirectoryName, paperComponentDirectoryNameForSource(sourceFile)), {
        recursive: true,
        force: true
      })
    ]);
  }

  private async isGeneratedOutputFresh(sourcePath: string, outputPath: string): Promise<boolean> {
    try {
      const [sourceStat, outputStat] = await Promise.all([stat(sourcePath), stat(outputPath)]);
      return outputStat.mtimeMs >= sourceStat.mtimeMs;
    } catch {
      return false;
    }
  }

  private createRawDestination(item: ProcessDroppedItem, index: number): string {
    const fallbackName = item.text || item.content ? "dropped-text.txt" : `dropped-file-${index + 1}`;
    const safeName = safeFilePart(item.name ?? (item.path ? path.basename(item.path) : fallbackName));
    const parsed = path.parse(safeName);
    const unique = `${parsed.name}-${Date.now()}-${randomUUID().slice(0, 8)}${parsed.ext || ".txt"}`;

    return path.join(this.rawVaultPath, unique);
  }

  private queueUpdate(writtenFileCount: number): Promise<GraphifyIngestionResult> {
    this.lastUpdate = this.lastUpdate
      .catch(() => ({
        completed: true,
        writtenFileCount: 0,
        graphPath: this.graphPath,
        reportPath: this.reportPath,
        stdout: "",
        updatedAt: new Date().toISOString()
      }))
      .then(() => this.runGraphifyUpdate(writtenFileCount));

    return this.lastUpdate;
  }

  private async runGraphifyUpdate(writtenFileCount: number): Promise<GraphifyIngestionResult> {
    const primarySettings = this.getGraphifyLocalModelSettings();
    const aiSettings = await this.getAiSettings();
    await this.ensureGraphifyProviderConfig(primarySettings, aiSettings);
    const spreadsheetStdout = await this.prepareSpreadsheetComponents();
    const paperStdout = await this.preparePaperComponents();

    const command =
      process.env.SECOND_BRAIN_GRAPHIFY_INGEST_COMMAND ??
      process.env.SECOND_BRAIN_GRAPHIFY_UPDATE_COMMAND ??
      defaultIngestCommand(primarySettings);
    const graphMtimeBefore = await this.fileMtimeMs(this.graphPath);
    let stdout: string;

    try {
      stdout = await this.runGraphifyCommandWithRetry(command, primarySettings, aiSettings);
    } catch (error) {
      const detail = errorMessage(error);
      if (await this.canUsePartialGraphifyResult(detail, graphMtimeBefore)) {
        stdout = [
          "Graphify reported partial semantic extraction failures, but graph.json was updated.",
          "Second Brain accepted the partial graph so later drops can continue.",
          detail
        ].join("\n\n");
      } else {
        throw error;
      }
    }
    const graphExists = await this.fileExists(this.graphPath);

    if (!graphExists) {
      throw new Error(`Graphify finished but did not create ${this.graphPath}.`);
    }

    const htmlStdout = await this.ensureGraphHtml(primarySettings, aiSettings);
    const combinedStdout = [
      spreadsheetStdout,
      paperStdout,
      stdout,
      process.env.SECOND_BRAIN_CARD_DEFINITIONS === "0" ? "" : "Graphify card definitions scheduled in background.",
      htmlStdout ? `Graphify HTML export:\n${htmlStdout}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    await this.stopMcp();

    const counts = await this.readGraphCounts();
    this.scheduleGraphCardDefinitions();

    return {
      completed: looksComplete(combinedStdout) || graphExists,
      writtenFileCount,
      graphPath: this.graphPath,
      reportPath: this.reportPath,
      ...counts,
      stdout: combinedStdout,
      updatedAt: new Date().toISOString()
    };
  }

  private async ensureGraphHtml(
    settings = this.getGraphifyLocalModelSettings(),
    aiSettings?: AiSettings
  ): Promise<string> {
    const graphExists = await this.fileExists(this.graphPath);

    if (!graphExists) {
      throw new Error(`Graphify graph is not available at ${this.graphPath}.`);
    }

    const shouldExport = await this.shouldExportGraphHtml();
    if (!shouldExport) {
      return "";
    }

    const command = process.env.SECOND_BRAIN_GRAPHIFY_HTML_COMMAND ?? defaultHtmlCommand;
    const stdout = await this.runGraphifyCommand(
      command,
      settings,
      "Graphify HTML export failed",
      aiSettings ?? (await this.getAiSettings())
    );

    if (!(await this.fileExists(this.graphHtmlPath))) {
      throw new Error(
        [
          `Graphify HTML export finished but did not create ${this.graphHtmlPath}.`,
          stdout ? `Graphify output:\n${stdout}` : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    }

    return stdout;
  }

  private async enrichGraphCardDefinitions(): Promise<string> {
    if (process.env.SECOND_BRAIN_CARD_DEFINITIONS === "0") {
      this.updateDefinitionStatus({
        running: false,
        pendingCount: 0,
        updatedCount: 0,
        failedBatchCount: 0,
        lastError: "Card definitions are disabled by SECOND_BRAIN_CARD_DEFINITIONS=0.",
        completedAt: new Date().toISOString()
      });
      return "";
    }

    const aiSettings = await this.getAiSettings();
    const endpointHost = endpointHostLabel(aiSettings.endpoint);
    this.updateDefinitionStatus({
      running: true,
      pendingCount: 0,
      updatedCount: 0,
      failedBatchCount: 0,
      lastError: undefined,
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      endpointHost
    });

    const graphVersion = (await stat(this.graphPath)).mtimeMs;
    const graph = asRecord(JSON.parse(await readFile(this.graphPath, "utf8")));
    if (!graph) {
      this.updateDefinitionStatus({
        running: false,
        completedAt: new Date().toISOString(),
        lastError: "Graphify graph.json did not contain an object."
      });
      return "";
    }

    const nodes = normalizeGraphNodes(graph.nodes);
    if (nodes.length === 0) {
      this.updateDefinitionStatus({
        running: false,
        completedAt: new Date().toISOString(),
        pendingCount: 0
      });
      return "";
    }

    const nodeLabels = new Map(
      nodes.map((node, index) => {
        const id = asString(node.id) || `graph-node-${index}`;
        return [id, asString(node.label) || asString(node.title) || id] as const;
      })
    );
    const related = this.buildRelatedNodeMap(normalizeGraphLinks(graph.links ?? graph.edges), nodeLabels);
    const cards = nodes
      .filter((node) => !asString(node.contextual_definition))
      .map((node, index) => this.toDefinitionInput(node, index, related))
      .filter((card): card is GraphCardDefinitionInput => Boolean(card));
    const maxCardsPerPass = Math.max(1, numberFromEnv(process.env.SECOND_BRAIN_CARD_DEFINITION_MAX_PER_PASS, 24, 1));
    const cardsForThisPass = cards.slice(0, maxCardsPerPass);
    const batchSize = Math.max(1, numberFromEnv(process.env.SECOND_BRAIN_CARD_DEFINITION_BATCH_SIZE, 8, 1));
    let updatedCount = 0;
    let failedBatchCount = 0;
    let lastError = "";

    if (cards.length === 0) {
      this.updateDefinitionStatus({
        running: false,
        pendingCount: 0,
        updatedCount: 0,
        failedBatchCount: 0,
        completedAt: new Date().toISOString()
      });
      return "Graphify card definitions are already current.";
    }

    this.updateDefinitionStatus({
      pendingCount: cards.length,
      updatedCount,
      failedBatchCount
    });

    for (const batch of chunkArray(cardsForThisPass, batchSize)) {
      try {
        const definitions = await this.llm.defineGraphCards(batch);
        const definitionById = new Map(definitions.map((definition) => [definition.id, definition.definition]));

        for (const node of nodes) {
          const id = asString(node.id);
          const definition = id ? definitionById.get(id) : undefined;

          if (definition) {
            node.contextual_definition = definition;
            updatedCount += 1;
          }
        }
      } catch (error) {
        failedBatchCount += 1;
        lastError = errorMessage(error);
        console.warn("Graph card definition batch failed; leaving Graphify summaries in place.", error);
      }

      this.updateDefinitionStatus({
        pendingCount: Math.max(0, cards.length - updatedCount),
        updatedCount,
        failedBatchCount,
        lastError: lastError || undefined
      });
    }

    graph.nodes = nodes;

    if ((await stat(this.graphPath)).mtimeMs !== graphVersion) {
      this.cardDefinitionQueued = true;
      this.updateDefinitionStatus({
        running: false,
        completedAt: new Date().toISOString(),
        lastError: "Graph changed while definitions were running; a fresh definition pass was queued."
      });
      return "Graphify card definitions skipped because a newer graph was written.";
    }

    await writeFile(this.graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
    this.updateDefinitionStatus({
      running: false,
      pendingCount: Math.max(0, cards.length - updatedCount),
      updatedCount,
      failedBatchCount,
      lastError: lastError || undefined,
      completedAt: new Date().toISOString()
    });

    return [
      `Graphify card definitions: ${updatedCount}/${cardsForThisPass.length} cards enriched this pass.`,
      cards.length > cardsForThisPass.length ? `${cards.length - cardsForThisPass.length} cards remain for later passes.` : "",
      failedBatchCount > 0 ? `${failedBatchCount} definition batch${failedBatchCount === 1 ? "" : "es"} failed.` : ""
    ]
      .filter(Boolean)
      .join(" ");
  }

  private scheduleGraphCardDefinitions(): void {
    if (process.env.SECOND_BRAIN_CARD_DEFINITIONS === "0") {
      return;
    }

    if (this.cardDefinitionUpdate) {
      this.cardDefinitionQueued = true;
      return;
    }

    this.cardDefinitionUpdate = this.enrichGraphCardDefinitions()
      .then((message) => {
        if (message) {
          console.info(message);
        }
      })
      .catch((error) => {
        this.updateDefinitionStatus({
          running: false,
          failedBatchCount: this.definitionStatus.failedBatchCount + 1,
          lastError: errorMessage(error),
          completedAt: new Date().toISOString()
        });
        console.warn("Graphify card definition background pass failed; Board will use Graphify summaries.", error);
      })
      .finally(() => {
        this.cardDefinitionUpdate = null;

        if (this.cardDefinitionQueued) {
          this.cardDefinitionQueued = false;
          this.scheduleGraphCardDefinitions();
        }
      });
  }

  private updateDefinitionStatus(patch: Partial<GraphDefinitionStatus>): void {
    this.definitionStatus = {
      ...this.definitionStatus,
      ...patch,
      updatedAt: new Date().toISOString()
    };
  }

  private buildRelatedNodeMap(
    links: GraphifyLinkRecord[],
    labels: Map<string, string>
  ): Map<string, string[]> {
    const related = new Map<string, string[]>();

    for (const link of links) {
      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);

      if (!source || !target) {
        continue;
      }

      related.set(source, [...(related.get(source) ?? []), labels.get(target) ?? target]);
      related.set(target, [...(related.get(target) ?? []), labels.get(source) ?? source]);
    }

    return related;
  }

  private toDefinitionInput(
    node: GraphifyNodeRecord,
    index: number,
    related: Map<string, string[]>
  ): GraphCardDefinitionInput | null {
    const id = asString(node.id) || `graph-node-${index}`;
    const title = asString(node.label) || asString(node.title) || id;

    if (!title) {
      return null;
    }

    return {
      id,
      title,
      type: asString(node.type) || asString(node.node_type) || asString(node.file_type) || "entity",
      summary: asString(node.summary) || asString(node.description) || asString(node.source_location) || title,
      sourceFile: asString(node.source_file) || asString(node.sourceFile),
      sourceContext: asString(node.source_location) || asString(node.description) || asString(node.summary),
      community: asString(node.community) || "unclustered",
      related: Array.from(new Set(related.get(id) ?? [])).slice(0, 6)
    };
  }

  private async shouldExportGraphHtml(): Promise<boolean> {
    try {
      const [graphStat, htmlStat] = await Promise.all([stat(this.graphPath), stat(this.graphHtmlPath)]);
      return htmlStat.mtimeMs + 1000 < graphStat.mtimeMs;
    } catch {
      return true;
    }
  }

  private async runGraphifyCommandWithRetry(
    command: string,
    primarySettings: GraphifyLocalModelSettings,
    aiSettings: AiSettings
  ): Promise<string> {
    try {
      return await this.runGraphifyCommand(command, primarySettings, "Graphify ingestion failed", aiSettings);
    } catch (error) {
      const primaryError = errorMessage(error);

      if (!this.canRetryGraphifyCommand() || !this.shouldRetryWithStrictJson(primaryError)) {
        throw this.enrichGraphifyError(primaryError);
      }

      const retrySettings = this.getStrictRetrySettings(primarySettings);
      await this.ensureGraphifyProviderConfig(retrySettings, aiSettings);

      try {
        const retryStdout = await this.runGraphifyCommand(
          command,
          retrySettings,
          "Graphify ingestion retry failed",
          aiSettings
        );

        return [
          "Primary Graphify attempt failed; retried with strict local JSON settings.",
          `Strict retry settings: temperature=${retrySettings.temperature}, max_completion_tokens=${retrySettings.maxTokens}.`,
          `Primary failure:\n${primaryError}`,
          retryStdout ? `Retry output:\n${retryStdout}` : ""
        ]
          .filter(Boolean)
          .join("\n\n");
      } catch (retryError) {
        throw this.enrichGraphifyError(
          [
            "Graphify strict retry also failed.",
            `Primary failure:\n${primaryError}`,
            `Strict retry failure:\n${errorMessage(retryError)}`
          ].join("\n\n")
        );
      }
    }
  }

  private runGraphifyCommand(
    command: string,
    settings: GraphifyLocalModelSettings,
    failureLabel: string,
    aiSettings: AiSettings
  ): Promise<string> {
    if (command.trim().startsWith("graphify ")) {
      const graphifyArgs = parseArgs(command).slice(1);
      return this.runGraphifyCli(graphifyArgs, settings, failureLabel, aiSettings);
    }

    const options: ExecOptions = {
      cwd: this.rawVaultPath,
      timeout: Number(process.env.SECOND_BRAIN_GRAPHIFY_TIMEOUT_MS ?? updateTimeoutMs),
      maxBuffer: maxExecBuffer,
      env: this.buildGraphifyEnvironment(settings, aiSettings),
      windowsHide: true
    };

    return new Promise<string>((resolve, reject) => {
      exec(command, options, (error, commandStdout, commandStderr) => {
        const combined = [commandStdout, commandStderr].filter(Boolean).join("\n").trim();

        if (error) {
          reject(
            new Error(
              [
                `${failureLabel} while running: ${command}`,
                error.message,
                combined ? `Graphify output:\n${combined}` : ""
              ]
                .filter(Boolean)
                .join("\n\n")
            )
          );
          return;
        }

        resolve(combined);
      });
    });
  }

  private async runGraphifyCli(
    graphifyArgs: string[],
    settings: GraphifyLocalModelSettings,
    failureLabel: string,
    aiSettings: AiSettings
  ): Promise<string> {
    const invocations = await this.getGraphifyInvocations(graphifyArgs);
    const failures: string[] = [];

    for (const invocation of invocations) {
      try {
        return await this.runGraphifyInvocation(invocation, settings, aiSettings);
      } catch (error) {
        failures.push(`${invocation.label}: ${errorMessage(error)}`);
      }
    }

    throw new Error(
      [
        `${failureLabel} while running Graphify.`,
        "Tried:",
        ...failures.map((failure) => `- ${failure}`)
      ].join("\n")
    );
  }

  private async getGraphifyInvocations(graphifyArgs: string[]): Promise<GraphifyInvocation[]> {
    const invocations: GraphifyInvocation[] = [];
    const configured = process.env.SECOND_BRAIN_GRAPHIFY_BIN?.trim();

    if (configured) {
      invocations.push({
        label: "SECOND_BRAIN_GRAPHIFY_BIN",
        command: configured,
        args: graphifyArgs,
        shell: isCmdShim(configured)
      });
    }

    const bundled = await this.findBundledGraphifyCommand();
    if (bundled) {
      invocations.push({
        label: "bundled Graphify runtime",
        command: bundled,
        args: graphifyArgs,
        shell: isCmdShim(bundled)
      });
    }

    const uvInstalled = await this.findUvToolGraphifyCommand();
    if (uvInstalled) {
      invocations.push({
        label: "uv installed graphifyy",
        command: uvInstalled,
        args: graphifyArgs,
        shell: isCmdShim(uvInstalled)
      });
    }

    invocations.push(
      {
        label: "uv tool graphifyy",
        command: "uv",
        args: ["tool", "run", "--from", graphifyToolPackage, "graphify", ...graphifyArgs]
      },
      {
        label: "Windows py module",
        command: "py",
        args: ["-m", "graphify", ...graphifyArgs]
      },
      {
        label: "python module",
        command: process.platform === "win32" ? "python" : "python3",
        args: ["-m", "graphify", ...graphifyArgs]
      },
      {
        label: "PATH graphify",
        command: "graphify",
        args: graphifyArgs
      }
    );

    return invocations;
  }

  private async getGraphifyPythonInvocations(pythonArgs: string[]): Promise<GraphifyInvocation[]> {
    const invocations: GraphifyInvocation[] = [];
    const configured = process.env.SECOND_BRAIN_GRAPHIFY_PYTHON?.trim();

    if (configured) {
      invocations.push({
        label: "SECOND_BRAIN_GRAPHIFY_PYTHON",
        command: configured,
        args: pythonArgs,
        shell: isCmdShim(configured)
      });
    }

    const bundledPython = await this.findBundledGraphifyPythonCommand();
    if (bundledPython) {
      invocations.push({
        label: "bundled Graphify Python runtime",
        command: bundledPython,
        args: pythonArgs,
        shell: isCmdShim(bundledPython)
      });
    }

    const uvInstalledPython = await this.findUvToolGraphifyPythonCommand();
    if (uvInstalledPython) {
      invocations.push({
        label: "uv installed graphifyy Python",
        command: uvInstalledPython,
        args: pythonArgs,
        shell: isCmdShim(uvInstalledPython)
      });
    }

    invocations.push(
      {
        label: "uv tool graphifyy python",
        command: "uv",
        args: ["tool", "run", "--from", graphifyToolPackage, "python", ...pythonArgs]
      },
      {
        label: "Windows py",
        command: "py",
        args: pythonArgs
      },
      {
        label: "python module runtime",
        command: process.platform === "win32" ? "python" : "python3",
        args: pythonArgs
      }
    );

    return invocations;
  }

  private async findUvToolGraphifyCommand(): Promise<string | null> {
    let uvToolDir = "";

    try {
      uvToolDir = await new Promise<string>((resolve, reject) => {
        execFile("uv", ["tool", "dir"], { windowsHide: true }, (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(stdout.trim().split(/\r?\n/)[0] ?? "");
        });
      });
    } catch {
      return null;
    }

    const candidates = [
      path.join(uvToolDir, "graphifyy", "Scripts", "graphify.exe"),
      path.join(uvToolDir, "graphifyy", "Scripts", "graphify.cmd"),
      path.join(uvToolDir, "graphifyy", "bin", "graphify")
    ];

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async findUvToolGraphifyPythonCommand(): Promise<string | null> {
    let uvToolDir = "";

    try {
      uvToolDir = await new Promise<string>((resolve, reject) => {
        execFile("uv", ["tool", "dir"], { windowsHide: true }, (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(stdout.trim().split(/\r?\n/)[0] ?? "");
        });
      });
    } catch {
      return null;
    }

    const candidates = [
      path.join(uvToolDir, "graphifyy", "Scripts", "python.exe"),
      path.join(uvToolDir, "graphifyy", "bin", "python")
    ];

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async findBundledGraphifyCommand(): Promise<string | null> {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "bin", "graphify.cmd") : "",
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "bin", "graphify.exe") : "",
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "bin", "graphify") : "",
      path.join(process.cwd(), "resources", "graphify-runtime", "bin", process.platform === "win32" ? "graphify.cmd" : "graphify")
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async findBundledGraphifyPythonCommand(): Promise<string | null> {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "python", "python.exe") : "",
      resourcesPath ? path.join(resourcesPath, "graphify-runtime", "python", "python") : "",
      path.join(process.cwd(), "resources", "graphify-runtime", "python", process.platform === "win32" ? "python.exe" : "python")
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private runGraphifyInvocation(
    invocation: GraphifyInvocation,
    settings: GraphifyLocalModelSettings,
    aiSettings: AiSettings
  ): Promise<string> {
    const options: ExecFileOptions = {
      cwd: this.rawVaultPath,
      timeout: Number(process.env.SECOND_BRAIN_GRAPHIFY_TIMEOUT_MS ?? updateTimeoutMs),
      maxBuffer: maxExecBuffer,
      env: this.buildGraphifyEnvironment(settings, aiSettings),
      windowsHide: true,
      shell: invocation.shell
    };

    return new Promise<string>((resolve, reject) => {
      execFile(invocation.command, invocation.args, options, (error, commandStdout, commandStderr) => {
        const combined = [commandStdout, commandStderr].filter(Boolean).join("\n").trim();

        if (error) {
          reject(
            new Error(
              [
                `Command: ${formatInvocation(invocation)}`,
                error.message,
                combined ? `Graphify output:\n${combined}` : ""
              ]
                .filter(Boolean)
                .join("\n\n")
            )
          );
          return;
        }

        resolve(combined);
      });
    });
  }

  private runGraphifyUtilityInvocation(invocation: GraphifyInvocation): Promise<string> {
    const options: ExecFileOptions = {
      cwd: this.rawVaultPath,
      timeout: Number(process.env.SECOND_BRAIN_XLSX_COMPONENT_TIMEOUT_MS ?? 120_000),
      maxBuffer: maxExecBuffer,
      env: process.env,
      windowsHide: true,
      shell: invocation.shell
    };

    return new Promise<string>((resolve, reject) => {
      execFile(invocation.command, invocation.args, options, (error, commandStdout, commandStderr) => {
        const combined = [commandStdout, commandStderr].filter(Boolean).join("\n").trim();

        if (error) {
          reject(
            new Error(
              [
                `Command: ${formatInvocation(invocation)}`,
                error.message,
                combined ? `Output:\n${combined}` : ""
              ]
                .filter(Boolean)
                .join("\n\n")
            )
          );
          return;
        }

        resolve(combined);
      });
    });
  }

  private async ensureGraphifyProviderConfig(
    settings = this.getGraphifyLocalModelSettings(),
    aiSettings?: AiSettings
  ): Promise<void> {
    const resolvedAiSettings = aiSettings ?? (await this.getAiSettings());
    const graphifyConfigPath = path.join(this.rawVaultPath, ".graphify");
    const providerPath = path.join(graphifyConfigPath, "providers.json");
    const providerConfig: Record<string, GraphifyProviderConfig> = {
      [graphifyProviderName]: {
        base_url: normalizeOpenAiBaseUrl(this.getGraphifyLlmEndpoint(resolvedAiSettings)),
        default_model: this.getGraphifyLlmModel(resolvedAiSettings),
        model_env_key: "SECOND_BRAIN_GRAPHIFY_LLM_MODEL",
        env_key: "SECOND_BRAIN_GRAPHIFY_LLM_API_KEY",
        pricing: {
          input: 0,
          output: 0
        },
        temperature: settings.temperature,
        max_completion_tokens: settings.maxTokens
      }
    };

    await mkdir(graphifyConfigPath, { recursive: true });
    await writeFile(providerPath, `${JSON.stringify(providerConfig, null, 2)}\n`, "utf8");
  }

  private buildGraphifyEnvironment(settings: GraphifyLocalModelSettings, aiSettings: AiSettings): NodeJS.ProcessEnv {
    const endpoint = this.getGraphifyLlmEndpoint(aiSettings);
    const model = this.getGraphifyLlmModel(aiSettings);
    const maxTokens = String(settings.maxTokens);

    return {
      ...process.env,
      GRAPHIFY_ALLOW_LOCAL_PROVIDERS: process.env.GRAPHIFY_ALLOW_LOCAL_PROVIDERS ?? "1",
      GRAPHIFY_MAX_OUTPUT_TOKENS: maxTokens,
      SECOND_BRAIN_GRAPHIFY_LLM_API_KEY:
        process.env.SECOND_BRAIN_GRAPHIFY_LLM_API_KEY ??
        aiSettings.apiKey ??
        "second-brain-local",
      SECOND_BRAIN_GRAPHIFY_LLM_ENDPOINT: endpoint,
      SECOND_BRAIN_GRAPHIFY_LLM_MODEL: process.env.SECOND_BRAIN_GRAPHIFY_LLM_MODEL ?? model,
      SECOND_BRAIN_GRAPHIFY_TEMPERATURE: String(settings.temperature)
    };
  }

  private getGraphifyLlmEndpoint(aiSettings: AiSettings): string {
    return (
      process.env.SECOND_BRAIN_GRAPHIFY_LLM_ENDPOINT ??
      aiSettings.endpoint ??
      defaultLocalModelEndpoint
    );
  }

  private getGraphifyLlmModel(aiSettings: AiSettings): string {
    return (
      process.env.SECOND_BRAIN_GRAPHIFY_LLM_MODEL ??
      aiSettings.model ??
      defaultLocalModelName
    );
  }

  private async getAiSettings(): Promise<AiSettings> {
    return this.settingsProvider();
  }

  private getGraphifyTemperature(): number {
    return numberFromEnv(process.env.SECOND_BRAIN_GRAPHIFY_TEMPERATURE, defaultGraphifyTemperature);
  }

  private getGraphifyMaxTokens(): number {
    return numberFromEnv(
      process.env.SECOND_BRAIN_GRAPHIFY_MAX_TOKENS ?? process.env.GRAPHIFY_MAX_OUTPUT_TOKENS,
      defaultGraphifyMaxTokens,
      1
    );
  }

  private getGraphifyRetryMaxTokens(): number {
    return numberFromEnv(process.env.SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS, defaultGraphifyRetryMaxTokens, 1);
  }

  private getGraphifyLocalModelSettings(): GraphifyLocalModelSettings {
    return {
      temperature: this.getGraphifyTemperature(),
      maxTokens: this.getGraphifyMaxTokens()
    };
  }

  private getStrictRetrySettings(primarySettings: GraphifyLocalModelSettings): GraphifyLocalModelSettings {
    return {
      temperature: defaultGraphifyRetryTemperature,
      maxTokens: Math.min(primarySettings.maxTokens, this.getGraphifyRetryMaxTokens())
    };
  }

  private canRetryGraphifyCommand(): boolean {
    return (
      process.env.SECOND_BRAIN_GRAPHIFY_INGEST_COMMAND === undefined &&
      process.env.SECOND_BRAIN_GRAPHIFY_UPDATE_COMMAND === undefined
    );
  }

  private shouldRetryWithStrictJson(message: string): boolean {
    return /invalid JSON|hollow response|empty or filtered response|chunk\s+\d+\/\d+\s+failed|truncated at max_completion_tokens|graph is empty|extraction produced no nodes/i.test(
      message
    );
  }

  private enrichGraphifyError(message: string): Error {
    const runtimeHint = /access is denied|eacces|permission denied|spawn .* denied/i.test(message)
      ? [
          "Graphify runtime guidance:",
          "- The app now tries a bundled runtime, the direct uv tool executable, `uv tool run --from graphifyy[pdf,office,openai,mcp] graphify`, Python module fallbacks, then PATH.",
          "- For beta machines, install the document-capable tool with `uv tool install --upgrade \"graphifyy[pdf,office,openai,mcp]\"`.",
          "- If Graphify is installed somewhere custom, set `SECOND_BRAIN_GRAPHIFY_BIN` to the full graphify executable path."
        ].join("\n")
      : "";
    const localModelHint = [
      "Local model guidance:",
      "- The app first tries 8192 completion tokens and retries once with strict JSON settings capped at 4096.",
      "- If this still fails, restart llama-server with a larger context, for example `-c 8192` or `-c 12288`.",
      "- For Gemma/Gemma-style thinking templates, disable thinking in the server/template if available; hidden thinking can consume completion budget before the JSON closes.",
      "- You can lower the retry cap with `SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS=2048`."
    ].join("\n");

    return new Error([message, runtimeHint, localModelHint].filter(Boolean).join("\n\n"));
  }

  private async ensureMcpClient(): Promise<Client> {
    if (this.mcpClient) {
      return this.mcpClient;
    }

    const graphExists = await this.fileExists(this.graphPath);
    if (!graphExists) {
      throw new Error(`Graphify graph is not available at ${this.graphPath}.`);
    }

    const command = await this.resolveMcpCommand();
    const args =
      process.env.SECOND_BRAIN_GRAPHIFY_MCP_ARGS !== undefined
        ? parseArgs(process.env.SECOND_BRAIN_GRAPHIFY_MCP_ARGS).map((arg) => arg.replace("{graphPath}", this.graphPath))
        : ["-m", "graphify.serve", this.graphPath];
    const client = new Client({
      name: "second-brain-graphify",
      version: "0.1.0"
    });
    const transport = new StdioClientTransport({
      command,
      args,
      cwd: this.rawVaultPath,
      stderr: "pipe"
    });

    transport.stderr?.on("data", (chunk) => {
      console.warn("Graphify MCP stderr", chunk.toString());
    });

    await client.connect(transport);
    this.mcpClient = client;
    this.mcpTransport = transport;
    return client;
  }

  private async resolveMcpCommand(): Promise<string> {
    if (process.env.SECOND_BRAIN_GRAPHIFY_MCP_COMMAND) {
      return process.env.SECOND_BRAIN_GRAPHIFY_MCP_COMMAND;
    }

    if (process.platform === "win32") {
      return "python";
    }

    try {
      const graphifyBin = await new Promise<string>((resolve, reject) => {
        exec("command -v graphify", { windowsHide: true }, (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(stdout.trim().split(/\r?\n/)[0] ?? "");
        });
      });

      if (graphifyBin) {
        const firstLine = (await readFile(graphifyBin, "utf8")).split(/\r?\n/)[0] ?? "";
        const shebang = firstLine.startsWith("#!") ? firstLine.slice(2).trim() : "";

        if (shebang) {
          return shebang;
        }
      }
    } catch {
      // Fall back below.
    }

    return "python3";
  }

  private resolveSourcePath(sourceFile: string): string {
    return path.isAbsolute(sourceFile) ? sourceFile : path.join(this.rawVaultPath, sourceFile);
  }

  private resolveRemovableSourcePath(sourceFile: string): string {
    const candidate = this.resolveSourcePath(sourceFile);
    const resolvedRaw = path.resolve(this.rawVaultPath);
    const resolvedCandidate = path.resolve(candidate);
    const relative = path.relative(resolvedRaw, resolvedCandidate);

    if (relative.startsWith("..") || path.isAbsolute(relative) || !relative) {
      throw new Error(`Refusing to remove source outside the raw vault: ${sourceFile}`);
    }

    if (
      relative
        .split(path.sep)
        .some((part) => part === "graphify-out" || part === spreadsheetComponentDirectoryName || part === paperComponentDirectoryName)
    ) {
      throw new Error(`Refusing to remove generated Graphify artifact: ${sourceFile}`);
    }

    return resolvedCandidate;
  }

  private resolveSourceCommentPath(sourceFile: string): string {
    return path.join(this.rawVaultPath, sourceCommentDirectoryName, sourceCommentFileName(sourceFile));
  }

  private async readSourceComment(sourceFile: string): Promise<string> {
    try {
      return await readFile(this.resolveSourceCommentPath(sourceFile), "utf8");
    } catch {
      return "";
    }
  }

  private async listCallflowHtmlCandidates(
    directory = this.graphOutPath
  ): Promise<Array<{ path: string; updatedAt: string; mtimeMs: number }>> {
    let entries: Dirent[];

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    const candidates: Array<{ path: string; updatedAt: string; mtimeMs: number }> = [];
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        candidates.push(...(await this.listCallflowHtmlCandidates(entryPath)));
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".html") || entryPath === this.graphHtmlPath) {
        continue;
      }

      const entryStat = await stat(entryPath);
      candidates.push({
        path: entryPath,
        updatedAt: entryStat.mtime.toISOString(),
        mtimeMs: entryStat.mtimeMs
      });
    }

    return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  }

  private async removeSourceComment(sourceFile: string): Promise<void> {
    await rm(this.resolveSourceCommentPath(sourceFile), { force: true });
  }

  private async renameSourceComment(sourceFile: string, nextSourceFile: string): Promise<void> {
    const currentCommentPath = this.resolveSourceCommentPath(sourceFile);
    const nextCommentPath = this.resolveSourceCommentPath(nextSourceFile);

    try {
      await mkdir(path.dirname(nextCommentPath), { recursive: true });
      await rename(currentCommentPath, nextCommentPath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return;
      }

      throw error;
    }
  }

  private async mergeSourceComment(sourceFile: string, targetSourceFile: string): Promise<void> {
    const sourceComment = (await this.readSourceComment(sourceFile)).trim();
    if (!sourceComment) {
      return;
    }

    const targetComment = (await this.readSourceComment(targetSourceFile)).trim();
    const nextComment = [
      targetComment,
      targetComment ? "\n---\n" : "",
      sourceComment,
      "",
      `Merged from: ${sourceFile}`,
      `Merged at: ${new Date().toISOString()}`
    ]
      .filter(Boolean)
      .join("\n");
    const targetCommentPath = this.resolveSourceCommentPath(targetSourceFile);
    await mkdir(path.dirname(targetCommentPath), { recursive: true });
    await writeFile(targetCommentPath, `${nextComment.trim()}\n`, "utf8");
    await this.removeSourceComment(sourceFile);
  }

  private async resetGraphifyOutputs(): Promise<void> {
    await this.stopMcp();
    await rm(this.graphOutPath, { recursive: true, force: true });
  }

  private async hasRawSourceFiles(directory = this.rawVaultPath): Promise<boolean> {
    let entries: Dirent[];

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      if (
        entry.name === "graphify-out" ||
        entry.name === ".graphify" ||
        entry.name === sourceCommentDirectoryName ||
        entry.name === spreadsheetComponentDirectoryName ||
        entry.name === paperComponentDirectoryName
      ) {
        continue;
      }

      const entryPath = path.join(directory, entry.name);

      if (entry.isFile()) {
        return true;
      }

      if (entry.isDirectory() && (await this.hasRawSourceFiles(entryPath))) {
        return true;
      }
    }

    return false;
  }

  private async writeEmptyGraphResult(): Promise<GraphifyIngestionResult> {
    const updatedAt = new Date().toISOString();
    await mkdir(this.graphOutPath, { recursive: true });
    await Promise.all([
      writeFile(this.graphPath, `${JSON.stringify({ nodes: [], links: [] }, null, 2)}\n`, "utf8"),
      writeFile(this.reportPath, "# Graphify Report\n\nNo raw sources are currently stored.\n", "utf8"),
      writeFile(
        this.graphHtmlPath,
        [
          "<!doctype html>",
          "<html><body style=\"margin:0;display:grid;place-items:center;height:100vh;background:#0f172a;color:#e2e8f0;font-family:sans-serif;\">",
          "<p>No raw sources are currently stored.</p>",
          "</body></html>"
        ].join(""),
        "utf8"
      )
    ]);

    return {
      completed: true,
      writtenFileCount: 0,
      graphPath: this.graphPath,
      reportPath: this.reportPath,
      graphNodeCount: 0,
      graphEdgeCount: 0,
      stdout: "Removed final source and wrote an empty Graphify graph.",
      updatedAt
    };
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async fileMtimeMs(filePath: string): Promise<number | null> {
    try {
      return (await stat(filePath)).mtimeMs;
    } catch {
      return null;
    }
  }

  private async canUsePartialGraphifyResult(errorDetail: string, graphMtimeBefore: number | null): Promise<boolean> {
    if (!/chunk\s+\d+\/\d+\s+failed|LLM returned empty or filtered response|semantic extraction/i.test(errorDetail)) {
      return false;
    }

    const graphMtimeAfter = await this.fileMtimeMs(this.graphPath);
    if (graphMtimeAfter === null) {
      return false;
    }

    return graphMtimeBefore === null ? graphMtimeAfter > 0 : graphMtimeAfter > graphMtimeBefore;
  }

  private async readGraphCounts(): Promise<Pick<GraphifyIngestionResult, "graphNodeCount" | "graphEdgeCount">> {
    try {
      const graph = JSON.parse(await readFile(this.graphPath, "utf8")) as GraphifyGraph;
      return {
        graphNodeCount: graph.nodes?.length,
        graphEdgeCount: graph.links?.length ?? graph.edges?.length
      };
    } catch {
      return {};
    }
  }
}
