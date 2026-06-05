import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FilePlus2 } from "lucide-react";
import { createDropPayload } from "../lib/dropPayload";

export function FloatingWidget(): JSX.Element {
  const [isHovering, setIsHovering] = useState(false);
  const [successCount, setSuccessCount] = useState(0);

  return (
    <button
      className="no-drag grid h-full w-full place-items-center bg-transparent p-3 text-left"
      type="button"
      onClick={() => void window.api.window.restore()}
      onDragEnter={() => setIsHovering(true)}
      onDragLeave={() => setIsHovering(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsHovering(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setIsHovering(false);
        setSuccessCount((count) => count + 1);

        const payload = createDropPayload("floating-widget", event.dataTransfer);
        void window.api.files.dropped(payload);
      }}
    >
      <motion.div
        animate={{
          scale: isHovering ? 1.05 : 1,
          rotate: isHovering ? -1.5 : 0
        }}
        className="relative grid h-full w-full place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-teal-300 via-white to-rose-300 p-4 shadow-float ring-1 ring-white/80"
        transition={{
          type: "spring",
          stiffness: 280,
          damping: 20
        }}
      >
        <AnimatePresence>
          {successCount > 0 ? (
            <motion.span
              key={successCount}
              animate={{ opacity: 0, scale: 1.45 }}
              className="absolute inset-0 rounded-2xl bg-emerald-300/60"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0.85, scale: 0.45 }}
              transition={{ duration: 0.55 }}
            />
          ) : null}
        </AnimatePresence>

        <div className="grid place-items-center gap-3 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/85 text-stone-800 shadow-lg">
            <FilePlus2 size={27} />
          </span>
          <span className="text-sm font-bold leading-5 text-ink">Drop files</span>
        </div>
      </motion.div>
    </button>
  );
}
