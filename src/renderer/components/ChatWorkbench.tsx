import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import katex from "katex";
import {
  AlertTriangle,
  DatabaseZap,
  Download,
  FilePlus,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Plus,
  RefreshCcw,
  SearchCheck,
  Send,
  Trash2
} from "lucide-react";
import type {
  AppSettings,
  AppBuildInfo,
  ChatArtifact,
  ChatMessage,
  ChatStreamEvent,
  ChatThread,
  GraphifyContextResult,
  ProposedTrackerDraft,
  UserPersona
} from "../../shared/ipc";
import { isProductionBuild, presentError, presentPossiblyDetailedError, productionErrorMessage } from "../lib/errorPresentation";
import { useTrackerStore } from "../stores/useTrackerStore";

type ChatWorkbenchProps = {
  refreshKey: number;
};

const defaultAppearance: AppSettings["appearance"] = {
  topBarMirrored: false,
  persona: "dolphin"
};

type MarkdownBlock =
  | { kind: "code"; language: string; content: string }
  | { kind: "heading"; level: number; content: string }
  | { kind: "math"; content: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; content: string };

type ResponseSection = {
  id: string;
  title: string;
  content: string;
};

const appIconUrl = new URL("../../../build/second-brain-app-icon.PNG", import.meta.url).href;

const dolphinPersonaAsset = { label: "Dolphin", src: new URL("../../../build/Dolphin.PNG", import.meta.url).href };
const personaAssets: Record<UserPersona, { label: string; src: string }> = {
  dolphin: dolphinPersonaAsset,
  jellyfish: { label: "Jellyfish", src: new URL("../../../build/Jellyfish.PNG", import.meta.url).href },
  ant: { label: "Ant", src: new URL("../../../build/Ant.PNG", import.meta.url).href },
  monkey: { label: "Monkey", src: new URL("../../../build/Monkey.PNG", import.meta.url).href },
  hippo: { label: "Hippo", src: new URL("../../../build/Hippo.PNG", import.meta.url).href }
};

function SecondBrainAvatar(): JSX.Element {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-950 shadow-sm ring-1 ring-emerald-200/60">
      <img alt="" className="h-full w-full object-cover" src={appIconUrl} />
    </span>
  );
}

function PersonaAvatar({ persona }: { persona: UserPersona }): JSX.Element {
  const asset = personaAssets[persona] ?? dolphinPersonaAsset;
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-900/10">
      <img alt={asset.label} className="h-full w-full object-cover" src={asset.src} />
    </span>
  );
}

function NeuronPulse(): JSX.Element {
  return (
    <svg aria-hidden="true" className="neuron-pulse" viewBox="0 0 86 34">
      <path className="neuron-pulse__edge" d="M13 17 L31 8 L48 18 L67 9" />
      <path className="neuron-pulse__edge" d="M13 17 L31 26 L48 18 L67 25" />
      <path className="neuron-pulse__signal neuron-pulse__signal--one" d="M13 17 L31 8 L48 18 L67 9" />
      <path className="neuron-pulse__signal neuron-pulse__signal--two" d="M13 17 L31 26 L48 18 L67 25" />
      {[13, 31, 48, 67].map((x, index) => (
        <circle key={`top-${x}`} className={`neuron-pulse__node neuron-pulse__node--${index + 1}`} cx={x} cy={index === 1 ? 8 : index === 3 ? 9 : 17} r="3.8" />
      ))}
      <circle className="neuron-pulse__node neuron-pulse__node--5" cx="31" cy="26" r="3.8" />
      <circle className="neuron-pulse__node neuron-pulse__node--6" cx="67" cy="25" r="3.8" />
    </svg>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function hasGeneratedFileArtifacts(message: ChatMessage): boolean {
  return Boolean(message.artifacts?.some((artifact) => artifact.source === "local-tool" || artifact.source === "proxy-attachment"));
}

function sortedThreads(threads: ChatThread[]): ChatThread[] {
  return [...threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function isFreshUnusedThread(thread: ChatThread | null | undefined): boolean {
  return Boolean(thread && thread.messages.length === 0);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatDueDate(value: string | undefined): string {
  if (!value) {
    return "No deadline";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const hasExplicitTime = !/^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    ...(hasExplicitTime ? { hour: "numeric", minute: "2-digit" } : {})
  }).format(date);
}

function apiModelName(api: unknown): string {
  if (!api || typeof api !== "object" || Array.isArray(api)) {
    return "";
  }

  const model = (api as Record<string, unknown>).model;
  return typeof model === "string" ? model.trim() : "";
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "section";
}

function splitResponseSections(content: string): ResponseSection[] {
  const lines = content.split(/\r?\n/);
  const sections: ResponseSection[] = [];
  let currentTitle = "Response";
  let currentLines: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading && currentLines.some((candidate) => candidate.trim())) {
      const sectionContent = currentLines.join("\n").trim();
      sections.push({
        id: `${slug(currentTitle)}-${sections.length}`,
        title: currentTitle,
        content: sectionContent
      });
      currentTitle = heading[2]?.trim() || "Section";
      currentLines = [line];
      continue;
    }

    if (heading && currentLines.length === 0) {
      currentTitle = heading[2]?.trim() || "Section";
    }

    currentLines.push(line);
  }

  const tail = currentLines.join("\n").trim();
  if (tail) {
    sections.push({
      id: `${slug(currentTitle)}-${sections.length}`,
      title: currentTitle,
      content: tail
    });
  }

  if (sections.length > 0) {
    return sections;
  }

  return content
    .split(/\n{2,}/)
    .map((part, index) => part.trim())
    .filter(Boolean)
    .map((part, index) => ({
      id: `part-${index}`,
      title: index === 0 ? "Response" : `Part ${index + 1}`,
      content: part
    }));
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = content.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: string[] = [];
  let codeLanguage = "";
  let codeLines: string[] | null = null;
  let mathLines: string[] | null = null;
  let mathCloseFence: "$$" | "\\]" = "$$";

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", content: paragraph.join("\n").trim() });
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list.length > 0) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
  };

  for (const line of lines) {
    const codeFence = line.match(/^```([\w.+-]*)\s*$/);
    if (codeFence) {
      if (codeLines) {
        blocks.push({ kind: "code", language: codeLanguage, content: codeLines.join("\n") });
        codeLines = null;
        codeLanguage = "";
      } else {
        flushParagraph();
        flushList();
        codeLanguage = codeFence[1] ?? "";
        codeLines = [];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    const singleDollarMath = trimmed.match(/^\$\$(.+)\$\$$/);
    const singleBracketMath = trimmed.match(/^\\\[(.+)\\\]$/);
    if (!mathLines && (singleDollarMath || singleBracketMath)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "math", content: (singleDollarMath?.[1] ?? singleBracketMath?.[1] ?? "").trim() });
      continue;
    }

    if (trimmed === "$$" || trimmed === "\\[" || (mathLines && trimmed === mathCloseFence)) {
      if (mathLines) {
        blocks.push({ kind: "math", content: mathLines.join("\n").trim() });
        mathLines = null;
      } else {
        flushParagraph();
        flushList();
        mathCloseFence = trimmed === "\\[" ? "\\]" : "$$";
        mathLines = [];
      }
      continue;
    }

    if (mathLines) {
      mathLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1]?.length ?? 2, content: heading[2]?.trim() ?? "" });
      continue;
    }

    const listItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1]?.trim() ?? "");
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (codeLines) {
    blocks.push({ kind: "code", language: codeLanguage, content: codeLines.join("\n") });
  }
  if (mathLines) {
    blocks.push({ kind: "math", content: mathLines.join("\n").trim() });
  }
  flushParagraph();
  flushList();

  return blocks;
}

function MathText({
  content,
  displayMode = false,
  inverted = false
}: {
  content: string;
  displayMode?: boolean;
  inverted?: boolean;
}): JSX.Element {
  try {
    const html = katex.renderToString(content, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false
    });
    const className = displayMode
      ? `${inverted ? "bg-white/10 text-white" : "bg-slate-50 text-slate-900"} overflow-auto rounded-md px-3 py-2 text-sm`
      : `${inverted ? "text-white" : "text-slate-900"} inline-block max-w-full align-baseline`;
    return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return displayMode ? (
      <pre className={`${inverted ? "bg-white/10 text-white" : "bg-slate-50 text-slate-900"} overflow-auto rounded-md px-3 py-2 font-serif text-sm italic`}>
        {content}
      </pre>
    ) : (
      <span className={`${inverted ? "text-white" : "text-slate-900"} font-serif italic`}>{content}</span>
    );
  }
}

function InlineMarkdown({ text, inverted = false }: { text: string; inverted?: boolean }): JSX.Element {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\\\([\s\S]*?\\\)|\$[^$\n]+\$)/g;
  const parts = text.split(pattern).filter((part) => part.length > 0);
  return (
    <>
      {parts.map((part, index) => {
        if (/^`[^`]+`$/.test(part)) {
          return (
            <code key={index} className={`${inverted ? "bg-white/15 text-white" : "bg-slate-100 text-slate-900"} rounded px-1 py-0.5 font-mono text-[0.9em]`}>
              {part.slice(1, -1)}
            </code>
          );
        }
        if (/^\*\*[^*]+\*\*$/.test(part)) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (/^\*[^*]+\*$/.test(part)) {
          return <em key={index}>{part.slice(1, -1)}</em>;
        }
        if (/^\$[^$\n]+\$$/.test(part)) {
          return <MathText key={index} content={part.slice(1, -1)} inverted={inverted} />;
        }
        if (/^\\\([\s\S]*\\\)$/.test(part)) {
          return <MathText key={index} content={part.slice(2, -2)} inverted={inverted} />;
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

function highlightedCode(content: string, language: string): ReactNode[] {
  const keywords =
    /^(ts|tsx|js|jsx|python|py|bash|sh|json)$/i.test(language)
      ? new Set([
          "async",
          "await",
          "const",
          "let",
          "function",
          "return",
          "import",
          "export",
          "from",
          "class",
          "type",
          "if",
          "else",
          "for",
          "while",
          "try",
          "catch",
          "true",
          "false",
          "null",
          "def",
          "in",
          "echo"
        ])
      : new Set<string>();
  const tokenPattern = /("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b[A-Za-z_][A-Za-z0-9_]*\b|\d+(?:\.\d+)?|[{}[\]().,:;=+\-*/<>])/g;
  const parts = content.split(tokenPattern).filter((part) => part.length > 0);
  return parts.map((part, index) => {
    const className =
      /^["'`]/.test(part)
        ? "text-emerald-200"
        : keywords.has(part)
          ? "text-sky-200"
          : /^\d/.test(part)
            ? "text-amber-200"
            : /^[{}[\]().,:;=+\-*/<>]$/.test(part)
              ? "text-slate-400"
              : "text-slate-100";
    return (
      <span key={index} className={className}>
        {part}
      </span>
    );
  });
}

function MessageContent({
  content,
  inverted,
  canAddParts,
  disabledAddParts,
  busyPartId,
  onAddPart
}: {
  content: string;
  inverted: boolean;
  canAddParts: boolean;
  disabledAddParts?: boolean;
  busyPartId?: string;
  onAddPart?: (part: ResponseSection) => void;
}): JSX.Element {
  const sections = canAddParts ? splitResponseSections(content) : [{ id: "message", title: "Message", content }];
  return (
    <div className={`space-y-4 text-sm leading-7 ${inverted ? "text-white" : "text-slate-800"}`}>
      {sections.map((section, sectionIndex) => (
        <section key={section.id} className="response-section group/section rounded-lg px-2 py-2 transition">
          {canAddParts && sections.length > 1 ? (
            <div className="mb-2 flex justify-end">
              <button
                aria-label={`Add ${section.title} to brain`}
                className={`add-to-brain-button inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_0_14px_rgba(16,185,129,0.16)] transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  inverted
                    ? "border-emerald-200/30 bg-emerald-300/15 text-emerald-50 hover:bg-emerald-300/25"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-900"
                }`}
                disabled={disabledAddParts}
                title={`Add ${section.title} to brain`}
                type="button"
                onClick={() => onAddPart?.(section)}
              >
                {busyPartId === section.id ? <Loader2 className="animate-spin" size={12} /> : <FilePlus size={12} />}
                Add to brain
              </button>
            </div>
          ) : sectionIndex > 0 ? null : null}
          <div className="space-y-3">
            {parseMarkdownBlocks(section.content).map((block, index) => {
              if (block.kind === "heading") {
                const Heading = block.level <= 1 ? "h2" : block.level === 2 ? "h3" : "h4";
                return (
                  <Heading key={index} className={`${block.level <= 2 ? "text-base" : "text-sm"} font-semibold ${inverted ? "text-white" : "text-slate-950"}`}>
                    <InlineMarkdown text={block.content} inverted={inverted} />
                  </Heading>
                );
              }
              if (block.kind === "list") {
                return (
                  <ul key={index} className="list-disc space-y-1 pl-5">
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex}>
                        <InlineMarkdown text={item} inverted={inverted} />
                      </li>
                    ))}
                  </ul>
                );
              }
              if (block.kind === "math") {
                return (
                  <div key={index} className="overflow-auto">
                    <MathText content={block.content} displayMode inverted={inverted} />
                  </div>
                );
              }
              if (block.kind === "code") {
                return (
                  <pre key={index} className="overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 shadow-inner">
                    <div className="mb-2 text-[10px] font-semibold uppercase text-slate-500">{block.language || "code"}</div>
                    <code>{highlightedCode(block.content, block.language)}</code>
                  </pre>
                );
              }
              return (
                <p key={index} className="whitespace-pre-wrap">
                  <InlineMarkdown text={block.content} inverted={inverted} />
                </p>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function TrackerDraftCards({
  drafts,
  busyId,
  discardedIds,
  trackedIds,
  onConfirm,
  onDiscard
}: {
  drafts: ProposedTrackerDraft[];
  busyId: string;
  discardedIds: Set<string>;
  trackedIds: Set<string>;
  onConfirm: (draft: ProposedTrackerDraft) => void;
  onDiscard: (draftId: string) => void;
}): JSX.Element | null {
  const visible = drafts.filter((draft) => !discardedIds.has(draft.id));
  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {visible.map((draft) => {
        const tracked = trackedIds.has(draft.id);
        const grounded = draft.grounding === "grounded" && draft.linkedNodeIds.length > 0;
        return (
          <div key={draft.id} className="rounded-xl border border-teal-200 bg-teal-50/80 p-3 text-sm text-slate-800 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-950">{draft.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDueDate(draft.dueDate)} · {Math.round(draft.confidence * 100)}% confidence
                </p>
              </div>
              <Pin className="shrink-0 text-teal-700" size={16} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                  grounded
                    ? "border-teal-300 bg-white/80 text-teal-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {grounded ? `Grounded · ${draft.linkedNodeIds.length} nodes` : "Floating task"}
              </span>
            </div>
            {draft.contextKeywords.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {draft.contextKeywords.map((keyword) => (
                  <span key={keyword} className="rounded-full border border-teal-200 bg-white/75 px-2 py-0.5 text-xs font-semibold text-teal-800">
                    {keyword}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white shadow-keycap transition hover:bg-slate-800 active:translate-y-[2px] active:shadow-inner disabled:opacity-50"
                disabled={Boolean(busyId) || tracked}
                type="button"
                onClick={() => onConfirm(draft)}
              >
                {busyId === draft.id ? <Loader2 className="animate-spin" size={13} /> : <Plus size={13} />}
                {tracked ? "Tracked" : "Confirm & Track"}
              </button>
              <button
                className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white/75 px-3 text-xs font-semibold text-slate-600 transition hover:bg-white hover:text-slate-950 active:translate-y-[2px] active:shadow-inner"
                type="button"
                onClick={() => onDiscard(draft.id)}
              >
                Discard
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FileCard({
  artifact,
  busy,
  onAdd,
  onDownload,
  onOpen
}: {
  artifact: ChatArtifact;
  busy: boolean;
  onAdd: () => void;
  onDownload: () => void;
  onOpen: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/75 px-3 py-2 text-xs text-slate-600 shadow-sm">
      <FilePlus size={14} className="shrink-0 text-slate-400" />
      <button className="min-w-0 flex-1 truncate text-left font-semibold text-slate-800 hover:text-slate-950" type="button" onClick={onOpen}>
        {artifact.filename}
        <span className="ml-2 font-normal text-slate-400">{formatBytes(artifact.sizeBytes)}</span>
      </button>
      <button
        className="grid h-7 w-7 place-items-center rounded text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:opacity-50"
        disabled={busy}
        title="Add artifact to ingestion"
        type="button"
        onClick={onAdd}
      >
        {busy ? <Loader2 className="animate-spin" size={13} /> : <Plus size={13} />}
      </button>
      <button
        className="grid h-7 w-7 place-items-center rounded text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:opacity-50"
        disabled={busy}
        title="Download artifact"
        type="button"
        onClick={onDownload}
      >
        <Download size={13} />
      </button>
    </div>
  );
}


export function ChatWorkbench({ refreshKey }: ChatWorkbenchProps): JSX.Element {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [buildInfo, setBuildInfo] = useState<AppBuildInfo | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isSending, setIsSending] = useState(false);
  const [selectedGrounding, setSelectedGrounding] = useState<GraphifyContextResult | null>(null);
  const [artifactBusyId, setArtifactBusyId] = useState("");
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [groundingCollapsed, setGroundingCollapsed] = useState(true);
  const [activeGenerationId, setActiveGenerationId] = useState("");
  const [expandedSuggestionMessageId, setExpandedSuggestionMessageId] = useState("");
  const [discardedDraftIds, setDiscardedDraftIds] = useState<Set<string>>(() => new Set());
  const [trackedDraftIds, setTrackedDraftIds] = useState<Set<string>>(() => new Set());
  const [appearance, setAppearance] = useState<AppSettings["appearance"]>(defaultAppearance);
  const upsertTracker = useTrackerStore((state) => state.upsertTracker);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null,
    [activeThreadId, threads]
  );
  const hasFreshUnusedThread = useMemo(() => threads.some(isFreshUnusedThread), [threads]);
  const productionBuild = isProductionBuild(buildInfo);
  const effectiveGroundingCollapsed = productionBuild || groundingCollapsed;
  const hasPendingAssistantPlaceholder = Boolean(
    activeGenerationId && activeThread?.messages.some((message) => message.role === "assistant" && !message.content.trim() && !message.error)
  );
  const productionBuildRef = useRef(false);

  useEffect(() => {
    productionBuildRef.current = productionBuild;
  }, [productionBuild]);

  useEffect(() => {
    void window.api.app.getBuildInfo().then(setBuildInfo).catch(() => undefined);
    void window.api.settings.getApp().then((settings) => setAppearance(settings.appearance)).catch(() => undefined);
    void loadThreads();
  }, [refreshKey]);

  useEffect(() => {
    return window.api.chat.onStreamEvent(handleStreamEvent);
  }, []);

  function upsertThread(nextThread: ChatThread): void {
    setThreads((current) => sortedThreads([nextThread, ...current.filter((thread) => thread.id !== nextThread.id)]));
    setActiveThreadId(nextThread.id);
  }

  function updateStreamingMessage(event: Extract<ChatStreamEvent, { type: "delta" | "artifact" | "grounding" | "semantic" }>): void {
    setThreads((current) =>
      current.map((thread) => ({
        ...thread,
        messages: thread.messages.map((message) => {
          if (message.id !== event.messageId) {
            return message;
          }

          if (event.type === "delta") {
            return { ...message, content: event.content };
          }

          if (event.type === "grounding") {
            return { ...message, grounding: { ...message.grounding, graphify: event.grounding } };
          }

          if (event.type === "semantic") {
            return { ...message, semantic: event.semantic };
          }

          return { ...message, artifacts: [...(message.artifacts ?? []), event.artifact] };
        })
      }))
    );
  }

  function handleStreamEvent(event: ChatStreamEvent): void {
    if (event.type === "started") {
      setActiveGenerationId(event.generationId);
      upsertThread(event.thread);
      setStatus(productionBuildRef.current ? "Firing up neurons..." : "Querying local Graphify context...");
      return;
    }

    if (event.type === "grounding") {
      setSelectedGrounding(event.grounding);
      updateStreamingMessage(event);
      setStatus("Firing up neurons...");
      return;
    }

    if (event.type === "semantic") {
      updateStreamingMessage(event);
      setStatus(event.semantic.intent === "TRACKER" ? "Drafting tracker cards..." : "Routing request...");
      return;
    }

    if (event.type === "delta" || event.type === "artifact") {
      updateStreamingMessage(event);
      return;
    }

    if (event.type === "done") {
      upsertThread(event.thread);
      setSelectedGrounding(event.message.grounding?.graphify ?? null);
      setStatus(productionBuildRef.current && event.message.error ? productionErrorMessage : event.message.error || "Answer generated.");
      setActiveGenerationId("");
      setIsSending(false);
      return;
    }

    if (event.type === "aborted") {
      if (event.thread) {
        upsertThread(event.thread);
      }
      setStatus("Generation stopped.");
      setActiveGenerationId("");
      setIsSending(false);
      return;
    }

    if (event.thread) {
      upsertThread(event.thread);
    }
    setStatus(productionBuildRef.current ? productionErrorMessage : event.error);
    setActiveGenerationId("");
    setIsSending(false);
  }

  async function loadThreads(): Promise<void> {
    try {
      const loaded = sortedThreads(await window.api.chat.listThreads());
      setThreads(loaded);
      setActiveThreadId((current) => current || loaded[0]?.id || "");
      setStatus("Ready");
    } catch (error) {
      setStatus(presentError(error, "Unable to load chat.", buildInfo));
    }
  }

  async function createThread(): Promise<void> {
    const existingFreshThread = threads.find(isFreshUnusedThread);
    if (existingFreshThread) {
      setActiveThreadId(existingFreshThread.id);
      setSelectedGrounding(null);
      setStatus("Fresh chat already open.");
      return;
    }

    try {
      const thread = await window.api.chat.createThread();
      setThreads((current) => sortedThreads([thread, ...current]));
      setActiveThreadId(thread.id);
      setSelectedGrounding(null);
    } catch (error) {
      setStatus(presentError(error, "Unable to create chat.", buildInfo));
    }
  }

  async function deleteThread(threadId: string): Promise<void> {
    try {
      await window.api.chat.deleteThread(threadId);
      const next = threads.filter((thread) => thread.id !== threadId);
      setThreads(next);
      setActiveThreadId(next[0]?.id ?? "");
      setSelectedGrounding(null);
    } catch (error) {
      setStatus(presentError(error, "Unable to delete chat.", buildInfo));
    }
  }

  async function sendMessage(): Promise<void> {
    const message = draft.trim();
    if (!message || isSending) {
      return;
    }

    setDraft("");
    setIsSending(true);
    setStatus(productionBuild ? "Thinking..." : "Querying local Graphify context...");

    try {
      const response = await window.api.chat.sendMessageStream({
        threadId: activeThread?.id,
        message,
        budget: 2600
      });
      upsertThread(response.thread);
      setSelectedGrounding(response.message.grounding?.graphify ?? null);
      setStatus(presentPossiblyDetailedError(response.message.error, "Answer generated.", buildInfo));
    } catch (error) {
      setStatus(presentError(error, "Unable to send message.", buildInfo));
    } finally {
      setIsSending(false);
    }
  }

  async function stopGeneration(): Promise<void> {
    if (!activeGenerationId) {
      return;
    }

    setStatus("Stopping generation...");
    await window.api.chat.abortGeneration(activeGenerationId);
  }

  async function showGrounding(messageId: string): Promise<void> {
    try {
      setSelectedGrounding(await window.api.chat.getGrounding(messageId));
    } catch (error) {
      setStatus(presentError(error, "Unable to load grounding.", buildInfo));
    }
  }

  async function addResponseToBrain(messageId: string): Promise<void> {
    setArtifactBusyId(messageId);
    setStatus("Saving response artifact...");
    try {
      const saved = await window.api.chat.saveMessageArtifact({ messageId });
      const ingested = await window.api.chat.ingestArtifact(messageId, saved.artifact.id);
      const nextThreads = sortedThreads([ingested.thread, ...threads.filter((thread) => thread.id !== ingested.thread.id)]);
      setThreads(nextThreads);
      setActiveThreadId(ingested.thread.id);
      setStatus("Response artifact added to Graphify ingestion.");
    } catch (error) {
      setStatus(presentError(error, "Unable to add response artifact.", buildInfo));
    } finally {
      setArtifactBusyId("");
    }
  }

  async function addResponsePartToBrain(messageId: string, part: ResponseSection): Promise<void> {
    const busyId = `${messageId}:${part.id}`;
    setArtifactBusyId(busyId);
    setStatus("Saving response section...");
    try {
      const saved = await window.api.chat.saveMessageArtifact({
        messageId,
        title: part.title,
        content: part.content
      });
      const ingested = await window.api.chat.ingestArtifact(messageId, saved.artifact.id);
      const nextThreads = sortedThreads([ingested.thread, ...threads.filter((thread) => thread.id !== ingested.thread.id)]);
      setThreads(nextThreads);
      setActiveThreadId(ingested.thread.id);
      setStatus("Response section added to Graphify ingestion.");
    } catch (error) {
      setStatus(presentError(error, "Unable to add response section.", buildInfo));
    } finally {
      setArtifactBusyId("");
    }
  }

  async function ingestArtifact(messageId: string, artifactId: string): Promise<void> {
    setArtifactBusyId(artifactId);
    try {
      const result = await window.api.chat.ingestArtifact(messageId, artifactId);
      setStatus(result.ingestion ? "Artifact added to Graphify ingestion." : "Artifact saved.");
    } catch (error) {
      setStatus(presentError(error, "Unable to ingest artifact.", buildInfo));
    } finally {
      setArtifactBusyId("");
    }
  }

  async function downloadArtifact(messageId: string, artifactId: string): Promise<void> {
    setArtifactBusyId(artifactId);
    try {
      const result = await window.api.chat.downloadArtifact(messageId, artifactId);
      setStatus(result.downloadedPath ? `Artifact downloaded to ${result.downloadedPath}` : "Download canceled.");
    } catch (error) {
      setStatus(presentError(error, "Unable to download artifact.", buildInfo));
    } finally {
      setArtifactBusyId("");
    }
  }

  async function openArtifact(messageId: string, artifactId: string): Promise<void> {
    setArtifactBusyId(artifactId);
    try {
      await window.api.chat.openArtifact(messageId, artifactId);
      setStatus("Artifact opened.");
    } catch (error) {
      setStatus(presentError(error, "Unable to open artifact.", buildInfo));
    } finally {
      setArtifactBusyId("");
    }
  }

  async function confirmTrackerDraft(draft: ProposedTrackerDraft): Promise<void> {
    setArtifactBusyId(draft.id);
    try {
      const tracker = await window.api.tracker.create({
        title: draft.title,
        description: draft.contextKeywords.length ? `Suggested from chat: ${draft.contextKeywords.join(", ")}` : "Suggested from chat.",
        dueDate: draft.dueDate,
        priority: draft.confidence > 0.9 ? "high" : "medium",
        status: "todo",
        labels: ["chat-suggestion", draft.grounding],
        sourceNodeIds: draft.linkedNodeIds
      });
      upsertTracker(tracker);
      setTrackedDraftIds((current) => new Set([...current, draft.id]));
      setStatus("Tracker item saved.");
    } catch (error) {
      setStatus(presentError(error, "Unable to save tracker item.", buildInfo));
    } finally {
      setArtifactBusyId("");
    }
  }

  function discardTrackerDraft(draftId: string): void {
    setDiscardedDraftIds((current) => new Set([...current, draftId]));
    setStatus("Tracker draft discarded.");
  }

  function highConfidenceDrafts(message: ChatMessage): ProposedTrackerDraft[] {
    return (message.semantic?.proposedTrackers ?? []).filter((draft) => draft.confidence > 0.8);
  }

  return (
    <div
      className={`grid min-h-0 flex-1 border-b border-slate-900/5 bg-floral ${
        historyCollapsed && effectiveGroundingCollapsed
          ? "grid-cols-[minmax(0,1fr)]"
          : historyCollapsed
            ? "grid-cols-[minmax(0,1fr)_360px]"
            : effectiveGroundingCollapsed
              ? "grid-cols-[280px_minmax(0,1fr)]"
              : "grid-cols-[280px_minmax(0,1fr)_360px]"
      }`}
    >
      {!historyCollapsed ? (
      <aside className="min-h-0 border-r border-slate-900/5 bg-white/30 p-3">
        <div className="mb-3 flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-950">Chat</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white/75 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={hasFreshUnusedThread}
              title={
                hasFreshUnusedThread
                  ? "Use the fresh chat before opening another one"
                  : "Open new chat"
              }
              type="button"
              onClick={() => void createThread()}
            >
              <Plus size={13} />
              New
            </button>
            <button
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-950"
              title="Collapse chat history"
              type="button"
              onClick={() => setHistoryCollapsed(true)}
            >
              <PanelLeftClose size={15} />
            </button>
          </div>
        </div>
        <div className="space-y-1 overflow-y-auto">
          {threads.map((thread) => (
            <button
              key={thread.id}
              className={`group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition ${
                activeThread?.id === thread.id ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:bg-white/55"
              }`}
              type="button"
              onClick={() => {
                setActiveThreadId(thread.id);
                setSelectedGrounding(null);
              }}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{thread.title}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-400">
                  {thread.messages.length} messages · {formatTime(thread.updatedAt)}
                </span>
              </span>
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-700 group-hover:opacity-100"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteThread(thread.id);
                }}
              >
                <Trash2 size={13} />
              </span>
            </button>
          ))}
          {threads.length === 0 ? <p className="px-2 py-4 text-sm text-slate-500">No chats yet.</p> : null}
        </div>
      </aside>
      ) : null}

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-900/5 bg-white/20 px-5">
          <div className="flex min-w-0 items-center gap-2">
            {historyCollapsed ? (
              <button
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/65 hover:text-slate-950"
                title="Show chat history"
                type="button"
                onClick={() => setHistoryCollapsed(false)}
              >
                <PanelLeftOpen size={15} />
              </button>
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">{activeThread?.title ?? "New Chat"}</p>
              {!productionBuild ? (
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  Graphify query retrieves a bounded local context packet before the model answers.
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-semibold text-slate-500 transition hover:bg-white/65 hover:text-slate-900"
              type="button"
              onClick={() => void loadThreads()}
            >
              <RefreshCcw size={13} />
              Refresh
            </button>
            {!productionBuild ? (
            <button
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white/65 hover:text-slate-950"
              title={groundingCollapsed ? "Show grounding" : "Collapse grounding"}
              type="button"
              onClick={() => setGroundingCollapsed((value) => !value)}
            >
              {groundingCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
            </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {activeThread?.messages.map((message) => {
            const modelName = apiModelName(message.grounding?.api);
            const generatedFileMessage = hasGeneratedFileArtifacts(message);
            const pendingAssistant = Boolean(activeGenerationId && message.role === "assistant" && !message.content.trim() && !message.error);

            return (
              <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                {message.role !== "user" ? <SecondBrainAvatar /> : null}
                <div
                  className={`max-w-[min(58rem,92%)] rounded-2xl border px-4 py-3 shadow-sm ${
                    message.role === "user"
                      ? "border-slate-900/10 bg-slate-950 text-white"
                      : "border-slate-200 bg-white/75 text-slate-900"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span
                      className={`text-xs font-semibold ${message.role === "user" ? "text-white/70" : "text-slate-500"}`}
                    >
                      {message.role === "user" ? "You" : "Second Brain"}
                    </span>
                    <span className={`text-xs ${message.role === "user" ? "text-white/45" : "text-slate-400"}`}>
                      {formatTime(message.createdAt)}
                    </span>
                  </div>
                  {pendingAssistant ? (
                    <div className="inline-flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-sm font-semibold text-emerald-800">
                      <NeuronPulse />
                      Firing up neurons
                    </div>
                  ) : (
                    <MessageContent
                      canAddParts={message.role === "assistant" && !generatedFileMessage}
                      busyPartId={artifactBusyId.startsWith(`${message.id}:`) ? artifactBusyId.slice(message.id.length + 1) : ""}
                      content={message.content}
                      disabledAddParts={Boolean(artifactBusyId)}
                      inverted={message.role === "user"}
                      onAddPart={(part) => void addResponsePartToBrain(message.id, part)}
                    />
                  )}
                  {message.role === "assistant" && message.semantic?.intent === "TRACKER" ? (
                    <TrackerDraftCards
                      busyId={artifactBusyId}
                      discardedIds={discardedDraftIds}
                      drafts={message.semantic.proposedTrackers}
                      trackedIds={trackedDraftIds}
                      onConfirm={(draft) => void confirmTrackerDraft(draft)}
                      onDiscard={discardTrackerDraft}
                    />
                  ) : null}
                  {message.role === "assistant" && message.semantic?.intent === "RESEARCH" && highConfidenceDrafts(message).length ? (
                    <div className="mt-3">
                      <button
                        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 text-xs font-semibold text-teal-700 shadow-[0_0_12px_rgba(13,148,136,0.18)] transition hover:bg-teal-100"
                        type="button"
                        onClick={() =>
                          setExpandedSuggestionMessageId((current) => (current === message.id ? "" : message.id))
                        }
                      >
                        <Pin size={12} />
                        Suggested tracker
                      </button>
                      {expandedSuggestionMessageId === message.id ? (
                        <TrackerDraftCards
                          busyId={artifactBusyId}
                          discardedIds={discardedDraftIds}
                          drafts={highConfidenceDrafts(message)}
                          trackedIds={trackedDraftIds}
                          onConfirm={(draft) => void confirmTrackerDraft(draft)}
                          onDiscard={discardTrackerDraft}
                        />
                      ) : null}
                    </div>
                  ) : null}
                  {message.error ? (
                    <p
                      className={`mt-3 flex items-center gap-2 text-xs font-semibold ${
                        message.role === "user" ? "text-amber-100" : "text-amber-700"
                      }`}
                    >
                      <AlertTriangle size={14} />
                      {productionBuild ? productionErrorMessage : message.error}
                    </p>
                  ) : null}
                  {message.grounding?.graphify && !productionBuild ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {modelName ? (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            message.role === "user"
                              ? "border-white/20 bg-white/10 text-white/75"
                              : "border-slate-200 bg-white text-slate-500"
                          }`}
                        >
                          Model: {modelName}
                        </span>
                      ) : null}
                      <button
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                          message.role === "user"
                            ? "border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}
                        type="button"
                        onClick={() => void showGrounding(message.id)}
                      >
                        <SearchCheck size={13} />
                        Local graph context used
                      </button>
                      {message.role === "assistant" && !generatedFileMessage ? (
                        <button
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:opacity-50"
                          disabled={Boolean(artifactBusyId)}
                          title="Add response to ingestion"
                          type="button"
                          onClick={() => void addResponseToBrain(message.id)}
                        >
                          {artifactBusyId === message.id ? (
                            <Loader2 className="animate-spin" size={13} />
                          ) : (
                            <FilePlus size={13} />
                          )}
                          Add
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                {message.artifacts?.length ? (
                  <div className="mt-3 space-y-2">
                    {message.artifacts.map((artifact) => (
                      <FileCard
                        key={artifact.id}
                        artifact={artifact}
                        busy={artifactBusyId === artifact.id}
                        onAdd={() => void ingestArtifact(message.id, artifact.id)}
                        onDownload={() => void downloadArtifact(message.id, artifact.id)}
                        onOpen={() => void openArtifact(message.id, artifact.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              {message.role === "user" ? (
                <PersonaAvatar persona={appearance.persona} />
              ) : null}
            </div>
            );
          })}
          {isSending && !hasPendingAssistantPlaceholder ? (
            <div className="flex justify-start gap-3">
              <SecondBrainAvatar />
              <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/75 px-4 py-3 text-sm font-semibold text-slate-500 shadow-sm">
                <NeuronPulse />
                Firing up neurons
              </div>
            </div>
          ) : null}
          {!activeThread || activeThread.messages.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div className="max-w-md">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-800 shadow-sm">
                  <DatabaseZap size={22} />
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-950">Ask across the active project</h2>
                {!productionBuild ? (
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Second Brain asks Graphify for a compact local subgraph, hydrates readable excerpts, then sends only that context packet to the selected model.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-slate-900/5 bg-white/20 p-4">
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-2 shadow-sm">
            <textarea
              className="min-h-12 max-h-40 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
              placeholder="Ask about papers, code, notes, experiments..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-2 py-1.5">
              <p className="truncate text-xs text-slate-500">{status}</p>
              {isSending && activeGenerationId ? (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  type="button"
                  onClick={() => void stopGeneration()}
                >
                  Stop
                </button>
              ) : (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  disabled={isSending || !draft.trim()}
                  type="button"
                  onClick={() => void sendMessage()}
                >
                  {isSending ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {!effectiveGroundingCollapsed ? (
      <aside className="min-h-0 border-l border-slate-900/5 bg-white/25 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <DatabaseZap size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-950">Grounding</h2>
          </div>
          <button
            className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white/65 hover:text-slate-950"
            title="Collapse grounding"
            type="button"
            onClick={() => setGroundingCollapsed(true)}
          >
            <PanelRightClose size={15} />
          </button>
        </div>
        {selectedGrounding ? (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white/65 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Command</p>
              <p className="mt-2 break-words font-mono text-xs leading-5 text-slate-700">{selectedGrounding.command}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/65 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Citations</p>
              {selectedGrounding.citations.length ? (
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {selectedGrounding.citations.map((citation) => (
                    <li key={`${citation.sourceFile}:${citation.sourceLocation ?? ""}`} className="break-words">
                      {citation.label ?? citation.sourceFile}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate-500">No source locations were returned by Graphify.</p>
              )}
            </div>
            <pre className="max-h-[56vh] overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">
              {selectedGrounding.stdout || selectedGrounding.error}
            </pre>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Select an answer with local graph context to inspect the query, citations, and hydrated excerpts.
          </p>
        )}
      </aside>
      ) : null}
    </div>
  );
}
