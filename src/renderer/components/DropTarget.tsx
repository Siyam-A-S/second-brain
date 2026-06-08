import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, UploadCloud, XCircle } from "lucide-react";
import type { ProcessDroppedItem, ProcessDroppedItemsResult } from "../../shared/ipc";
import { createDropPayload } from "../lib/dropPayload";

type DropTone = "idle" | "text" | "pdf" | "image" | "doc" | "unknown" | "success" | "error";
type DropTargetProps = {
  onProcessed: (result: ProcessDroppedItemsResult) => void;
};

const toneColors: Record<DropTone, string> = {
  idle: "#FFFAF0",
  text: "rgba(226, 232, 240, 0.5)",
  pdf: "rgba(254, 226, 226, 0.5)",
  image: "rgba(243, 232, 255, 0.5)",
  doc: "rgba(219, 234, 254, 0.5)",
  unknown: "rgba(245, 245, 244, 0.6)",
  success: "rgba(209, 250, 229, 0.5)",
  error: "rgba(254, 226, 226, 0.7)"
};

function inferDropTone(dataTransfer: DataTransfer): DropTone {
  const items = Array.from(dataTransfer.items);
  const files = Array.from(dataTransfer.files);
  const typeHints = [...items.map((item) => item.type), ...files.map((file) => file.type)];
  const nameHints = files.map((file) => file.name.toLowerCase());

  if (typeHints.some((type) => type.startsWith("image/")) || nameHints.some((name) => /\.(png|jpe?g)$/i.test(name))) {
    return "image";
  }

  if (typeHints.includes("application/pdf") || nameHints.some((name) => name.endsWith(".pdf"))) {
    return "pdf";
  }

  if (
    typeHints.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
    typeHints.includes("application/msword") ||
    nameHints.some((name) => name.endsWith(".docx") || name.endsWith(".doc"))
  ) {
    return "doc";
  }

  if (typeHints.some((type) => type.startsWith("text/")) || nameHints.some((name) => /\.(txt|md|markdown)$/i.test(name))) {
    return "text";
  }

  return "unknown";
}

function toProcessItems(payload: ReturnType<typeof createDropPayload>): ProcessDroppedItem[] {
  const fileItems = payload.files.map((file) => ({
    name: file.name,
    path: file.path,
    type: file.type
  }));
  const textItem = payload.text
    ? [
        {
          text: payload.text,
          type: "text/plain"
        }
      ]
    : [];

  return [...fileItems, ...textItem];
}

export function DropTarget({ onProcessed }: DropTargetProps): JSX.Element {
  const [tone, setTone] = useState<DropTone>("idle");
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState("Drop notes, PDFs, code, or copied text.");
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ProcessDroppedItemsResult | null>(null);
  const dragDepth = useRef(0);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) {
        window.clearTimeout(resetTimer.current);
      }
    },
    []
  );

  function scheduleReset(): void {
    if (resetTimer.current) {
      window.clearTimeout(resetTimer.current);
    }

    resetTimer.current = window.setTimeout(() => {
      setIsProcessing(false);
      setTone("idle");
      setStatusText("Drop notes, PDFs, code, or copied text.");
      setErrorDetails(null);
      setLastResult(null);
      dragDepth.current = 0;
    }, 5_000);
  }

  function errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.stack || error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return "Drop failed.";
    }
  }

  function processItems(items: ProcessDroppedItem[], initialStatus: string): void {
    setIsProcessing(true);
    setTone("success");
    setStatusText(initialStatus);
    setErrorDetails(null);

    void window.api.brain
      .processDroppedItems(items)
      .then((result) => {
        setLastResult(result);
        if (result.job) {
          setStatusText(`Saved ${result.job.role} at ${result.job.company}`);
          setTone("success");
        } else if (result.jobError) {
          setStatusText(result.jobError);
          setTone("error");
        } else if (result.routing) {
          setStatusText(`Routed to ${result.routing.parent_title}`);
          setTone("success");
        } else if (result.graphify) {
          setStatusText(`Graphify updated ${result.graphify.graphNodeCount ?? 0} nodes`);
          setTone(result.graphify.completed ? "success" : "error");
        } else {
          setStatusText("Drop processed locally.");
          setTone("success");
        }
        onProcessed(result);
        scheduleReset();
      })
      .catch((error) => {
        console.error("Failed to process dropped items", error);
        const message = errorMessage(error);
        const firstLine = message.split(/\r?\n/).find(Boolean) ?? "Drop failed.";
        setStatusText(firstLine);
        setErrorDetails(message);
        setTone("error");
      })
      .finally(() => {
        setIsProcessing(false);
      });
  }

  function handleClipboardIngest(): void {
    if (isProcessing) {
      return;
    }

    setTone("text");
    setStatusText("Reading clipboard locally...");
    setErrorDetails(null);

    void window.api.clipboard
      .readText()
      .then((text) => {
        const trimmed = text.trim();

        if (!trimmed) {
          setStatusText("Clipboard does not contain text.");
          setTone("error");
          scheduleReset();
          return;
        }

        processItems(
          [
            {
              name: "clipboard.txt",
              text: trimmed,
              type: "text/plain"
            }
          ],
          "Routing clipboard locally..."
        );
      })
      .catch((error) => {
        const message = errorMessage(error);
        setStatusText(message.split(/\r?\n/).find(Boolean) ?? "Clipboard read failed.");
        setErrorDetails(message);
        setTone("error");
      });
  }

  return (
    <motion.div
      animate={{
        backgroundColor: toneColors[tone],
        boxShadow: tone === "idle" ? "inset 0 0 0 1px rgba(41, 37, 36, 0.04)" : "inset 0 0 0 1px rgba(15, 23, 42, 0.08)"
      }}
      className="relative h-full min-h-0 overflow-hidden rounded-lg"
      transition={{
        duration: 0.22,
        ease: "easeOut"
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        handleClipboardIngest();
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setTone(inferDropTone(event.dataTransfer));
      }}
      onDragLeave={(event) => {
        event.preventDefault();

        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0 && !isProcessing) {
          setTone("idle");
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setTone(inferDropTone(event.dataTransfer));
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;

        const payload = createDropPayload("main-drop-zone", event.dataTransfer);
        const items = toProcessItems(payload);
        processItems(items, "Reading and routing locally...");
      }}
    >
      {isProcessing ? (
        <motion.div
          animate={{ scaleX: 1, opacity: 1 }}
          className="absolute inset-0 origin-left bg-emerald-100/50"
          initial={{ scaleX: 0, opacity: 0.75 }}
          transition={{ duration: 0.26, ease: "easeOut" }}
        />
      ) : null}
      <div className="relative z-10 flex h-full flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Local ingest</p>
            <h2 className="mt-2 text-lg font-semibold leading-6 text-slate-950">Drop zone</h2>
          </div>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/70 text-slate-700 shadow-sm">
            {isProcessing ? (
              <Loader2 className="animate-spin" size={19} />
            ) : tone === "error" ? (
              <XCircle size={19} />
            ) : tone === "success" ? (
              <CheckCircle2 size={19} />
            ) : (
              <UploadCloud size={19} />
            )}
          </div>
        </div>

        <div>
          <p className="text-sm leading-6 text-slate-700">{statusText}</p>
          {lastResult ? (
            <div className="mt-4 rounded-md border border-emerald-200 bg-white/65 p-3">
              <p className="text-xs font-semibold uppercase text-emerald-700">
                {lastResult.job ? "jobs" : lastResult.graphify ? "graphify" : lastResult.routing?.strategy.replace("-", " ") ?? "processed"}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {lastResult.job
                  ? `${lastResult.job.company} · ${lastResult.job.role}`
                  : lastResult.graphify
                    ? `${lastResult.graphify.writtenFileCount} raw item${lastResult.graphify.writtenFileCount === 1 ? "" : "s"}`
                  : lastResult.createdNode?.title ?? "Processed drop"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {lastResult.job
                  ? "Saved to the Jobs table"
                  : lastResult.graphify
                    ? `${lastResult.graphify.graphEdgeCount ?? 0} graph connections`
                  : lastResult.routing
                    ? `Confidence ${Math.round(lastResult.routing.confidence * 100)}%`
                    : "Saved locally"}
              </p>
            </div>
          ) : null}
          {errorDetails ? (
            <div className="mt-4 max-h-48 overflow-auto rounded-md border border-rose-200 bg-white/75 p-3">
              <p className="text-xs font-semibold uppercase text-rose-700">Error details</p>
              <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-rose-900">{errorDetails}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
