/**
 * Lets the builder pages run either standalone (their own route, project id in
 * the URL) or embedded as a step inside the Builder workspace.
 *
 * The alternative was to rewrite seven pages into section components. That
 * would have meant touching a lot of working tax logic for a purely
 * presentational gain, which is a poor trade: the risk of a subtle regression
 * in a BU differential is not worth a tidier component tree. Instead each page
 * asks for its project id and its chrome through these two hooks, which is a
 * two-line change per page and leaves the bodies untouched.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

interface BuilderWorkspaceValue {
  /** True when a page is rendered as a workspace step rather than its own route. */
  embedded: boolean;
  /** The workspace's selected project, when embedded. */
  projectId?: string;
  /** Opening a project inside the workspace selects it instead of navigating. */
  selectProject?: (id: string) => void;
}

const BuilderWorkspaceContext = createContext<BuilderWorkspaceValue>({ embedded: false });

export const BuilderWorkspaceProvider: React.FC<{
  projectId?: string;
  selectProject?: (id: string) => void;
  children: React.ReactNode;
}> = ({ projectId, selectProject, children }) => {
  const value = useMemo(
    () => ({ embedded: true, projectId, selectProject }),
    [projectId, selectProject],
  );
  return (
    <BuilderWorkspaceContext.Provider value={value}>
      {children}
    </BuilderWorkspaceContext.Provider>
  );
};

/**
 * Whether this page is a workspace step. Pages use it to drop their own
 * header, back button and cross-navigation toolbar, all of which the workspace
 * shell already provides — showing them twice is what makes an embedded page
 * feel bolted on rather than designed.
 */
export const useBuilderEmbedded = (): boolean => useContext(BuilderWorkspaceContext).embedded;

/**
 * The project a page should work on: the workspace's selection when embedded,
 * the URL parameter otherwise. Both routes stay live, so existing links and
 * bookmarks keep working.
 */
export const useBuilderProjectId = (): string | undefined => {
  const params = useParams<{ projectId: string }>();
  const ctx = useContext(BuilderWorkspaceContext);
  return ctx.embedded ? ctx.projectId : params.projectId;
};

/**
 * How a page should open a project. Inside the workspace this selects it and
 * moves the stepper on; standalone it is an ordinary route change.
 */
export const useOpenBuilderProject = (): ((id: string) => void) => {
  const { embedded, selectProject } = useContext(BuilderWorkspaceContext);
  const navigate = useNavigate();
  return useMemo(
    () => (id: string) => {
      if (embedded && selectProject) selectProject(id);
      else navigate(`/builder-projects/${id}`);
    },
    [embedded, selectProject, navigate],
  );
};
