import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { motion } from "framer-motion";
import { File, FileCode, FileImage, FileQuestion, FileSpreadsheet, FileText } from "lucide-react";
import { createDropPayload } from "../lib/dropPayload";
import type { FilesDroppedPayload, ProcessDroppedItem, TrackerIngestionStatus, WidgetMovePayload } from "../../shared/ipc";
import { inferDropHint, type DropHint, type DropHintKind, type DropTone } from "../lib/dropHints";

type DragState = {
  pointerId: number;
  originPointerX: number;
  originPointerY: number;
  originWindowX: number;
  originWindowY: number;
  moved: boolean;
};

const dragThreshold = 4;
const toneColors: Record<DropTone, string> = {
  idle: "#FFFAF0",
  text: "rgba(226, 232, 240, 0.9)",
  pdf: "rgba(254, 226, 226, 0.95)",
  image: "rgba(243, 232, 255, 0.95)",
  doc: "rgba(219, 234, 254, 0.95)",
  spreadsheet: "rgba(220, 252, 231, 0.95)",
  code: "rgba(224, 242, 254, 0.95)",
  unknown: "rgba(245, 245, 244, 0.95)",
  success: "rgba(209, 250, 229, 0.95)",
  error: "rgba(254, 226, 226, 0.98)"
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

export function FloatingWidget(): JSX.Element {
  const dragState = useRef<DragState | null>(null);
  const pendingMove = useRef<WidgetMovePayload | null>(null);
  const dropQueue = useRef<ProcessDroppedItem[][]>([]);
  const isProcessingQueue = useRef(false);
  const moveFrame = useRef<number | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [tone, setTone] = useState<DropTone>("idle");
  const [queueCount, setQueueCount] = useState(0);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);

  useEffect(() => {
    return () => {
      if (moveFrame.current !== null) {
        window.cancelAnimationFrame(moveFrame.current);
      }
    };
  }, []);

  useEffect(() => {
    return window.api.tracker.onIngestionStatus((status: TrackerIngestionStatus) => {
      if (status.stage === "extracting") {
        setIsIngesting(true);
        setTone("success");
        return;
      }

      if (status.stage === "saved") {
        setIsIngesting(false);
        setTone("success");
        window.setTimeout(() => setTone("idle"), 900);
        return;
      }

      if (status.stage === "error") {
        setIsIngesting(false);
        setTone("error");
        window.setTimeout(() => setTone("idle"), 1_500);
        return;
      }

      if (status.stage === "skipped" || status.stage === "idle") {
        setIsIngesting(false);
        setTone("idle");
      }
    });
  }, []);

  const flushMove = (): void => {
    moveFrame.current = null;

    if (!pendingMove.current) {
      return;
    }

    const nextMove = pendingMove.current;
    pendingMove.current = null;
    void window.api.window.moveWidget(nextMove);
  };

  const scheduleMove = (payload: WidgetMovePayload): void => {
    pendingMove.current = payload;

    if (moveFrame.current === null) {
      moveFrame.current = window.requestAnimationFrame(flushMove);
    }
  };

  const handlePointerDown = async (event: ReactPointerEvent<HTMLDivElement>): Promise<void> => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const bounds = await window.api.window.getWidgetBounds();
    if (!bounds) {
      return;
    }

    dragState.current = {
      pointerId: event.pointerId,
      originPointerX: event.screenX,
      originPointerY: event.screenY,
      originWindowX: bounds.x,
      originWindowY: bounds.y,
      moved: false
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.screenX - state.originPointerX;
    const deltaY = event.screenY - state.originPointerY;

    if (!state.moved && Math.hypot(deltaX, deltaY) >= dragThreshold) {
      state.moved = true;
      setIsDragging(true);
    }

    if (state.moved) {
      event.preventDefault();
      scheduleMove({
        x: state.originWindowX + deltaX,
        y: state.originWindowY + deltaY
      });
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragState.current = null;
    setIsDragging(false);

    if (!state.moved) {
      void window.api.window.restore();
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragState.current = null;
    setIsDragging(false);
  };

  const drainQueue = async (): Promise<void> => {
    if (isProcessingQueue.current) {
      return;
    }

    isProcessingQueue.current = true;
    setIsIngesting(true);

    try {
      while (dropQueue.current.length > 0) {
        const items = dropQueue.current.shift();
        setQueueCount(dropQueue.current.length);

        if (!items) {
          continue;
        }

        setTone("success");
        await window.api.brain.processDroppedItems(items);
      }

      setTone("success");
      window.setTimeout(() => setTone("idle"), 900);
      void window.api.window.restore();
    } catch (error) {
      console.error("Failed to process floating widget drop", error);
      setTone("error");
      window.setTimeout(() => setTone("idle"), 1_500);
    } finally {
      isProcessingQueue.current = false;
      setIsIngesting(false);
      setQueueCount(dropQueue.current.length);
    }
  };

  const enqueueDrop = (items: ProcessDroppedItem[]): void => {
    if (items.length === 0) {
      return;
    }

    dropQueue.current.push(items);
    setQueueCount(dropQueue.current.length);
    void drainQueue();
  };

  return (
    <div
      aria-label="Second Brain drop zone"
      className={`no-drag relative grid h-full w-full select-none place-items-center bg-transparent ${
        isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      onDragEnter={(event) => {
        const hint = inferDropHint(event.dataTransfer);
        setIsDropActive(true);
        setDropHint(hint);
        setTone(hint.tone);
      }}
      onDragLeave={() => {
        setIsDropActive(false);
        setDropHint(null);
        if (!isIngesting) {
          setTone("idle");
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        const hint = inferDropHint(event.dataTransfer);
        setIsDropActive(true);
        setDropHint(hint);
        setTone(hint.tone);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDropActive(false);
        setDropHint(null);

        const dataTransfer = event.dataTransfer;
        setIsIngesting(true);
        void createDropPayload("floating-widget", dataTransfer)
          .then((payload) => {
            const items = toProcessItems(payload);
            enqueueDrop(items);
          })
          .catch((error) => {
            console.error("Failed to read floating widget drop", error);
            setTone("error");
            setIsIngesting(false);
            window.setTimeout(() => setTone("idle"), 1_500);
          });
      }}
      onPointerCancel={handlePointerCancel}
      onPointerDown={(event) => void handlePointerDown(event)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="button"
      style={{ touchAction: "none" }}
      tabIndex={0}
    >
      {isIngesting ? (
        <motion.div
          animate={{
            opacity: [0.45, 0.08],
            scale: [1, 1.85]
          }}
          className="absolute h-14 w-14 rounded-full border border-emerald-400"
          initial={{ opacity: 0.3, scale: 1 }}
          transition={{
            duration: 1.1,
            ease: "easeOut",
            repeat: Infinity
          }}
        />
      ) : null}
      {isDropActive && dropHint ? (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          className="pointer-events-none absolute right-1 top-1 z-10 grid h-8 min-w-8 place-items-center rounded-full border border-emerald-200 bg-white/95 px-1.5 text-[9px] font-bold text-emerald-800 shadow-[0_10px_22px_rgba(15,118,110,0.22)]"
          initial={{ opacity: 0, scale: 0.82 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          {(() => {
            const Icon = dropHintIcons[dropHint.kind];
            return dropHint.kind === "unknown" ? <Icon size={14} /> : dropHint.shortLabel;
          })()}
        </motion.div>
      ) : null}
      <motion.div
        animate={{
          backgroundColor: toneColors[tone],
          boxShadow:
            isDropActive || isIngesting
              ? "0 16px 34px rgba(69, 55, 35, 0.2)"
              : "0 12px 26px rgba(69, 55, 35, 0.12)",
          scale: isDropActive || isDragging || isIngesting ? 1.25 : 1
        }}
        className="relative grid h-14 w-14 place-items-center rounded-full border border-white/80"
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 20
        }}
        whileHover={{
          boxShadow: "0 18px 38px rgba(69, 55, 35, 0.22)",
          scale: 1.25
        }}
      >
        {queueCount > 0 ? (
          <span className="rounded-full bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">{queueCount}</span>
        ) : null}
      </motion.div>
    </div>
  );
}
