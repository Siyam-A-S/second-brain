import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { motion } from "framer-motion";
import { createDropPayload } from "../lib/dropPayload";
import type { ProcessDroppedItem, WidgetMovePayload } from "../../shared/ipc";

type DragState = {
  pointerId: number;
  originPointerX: number;
  originPointerY: number;
  originWindowX: number;
  originWindowY: number;
  moved: boolean;
};

const dragThreshold = 4;

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

export function FloatingWidget(): JSX.Element {
  const dragState = useRef<DragState | null>(null);
  const pendingMove = useRef<WidgetMovePayload | null>(null);
  const moveFrame = useRef<number | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    return () => {
      if (moveFrame.current !== null) {
        window.cancelAnimationFrame(moveFrame.current);
      }
    };
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

  return (
    <div
      aria-label="Second Brain drop zone"
      className={`no-drag grid h-full w-full select-none place-items-center bg-transparent ${
        isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      onDragEnter={() => setIsDropActive(true)}
      onDragLeave={() => setIsDropActive(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDropActive(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDropActive(false);

        const payload = createDropPayload("floating-widget", event.dataTransfer);
        const items = toProcessItems(payload);
        void window.api.brain
          .processDroppedItems(items)
          .catch((error) => {
            console.error("Failed to process floating widget drop", error);
          })
          .finally(() => {
            void window.api.window.restore();
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
      <motion.div
        animate={{
          boxShadow: isDropActive
            ? "0 28px 70px rgba(69, 55, 35, 0.3)"
            : "0 20px 54px rgba(69, 55, 35, 0.18)",
          scale: isDropActive || isDragging ? 1.25 : 1
        }}
        className="h-14 w-14 rounded-full bg-gradient-to-br from-white via-[#FFFAF0] to-[#F4EFE6]"
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 20
        }}
        whileHover={{
          boxShadow: "0 30px 76px rgba(69, 55, 35, 0.32)",
          scale: 1.25
        }}
      />
    </div>
  );
}
