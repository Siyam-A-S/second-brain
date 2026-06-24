import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { motion } from "framer-motion";
import { createDropPayload } from "../lib/dropPayload";
import type { FilesDroppedPayload, ProcessDroppedItem, TrackerIngestionStatus, WidgetMovePayload } from "../../shared/ipc";

type DropTone = "idle" | "text" | "pdf" | "image" | "doc" | "unknown" | "success" | "error";

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
  unknown: "rgba(245, 245, 244, 0.95)",
  success: "rgba(209, 250, 229, 0.95)",
  error: "rgba(254, 226, 226, 0.98)"
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
      className={`no-drag grid h-full w-full select-none place-items-center bg-transparent ${
        isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      onDragEnter={(event) => {
        setIsDropActive(true);
        setTone(inferDropTone(event.dataTransfer));
      }}
      onDragLeave={() => {
        setIsDropActive(false);
        if (!isIngesting) {
          setTone("idle");
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDropActive(true);
        setTone(inferDropTone(event.dataTransfer));
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDropActive(false);

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
      <motion.div
        animate={{
          backgroundColor: toneColors[tone],
          boxShadow:
            isDropActive || isIngesting
              ? "0 28px 70px rgba(69, 55, 35, 0.3)"
              : "0 20px 54px rgba(69, 55, 35, 0.18)",
          scale: isDropActive || isDragging || isIngesting ? 1.25 : 1
        }}
        className="relative grid h-14 w-14 place-items-center rounded-full border border-white/80"
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 20
        }}
        whileHover={{
          boxShadow: "0 30px 76px rgba(69, 55, 35, 0.32)",
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
