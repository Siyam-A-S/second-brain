import { create } from "zustand";
import type { CreateProjectInput, ProjectRecord, RenameProjectInput } from "../../shared/ipc";

type ProjectState = {
  projects: ProjectRecord[];
  activeProject: ProjectRecord | null;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: CreateProjectInput) => Promise<ProjectRecord>;
  select: (projectId: string) => Promise<ProjectRecord>;
  rename: (input: RenameProjectInput) => Promise<ProjectRecord>;
  archive: (projectId: string) => Promise<ProjectRecord>;
};

function activeFrom(projects: ProjectRecord[]): ProjectRecord | null {
  return projects.find((project) => project.active) ?? projects[0] ?? null;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProject: null,
  isLoading: false,
  error: null,
  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const [projects, activeProject] = await Promise.all([window.api.projects.list(), window.api.projects.getActive()]);
      set({
        projects: projects.map((project) => ({ ...project, active: project.id === activeProject.id })),
        activeProject,
        isLoading: false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load projects.";
      console.error("Unable to load projects", error);
      set({ projects: [], activeProject: null, isLoading: false, error: message });
    }
  },
  create: async (input) => {
    const project = await window.api.projects.create(input);
    const projects = await window.api.projects.list();
    set({ projects, activeProject: project, error: null });
    return project;
  },
  select: async (projectId) => {
    const project = await window.api.projects.select({ projectId });
    const projects = await window.api.projects.list();
    set({
      projects: projects.map((candidate) => ({ ...candidate, active: candidate.id === project.id })),
      activeProject: project,
      error: null
    });
    return project;
  },
  rename: async (input) => {
    const project = await window.api.projects.rename(input);
    const projects = await window.api.projects.list();
    set({
      projects,
      activeProject: activeFrom(projects),
      error: null
    });
    return project;
  },
  archive: async (projectId) => {
    const archived = await window.api.projects.archive({ projectId });
    const [projects, activeProject] = await Promise.all([window.api.projects.list(), window.api.projects.getActive()]);
    set({
      projects: projects.map((project) => ({ ...project, active: project.id === activeProject.id })),
      activeProject,
      error: null
    });
    return archived;
  }
}));
