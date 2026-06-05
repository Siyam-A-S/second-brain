import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

type TopicId = "topic-1" | "topic-2" | "topic-3";

type Topic = {
  id: TopicId;
  label: string;
};

type Subtopic = {
  id: string;
  topicId: TopicId;
  title: string;
  body: string;
  accent: string;
};

const topics: Topic[] = [
  { id: "topic-1", label: "topic 1" },
  { id: "topic-2", label: "topic 2" },
  { id: "topic-3", label: "topic 3" }
];

const subtopics: Subtopic[] = [
  {
    id: "local-ingestion",
    topicId: "topic-1",
    title: "Local ingestion",
    body: "Normalize file drops, clipboard fragments, and plain text snippets into a single local queue. The main process keeps ownership of filesystem reads while the renderer stays focused on state and interface transitions.",
    accent: "border-teal-200/70 bg-teal-50/30"
  },
  {
    id: "mcp-router",
    topicId: "topic-1",
    title: "MCP router",
    body: "Route filesystem, model, and memory actions through a thin Electron main-process boundary. Renderer events remain declarative and move through the typed preload bridge.",
    accent: "border-amber-200/80 bg-amber-50/30"
  },
  {
    id: "clipboard-memory",
    topicId: "topic-1",
    title: "Clipboard memory",
    body: "Rank transient fragments through LFU and recency signals. Frequently reused snippets should remain close, while quiet items can decay out of the active surface.",
    accent: "border-rose-200/70 bg-rose-50/30"
  },
  {
    id: "agent-routing",
    topicId: "topic-1",
    title: "Agent routing",
    body: "Dropped files and text blocks become routing requests. The future agent layer can decide whether to summarize, embed, tag, or wait for more context.",
    accent: "border-violet-200/70 bg-violet-50/30"
  },
  {
    id: "indexing-plan",
    topicId: "topic-2",
    title: "Indexing plan",
    body: "Keep raw source paths, derived text, and embedding metadata separate. The UI should reveal processing state without exposing storage internals.",
    accent: "border-sky-200/70 bg-sky-50/30"
  },
  {
    id: "window-states",
    topicId: "topic-2",
    title: "Window states",
    body: "The main window and floating drop-zone are different renderer views connected by a shared typed bridge. Minimize becomes a mode switch, not a taskbar action.",
    accent: "border-emerald-200/70 bg-emerald-50/30"
  },
  {
    id: "visual-system",
    topicId: "topic-2",
    title: "Visual system",
    body: "Use quiet surfaces, restrained shadows, and short animations. The interface should feel local and responsive rather than decorative or busy.",
    accent: "border-stone-200/80 bg-white/40"
  },
  {
    id: "wasm-embeddings",
    topicId: "topic-3",
    title: "WASM embeddings",
    body: "Run local vector embedding work in the Node/Electron layer. Renderer components should only observe progress and display concise completion states.",
    accent: "border-indigo-200/70 bg-indigo-50/30"
  },
  {
    id: "future-graph",
    topicId: "topic-3",
    title: "Future graph window",
    body: "Reserve node-link exploration for a separate Obsidian-style surface. The main board stays sequential, readable, and easier to scan.",
    accent: "border-fuchsia-200/70 bg-fuchsia-50/30"
  }
];

export function TopicCanvas(): JSX.Element {
  const [activeTopic, setActiveTopic] = useState<TopicId>("topic-1");
  const [selectedSubtopic, setSelectedSubtopic] = useState<Subtopic | null>(null);
  const visibleSubtopics = subtopics.filter((subtopic) => subtopic.topicId === activeTopic);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-floral">
      <nav className="flex h-16 shrink-0 items-center border-b border-slate-900/5 px-6">
        <div className="flex items-center gap-7">
          {topics.map((topic) => {
            const isActive = activeTopic === topic.id;

            return (
              <button
                key={topic.id}
                className={`relative py-2 text-sm font-semibold transition-colors duration-200 ${
                  isActive ? "text-slate-900" : "text-slate-400 hover:text-slate-900"
                }`}
                type="button"
                onClick={() => setActiveTopic(topic.id)}
              >
                {topic.label}
                {isActive ? (
                  <motion.span
                    className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-slate-900"
                    layoutId="active-topic-underline"
                    transition={{ duration: 0.24, ease: "easeOut" }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <section className="min-h-0 flex-1 overflow-y-auto p-6">
        <motion.div
          key={activeTopic}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"
          initial={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {visibleSubtopics.map((subtopic) => (
            <button
              key={subtopic.id}
              className={`min-h-44 rounded-lg border p-5 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${subtopic.accent}`}
              type="button"
              onClick={() => setSelectedSubtopic(subtopic)}
            >
              <h2 className="text-base font-semibold leading-6 text-slate-900">{subtopic.title}</h2>
              <p className="mt-3 line-clamp-5 text-sm leading-relaxed text-slate-700">
                {subtopic.body}
              </p>
            </button>
          ))}
        </motion.div>
      </section>

      <AnimatePresence>
        {selectedSubtopic ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 p-6 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={() => setSelectedSubtopic(null)}
          >
            <motion.article
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="w-full max-w-2xl rounded-lg border border-slate-200 bg-floral p-7 shadow-float"
              exit={{ opacity: 0, scale: 0.98, y: 4 }}
              initial={{ opacity: 0, scale: 0.98, y: 4 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <h2 className="text-xl font-semibold leading-7 text-slate-900">
                  {selectedSubtopic.title}
                </h2>
                <button
                  aria-label="Close"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-slate-900/5 hover:text-slate-900"
                  type="button"
                  onClick={() => setSelectedSubtopic(null)}
                >
                  <X size={17} />
                </button>
              </div>
              <p className="text-base leading-relaxed text-slate-800">{selectedSubtopic.body}</p>
            </motion.article>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
