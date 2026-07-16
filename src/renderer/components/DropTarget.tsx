import { useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, File, FileCode, FileImage, FileQuestion, FileSpreadsheet, FileText, Loader2, UploadCloud, XCircle } from "lucide-react";
import type { FilesDroppedPayload, ProcessDroppedItem, ProcessDroppedItemsResult, TrackerIngestionStatus } from "../../shared/ipc";
import { dropZoneTips } from "../content/dropZoneTips";
import { createDropPayload } from "../lib/dropPayload";
import { inferDropHint, type DropHint, type DropHintKind, type DropTone } from "../lib/dropHints";

type DropTargetProps = {
  onProcessed: (result: ProcessDroppedItemsResult) => void;
};

const toneColors: Record<DropTone, string> = {
  idle: "var(--color-panel)",
  text: "rgba(226, 232, 240, 0.5)",
  pdf: "rgba(254, 226, 226, 0.5)",
  image: "rgba(243, 232, 255, 0.5)",
  doc: "rgba(219, 234, 254, 0.5)",
  spreadsheet: "rgba(220, 252, 231, 0.5)",
  code: "rgba(224, 242, 254, 0.5)",
  unknown: "rgba(245, 245, 244, 0.6)",
  success: "rgba(209, 250, 229, 0.5)",
  error: "rgba(254, 226, 226, 0.7)"
};

const dropHintIcons: Record<DropHintKind, typeof File> = {
  text: FileText,
  pdf: FileText,
  image: FileImage,
  doc: FileText,
  spreadsheet: FileSpreadsheet,
  code: FileCode,
  unknown: FileQuestion
};

function pointerPosition(event: ReactDragEvent<HTMLElement>): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top
  };
}

function toProcessItems(payload: FilesDroppedPayload): ProcessDroppedItem[] {
  const fileItems = payload.files.map((file) => ({
    name: file.name,
    path: file.path,
    type: file.type,
    buffer: file.buffer
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
  const [statusText, setStatusText] = useState("");
  const [tipIndex, setTipIndex] = useState(0);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ProcessDroppedItemsResult | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [dropPointer, setDropPointer] = useState<{ x: number; y: number } | null>(null);
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

  useEffect(() => {
    if (dropZoneTips.length === 0) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setTipIndex((index) => (index + 1) % dropZoneTips.length);
    }, 7_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return window.api.tracker.onIngestionStatus((status: TrackerIngestionStatus) => {
      if (resetTimer.current) {
        window.clearTimeout(resetTimer.current);
      }

      if (status.stage === "extracting") {
        setIsProcessing(true);
        setTone("success");
        setStatusText(status.message);
        setErrorDetails(null);
        return;
      }

      if (status.stage === "saved") {
        setIsProcessing(false);
        setTone("success");
        setStatusText(status.message);
        setErrorDetails(null);
        scheduleReset();
        return;
      }

      if (status.stage === "error") {
        setIsProcessing(false);
        setTone("error");
        setStatusText(status.message);
        setErrorDetails(status.error ?? status.message);
        scheduleReset();
        return;
      }

      if (status.stage === "skipped") {
        setIsProcessing(false);
        setTone("unknown");
        setStatusText(status.message);
        scheduleReset();
      }
    });
  }, []);

  function scheduleReset(): void {
    if (resetTimer.current) {
      window.clearTimeout(resetTimer.current);
    }

    resetTimer.current = window.setTimeout(() => {
      setIsProcessing(false);
      setTone("idle");
      setStatusText("");
      setErrorDetails(null);
      setLastResult(null);
      setDropHint(null);
      setDropPointer(null);
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
        if (result.routing) {
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
      .readIngestibleItems()
      .then((result) => {
        if (result.items.length === 0) {
          setStatusText(result.message);
          setTone("error");
          scheduleReset();
          return;
        }

        processItems(result.items, "Routing clipboard locally...");
      })
      .catch((error) => {
        const message = errorMessage(error);
        setStatusText(message.split(/\r?\n/).find(Boolean) ?? "Clipboard read failed.");
        setErrorDetails(message);
        setTone("error");
      });
  }

  const activeTip = dropZoneTips.length ? dropZoneTips[tipIndex % dropZoneTips.length] : "Drop local context into Second Brain.";
  const visibleStatusText = statusText || activeTip;

  return (
    <motion.div
      animate={{
        backgroundColor: toneColors[tone],
        boxShadow:
          tone === "idle"
            ? "inset 0 0 0 1px rgba(41, 37, 36, 0.08), 2px 4px 6px rgba(0,0,0,0.08)"
            : "inset 0 0 0 1px rgba(15, 23, 42, 0.08), 2px 4px 6px rgba(0,0,0,0.08)"
      }}
      className="material-frosted relative h-full min-h-0 overflow-hidden rounded-xl border border-black/10 shadow-keycap"
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
        const hint = inferDropHint(event.dataTransfer);
        setDropHint(hint);
        setDropPointer(pointerPosition(event));
        setTone(hint.tone);
      }}
      onDragLeave={(event) => {
        event.preventDefault();

        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0 && !isProcessing) {
          setTone("idle");
          setDropHint(null);
          setDropPointer(null);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        const hint = inferDropHint(event.dataTransfer);
        setDropHint(hint);
        setDropPointer(pointerPosition(event));
        setTone(hint.tone);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDropHint(null);
        setDropPointer(null);

        const dataTransfer = event.dataTransfer;
        setIsProcessing(true);
        setStatusText("Reading dropped files locally...");
        void createDropPayload("main-drop-zone", dataTransfer)
          .then((payload) => {
            const items = toProcessItems(payload);
            processItems(items, "Reading and routing locally...");
          })
          .catch((error) => {
            const message = errorMessage(error);
            setStatusText(message.split(/\r?\n/).find(Boolean) ?? "Unable to read dropped files.");
            setErrorDetails(message);
            setTone("error");
            setIsProcessing(false);
          });
      }}
    >
      {dropHint && dropPointer ? (
        <div
          className="pointer-events-none absolute z-20 flex -translate-y-1/2 translate-x-3 items-center gap-1.5 rounded-full border border-emerald-200 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 shadow-[0_10px_28px_rgba(15,118,110,0.22)]"
          style={{ left: dropPointer.x, top: dropPointer.y }}
        >
          {(() => {
            const Icon = dropHintIcons[dropHint.kind];
            return <Icon size={14} />;
          })()}
          {dropHint.shortLabel}
        </div>
      ) : null}
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
            <p className="font-mono text-xs font-semibold uppercase text-highlight">Local ingest</p>
            <h2 className="mt-2 font-mono text-lg font-semibold leading-6 text-legend">Drop zone</h2>
          </div>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-keycap text-legend shadow-keycap">
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
          <p className="text-sm leading-6 text-textMain">{visibleStatusText}</p>
          {isProcessing && statusText ? <p className="mt-1 text-xs leading-5 text-textMain/60">{activeTip}</p> : null}
          {lastResult ? (
            <div className="mt-4 rounded-xl border border-highlight bg-keycap p-3 shadow-inner">
              <p className="font-mono text-xs font-semibold uppercase text-highlight">
                {lastResult.graphify
                    ? "graphify"
                    : lastResult.routing?.strategy.replace("-", " ") ?? "processed"}
              </p>
              <p className="mt-1 text-sm font-semibold text-textMain">
                {lastResult.graphify
                    ? `${lastResult.graphify.writtenFileCount} raw item${lastResult.graphify.writtenFileCount === 1 ? "" : "s"}`
                  : lastResult.createdNode?.title ?? "Processed drop"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {lastResult.graphify
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
