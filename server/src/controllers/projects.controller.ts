import type { NextFunction, Request, Response } from "express";
import {
  createProjectForUser,
  deleteProject,
  getProjectForUser,
  getProjectOwnerId,
  isValidProjectRole,
  listProjectMembers,
  listProjectsForUser,
  updateProject,
  updateProjectMemberRole,
} from "../services/projects.service.js";

export async function getProjects(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const projects = await listProjectsForUser(userId);
    res.status(200).json({ projects });
  } catch (err) {
    next(err);
  }
}

export async function createProject(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;

    const payload = parseCreateProjectPayload(req.body);
    if (!payload.ok) {
      res.status(400).json({ error: payload.error });
      return;
    }

    const projectId = await createProjectForUser({
      name: payload.name,
      description: payload.description,
      userId,
    });

    const project = await getProjectForUser(projectId, userId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
}

export async function getProjectById(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.membership!;
    const userId = req.user!.userId;

    const project = await getProjectForUser(projectId, userId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.status(200).json({ project });
  } catch (err) {
    next(err);
  }
}

export async function patchProjectById(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.membership!;
    const userId = req.user!.userId;

    const project = await getProjectForUser(projectId, userId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const payload = parseUpdateProjectPayload(req.body);
    if (!payload.ok) {
      res.status(400).json({ error: payload.error });
      return;
    }

    const nextName = payload.name ?? project.name;
    const nextDescription =
      payload.descriptionProvided ? payload.description : project.description;

    await updateProject(projectId, { name: nextName, description: nextDescription });

    const updatedProject = await getProjectForUser(projectId, userId);
    if (!updatedProject) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.status(200).json({ project: updatedProject });
  } catch (err) {
    next(err);
  }
}

export async function deleteProjectById(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.membership!;

    const deleted = await deleteProject(projectId);
    if (!deleted) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getProjectMembersById(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.membership!;

    const members = await listProjectMembers(projectId);
    res.status(200).json({ members });
  } catch (err) {
    next(err);
  }
}

export async function patchProjectMemberRole(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { projectId } = req.membership!;

    const targetUserId = parsePositiveInt(req.params.userId);
    if (targetUserId === null) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const role = req.body?.role;
    if (!isValidProjectRole(role)) {
      res.status(400).json({ error: "Invalid role. Must be ADMIN, MEMBER, or VIEWER" });
      return;
    }

    const ownerId = await getProjectOwnerId(projectId);
    if (ownerId === null) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (ownerId === targetUserId) {
      res.status(400).json({ error: "Project owner role cannot be changed" });
      return;
    }

    const updated = await updateProjectMemberRole(projectId, targetUserId, role);
    if (!updated) {
      res.status(404).json({ error: "Project member not found" });
      return;
    }

    const members = await listProjectMembers(projectId);
    const member = members.find((item) => item.id === targetUserId);

    if (!member) {
      res.status(404).json({ error: "Project member not found" });
      return;
    }

    res.status(200).json({ member });
  } catch (err) {
    next(err);
  }
}

function parsePositiveInt(value: string | string[] | undefined): number | null {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string") {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function parseCreateProjectPayload(body: unknown):
  | { ok: true; name: string; description: string | null }
  | { ok: false; error: string } {
  const payload = body as { name?: unknown; description?: unknown } | null | undefined;
  const name = normalizeName(payload?.name);

  if (name === null) {
    return { ok: false, error: "Project name is required and must be 1-100 characters" };
  }

  if (!isDescriptionPayloadValid(payload?.description)) {
    return { ok: false, error: "Description must be a string or null" };
  }

  return {
    ok: true,
    name,
    description: normalizeDescription(payload?.description),
  };
}

function parseUpdateProjectPayload(body: unknown):
  | {
      ok: true;
      name?: string;
      description: string | null;
      descriptionProvided: boolean;
    }
  | { ok: false; error: string } {
  const payload = body as { name?: unknown; description?: unknown } | null | undefined;
  const hasName = payload !== null && payload !== undefined && "name" in payload;
  const hasDescription = payload !== null && payload !== undefined && "description" in payload;

  if (!hasName && !hasDescription) {
    return { ok: false, error: "Provide at least one of: name, description" };
  }

  if (hasName) {
    const name = normalizeName(payload?.name);
    if (name === null) {
      return { ok: false, error: "Project name must be 1-100 characters" };
    }

    if (hasDescription && !isDescriptionPayloadValid(payload?.description)) {
      return { ok: false, error: "Description must be a string or null" };
    }

    return {
      ok: true,
      name,
      description: normalizeDescription(payload?.description),
      descriptionProvided: hasDescription,
    };
  }

  if (!isDescriptionPayloadValid(payload?.description)) {
    return { ok: false, error: "Description must be a string or null" };
  }

  return {
    ok: true,
    description: normalizeDescription(payload?.description),
    descriptionProvided: true,
  };
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) {
    return null;
  }

  return trimmed;
}

function isDescriptionPayloadValid(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function normalizeDescription(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
