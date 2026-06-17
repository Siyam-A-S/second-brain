import { cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CreateProjectInput, ProjectRecord, ProjectSelectionInput, RenameProjectInput } from "../../shared/brain";

type ProjectState = {
  activeProjectId: string;
  projects: Array<{
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    archivedAt?: string | undefined;
  }>;
};

const defaultProjectId = "default";
const stateFileName = "projects.json";

function safeProjectId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "project";
}

function nowIso(): string {
  return new Date().toISOString();
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export class ProjectService {
  private readonly projectsRoot: string;
  private readonly statePath: string;
  private state: ProjectState | null = null;

  constructor(private readonly userDataPath: string) {
    this.projectsRoot = path.join(userDataPath, "projects");
    this.statePath = path.join(this.projectsRoot, stateFileName);
  }

  async initialize(): Promise<void> {
    await mkdir(this.projectsRoot, { recursive: true });
    await this.loadOrCreateState();
    await this.migrateLegacyVault();
    await this.archiveLegacySmartClips();
    await this.ensureProjectDirectories(await this.getActiveProject());
    await this.writeState();
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const state = await this.requireState();
    return Promise.all(state.projects.filter((project) => !project.archivedAt).map((project) => this.toRecord(project)));
  }

  async getActiveProject(): Promise<ProjectRecord> {
    const state = await this.requireState();
    const active = state.projects.find((project) => project.id === state.activeProjectId && !project.archivedAt);
    if (active) {
      return this.toRecord(active);
    }

    const fallback = state.projects.find((project) => !project.archivedAt);
    if (!fallback) {
      return this.createProject({ name: "Default" });
    }

    state.activeProjectId = fallback.id;
    await this.writeState();
    return this.toRecord(fallback);
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const state = await this.requireState();
    const name = input.name.trim() || "Untitled Project";
    const baseId = safeProjectId(name);
    let id = baseId;
    let suffix = 2;

    while (state.projects.some((project) => project.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const timestamp = nowIso();
    state.projects.push({
      id,
      name,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    state.activeProjectId = id;
    await this.writeState();
    const created = state.projects[state.projects.length - 1];
    if (!created) {
      throw new Error("Unable to create project record.");
    }

    const project = await this.toRecord(created);
    await this.ensureProjectDirectories(project);
    return project;
  }

  async selectProject(input: ProjectSelectionInput): Promise<ProjectRecord> {
    const state = await this.requireState();
    const project = state.projects.find((candidate) => candidate.id === input.projectId && !candidate.archivedAt);
    if (!project) {
      throw new Error(`Project "${input.projectId}" was not found.`);
    }

    state.activeProjectId = project.id;
    project.updatedAt = nowIso();
    await this.writeState();
    const record = await this.toRecord(project);
    await this.ensureProjectDirectories(record);
    return record;
  }

  async renameProject(input: RenameProjectInput): Promise<ProjectRecord> {
    const state = await this.requireState();
    const project = state.projects.find((candidate) => candidate.id === input.projectId && !candidate.archivedAt);
    const name = input.name.trim();

    if (!project) {
      throw new Error(`Project "${input.projectId}" was not found.`);
    }

    if (!name) {
      throw new Error("Project name is required.");
    }

    project.name = name;
    project.updatedAt = nowIso();
    await this.writeState();
    return this.toRecord(project);
  }

  async archiveProject(input: ProjectSelectionInput): Promise<ProjectRecord> {
    const state = await this.requireState();
    const activeProjects = state.projects.filter((project) => !project.archivedAt);
    const project = activeProjects.find((candidate) => candidate.id === input.projectId);

    if (!project) {
      throw new Error(`Project "${input.projectId}" was not found.`);
    }

    if (activeProjects.length <= 1) {
      throw new Error("Keep at least one project available.");
    }

    project.archivedAt = nowIso();
    project.updatedAt = project.archivedAt;

    if (state.activeProjectId === project.id) {
      state.activeProjectId = activeProjects.find((candidate) => candidate.id !== project.id)?.id ?? defaultProjectId;
    }

    await this.writeState();
    return this.toRecord(project);
  }

  private async loadOrCreateState(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as ProjectState;
      if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
        this.state = parsed;
        return;
      }
    } catch (error) {
      if (!isEnoent(error)) {
        console.warn("Unable to read project state; creating a fresh project index.", error);
      }
    }

    const timestamp = nowIso();
    this.state = {
      activeProjectId: defaultProjectId,
      projects: [
        {
          id: defaultProjectId,
          name: "Default",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    };
    await this.writeState();
  }

  private async migrateLegacyVault(): Promise<void> {
    const state = await this.requireState();
    const legacyVault = path.join(this.userDataPath, "vault");
    const defaultProject = state.projects.find((project) => project.id === defaultProjectId) ?? state.projects[0];
    if (!defaultProject) {
      return;
    }

    const defaultRecord = await this.toRecord(defaultProject);

    if (!(await exists(legacyVault)) || (await exists(defaultRecord.vaultPath))) {
      return;
    }

    await mkdir(defaultRecord.rootPath, { recursive: true });
    await cp(legacyVault, defaultRecord.vaultPath, {
      recursive: true,
      errorOnExist: false,
      force: false
    });
  }

  private async archiveLegacySmartClips(): Promise<void> {
    const smartClipsPath = path.join(this.userDataPath, "smart-clips.json");
    if (!(await exists(smartClipsPath))) {
      return;
    }

    const archivePath = path.join(
      this.userDataPath,
      `smart-clips.archived.${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );

    try {
      await rename(smartClipsPath, archivePath);
    } catch (error) {
      if (!isEnoent(error)) {
        console.warn("Unable to archive Smart Clips data.", error);
      }
    }
  }

  private async ensureProjectDirectories(project: ProjectRecord): Promise<void> {
    await Promise.all([
      mkdir(project.rootPath, { recursive: true }),
      mkdir(project.vaultPath, { recursive: true }),
      mkdir(project.rawVaultPath, { recursive: true }),
      mkdir(path.dirname(project.trackerPath), { recursive: true })
    ]);
    await writeFile(path.join(project.rootPath, "project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  }

  private async requireState(): Promise<ProjectState> {
    if (!this.state) {
      await this.loadOrCreateState();
    }

    return this.state as ProjectState;
  }

  private async writeState(): Promise<void> {
    if (!this.state) {
      return;
    }

    await mkdir(this.projectsRoot, { recursive: true });
    await writeFile(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }

  private async toRecord(project: ProjectState["projects"][number]): Promise<ProjectRecord> {
    const state = await this.requireState();
    const rootPath = path.join(this.projectsRoot, project.id);
    const vaultPath = path.join(rootPath, "vault");
    const rawVaultPath = path.join(vaultPath, "raw");

    return {
      id: project.id,
      name: project.name,
      rootPath,
      vaultPath,
      rawVaultPath,
      graphPath: path.join(rawVaultPath, "graphify-out", "graph.json"),
      trackerPath: path.join(rootPath, "tracker", "tickets.json"),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      archivedAt: project.archivedAt,
      active: state.activeProjectId === project.id
    };
  }
}
