import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { createDropPayload } from "../lib/dropPayload";

type DropTone = "idle" | "text" | "pdf" | "image" | "doc" | "unknown" | "success";

const toneColors: Record<DropTone, string> = {
  idle: "#FFFAF0",
  text: "rgba(226, 232, 240, 0.5)",
  pdf: "rgba(254, 226, 226, 0.5)",
  image: "rgba(243, 232, 255, 0.5)",
  doc: "rgba(219, 234, 254, 0.5)",
  unknown: "rgba(245, 245, 244, 0.6)",
  success: "rgba(209, 250, 229, 0.5)"
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

export function DropTarget(): JSX.Element {
  const [tone, setTone] = useState<DropTone>("idle");
  const [isProcessing, setIsProcessing] = useState(false);
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
      dragDepth.current = 0;
    }, 2_000);
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
        setTone("success");
        setIsProcessing(true);
        scheduleReset();
        void window.api.files.dropped(payload);
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
    </motion.div>
  );
}
