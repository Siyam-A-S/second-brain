import { useEffect, useState } from "react";
import { Check, FolderKanban, FolderPlus, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useProjectStore } from "../stores/useProjectStore";

type ProjectListProps = {
  refreshKey: number;
  onProjectChanged: () => void;
};

export function ProjectList({ refreshKey, onProjectChanged }: ProjectListProps): JSX.Element {
  const projects = useProjectStore((state) => state.projects);
  const activeProject = useProjectStore((state) => state.activeProject);
  const isLoading = useProjectStore((state) => state.isLoading);
  const error = useProjectStore((state) => state.error);
  const load = useProjectStore((state) => state.load);
  const createProject = useProjectStore((state) => state.create);
  const selectProject = useProjectStore((state) => state.select);
  const renameProject = useProjectStore((state) => state.rename);
  const archiveProject = useProjectStore((state) => state.archive);
  const [newProjectName, setNewProjectName] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function handleCreate(): Promise<void> {
    const name = newProjectName.trim();
    if (!name) {
      return;
    }

    try {
      await createProject({ name });
      setNewProjectName("");
      setActionError(null);
      onProjectChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to create project.");
    }
  }

  async function handleSelect(projectId: string): Promise<void> {
    if (projectId === activeProject?.id) {
      return;
    }

    try {
      await selectProject(projectId);
      setActionError(null);
      onProjectChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to select project.");
    }
  }

  async function handleRename(projectId: string): Promise<void> {
    try {
      await renameProject({ projectId, name: renameDraft });
      setRenamingProjectId("");
      setRenameDraft("");
      setActionError(null);
      onProjectChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to rename project.");
    }
  }

  async function handleArchive(projectId: string): Promise<void> {
    try {
      await archiveProject(projectId);
      setActionError(null);
      onProjectChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to archive project.");
    }
  }

  return (
    <section className="material-frosted flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-black/10 bg-panel shadow-keycap">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-black/10 px-4">
        <div className="flex items-center gap-2 font-mono text-sm font-semibold text-legend">
          <FolderKanban size={16} />
          <span>Projects</span>
        </div>
        {isLoading ? <Loader2 className="animate-spin text-led" size={15} /> : null}
      </header>

      <div className="flex shrink-0 gap-2 border-b border-black/10 p-3">
        <input
          className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white/45 px-3 py-2 font-mono text-sm text-textMain shadow-inner outline-none transition placeholder:text-slate-500 focus:border-highlight"
          placeholder="New project"
          value={newProjectName}
          onChange={(event) => setNewProjectName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleCreate();
            }
          }}
        />
        <button
          className="grid h-9 w-9 place-items-center rounded-xl bg-keycap text-legend shadow-keycap transition hover:text-highlight active:translate-y-[2px] active:shadow-inner disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!newProjectName.trim()}
          title="Create project"
          type="button"
          onClick={() => void handleCreate()}
        >
          <FolderPlus size={16} />
        </button>
      </div>

      {(error || actionError) && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs leading-5 text-rose-900">
          {actionError ?? error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {projects.length === 0 && !isLoading ? (
          <p className="px-2 py-4 text-sm text-slate-500">No projects yet.</p>
        ) : null}

        {projects.map((project) => {
          const isActive = project.id === activeProject?.id;
          const isRenaming = renamingProjectId === project.id;

          return (
            <article
              key={project.id}
              className={`group mb-1 rounded-xl border px-2 py-2 transition ${
                isActive ? "border-highlight bg-keycap text-legend shadow-keycap" : "border-transparent text-textMain hover:bg-keycap"
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  className="min-w-0 flex-1 text-left"
                  type="button"
                  onClick={() => void handleSelect(project.id)}
                >
                  {isRenaming ? (
                    <input
                      className="h-8 w-full rounded-xl border border-black/10 bg-white/55 px-2 font-mono text-sm font-semibold outline-none shadow-inner focus:border-highlight"
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <>
                      <p className="truncate font-mono text-sm font-semibold">{project.name}</p>
                      <p className="truncate text-xs text-slate-500">{isActive ? "Active project" : project.id}</p>
                    </>
                  )}
                </button>
                {isRenaming ? (
                  <>
                    <button
                      className="grid h-8 w-8 place-items-center rounded-xl bg-keycap text-highlight shadow-keycap transition active:translate-y-[2px] active:shadow-inner"
                      title="Save project name"
                      type="button"
                      onClick={() => void handleRename(project.id)}
                    >
                      <Check size={15} />
                    </button>
                    <button
                      className="grid h-8 w-8 place-items-center rounded-xl bg-keycap text-legend shadow-keycap transition hover:text-highlight active:translate-y-[2px] active:shadow-inner"
                      title="Cancel rename"
                      type="button"
                      onClick={() => setRenamingProjectId("")}
                    >
                      <X size={15} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="grid h-8 w-8 place-items-center rounded-xl bg-keycap text-legend opacity-0 shadow-keycap transition hover:text-highlight active:translate-y-[2px] active:shadow-inner group-hover:opacity-100"
                      title="Rename project"
                      type="button"
                      onClick={() => {
                        setRenamingProjectId(project.id);
                        setRenameDraft(project.name);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="grid h-8 w-8 place-items-center rounded-xl bg-keycap text-rose-500 opacity-0 shadow-keycap transition hover:text-rose-700 active:translate-y-[2px] active:shadow-inner group-hover:opacity-100"
                      title="Archive project"
                      type="button"
                      onClick={() => void handleArchive(project.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
