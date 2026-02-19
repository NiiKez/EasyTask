import type { NextFunction, Request, Response } from "express";
import {
  createTask,
  deleteTask,
  getTaskById,
  isValidPriority,
  isValidStatus,
  listTasksForProject,
  moveTask,
  updateTask,
  type TaskPriority,
  type TaskStatus,
} from "../services/tasks.service.js";

export async function getTasks(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.membership!;
    const tasks = await listTasksForProject(projectId);
    res.status(200).json({ tasks });
  } catch (err) {
    next(err);
  }
}

export async function createNewTask(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.membership!;
    const userId = req.user!.userId;

    const payload = parseCreateTaskPayload(req.body);
    if (!payload.ok) {
      res.status(400).json({ error: payload.error });
      return;
    }

    const taskId = await createTask({
      projectId,
      title: payload.title,
      description: payload.description,
      priority: payload.priority,
      status: payload.status,
      createdBy: userId,
    });

    const task = await getTaskById(taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
}

export async function patchTask(req: Request, res: Response, next: NextFunction) {
  try {
    const taskId = parsePositiveInt(req.params.taskId);
    if (taskId === null) {
      res.status(400).json({ error: "Invalid task id" });
      return;
    }

    const existing = await getTaskById(taskId);
    if (!existing || existing.projectId !== req.membership!.projectId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const payload = parseUpdateTaskPayload(req.body);
    if (!payload.ok) {
      res.status(400).json({ error: payload.error });
      return;
    }

    await updateTask(taskId, {
      title: payload.title,
      description: payload.descriptionProvided ? payload.description : undefined,
      priority: payload.priority,
    });

    const task = await getTaskById(taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.status(200).json({ task });
  } catch (err) {
    next(err);
  }
}

export async function deleteTaskById(req: Request, res: Response, next: NextFunction) {
  try {
    const taskId = parsePositiveInt(req.params.taskId);
    if (taskId === null) {
      res.status(400).json({ error: "Invalid task id" });
      return;
    }

    const existing = await getTaskById(taskId);
    if (!existing || existing.projectId !== req.membership!.projectId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const deleted = await deleteTask(taskId);
    if (!deleted) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function moveTaskById(req: Request, res: Response, next: NextFunction) {
  try {
    const taskId = parsePositiveInt(req.params.taskId);
    if (taskId === null) {
      res.status(400).json({ error: "Invalid task id" });
      return;
    }

    const existing = await getTaskById(taskId);
    if (!existing || existing.projectId !== req.membership!.projectId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const payload = parseMovePayload(req.body);
    if (!payload.ok) {
      res.status(400).json({ error: payload.error });
      return;
    }

    await moveTask(taskId, payload.status, payload.position);

    const task = await getTaskById(taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.status(200).json({ task });
  } catch (err) {
    next(err);
  }
}

// --- Validation helpers ---

function parsePositiveInt(value: string | string[] | undefined): number | null {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string") return null;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function parseCreateTaskPayload(body: unknown):
  | {
      ok: true;
      title: string;
      description: string | null;
      priority: TaskPriority;
      status: TaskStatus;
    }
  | { ok: false; error: string } {
  const payload = body as
    | { title?: unknown; description?: unknown; priority?: unknown; status?: unknown }
    | null
    | undefined;

  const title = normalizeTitle(payload?.title);
  if (title === null) {
    return { ok: false, error: "Title is required and must be 1-255 characters" };
  }

  if (
    payload?.description !== undefined &&
    payload?.description !== null &&
    typeof payload?.description !== "string"
  ) {
    return { ok: false, error: "Description must be a string or null" };
  }
  const description = normalizeDescription(payload?.description);

  let priority: TaskPriority = "MEDIUM";
  if (payload?.priority !== undefined) {
    if (!isValidPriority(payload.priority)) {
      return { ok: false, error: "Priority must be LOW, MEDIUM, or HIGH" };
    }
    priority = payload.priority;
  }

  let status: TaskStatus = "TO_DO";
  if (payload?.status !== undefined) {
    if (!isValidStatus(payload.status)) {
      return { ok: false, error: "Status must be TO_DO, IN_PROGRESS, or DONE" };
    }
    status = payload.status;
  }

  return { ok: true, title, description, priority, status };
}

function parseUpdateTaskPayload(body: unknown):
  | {
      ok: true;
      title?: string;
      description: string | null;
      descriptionProvided: boolean;
      priority?: TaskPriority;
    }
  | { ok: false; error: string } {
  const payload = body as
    | { title?: unknown; description?: unknown; priority?: unknown }
    | null
    | undefined;

  const hasTitle = payload !== null && payload !== undefined && "title" in payload;
  const hasDescription = payload !== null && payload !== undefined && "description" in payload;
  const hasPriority = payload !== null && payload !== undefined && "priority" in payload;

  if (!hasTitle && !hasDescription && !hasPriority) {
    return { ok: false, error: "Provide at least one of: title, description, priority" };
  }

  let title: string | undefined;
  if (hasTitle) {
    const normalized = normalizeTitle(payload?.title);
    if (normalized === null) {
      return { ok: false, error: "Title must be 1-255 characters" };
    }
    title = normalized;
  }

  if (
    hasDescription &&
    payload?.description !== null &&
    typeof payload?.description !== "string"
  ) {
    return { ok: false, error: "Description must be a string or null" };
  }

  let priority: TaskPriority | undefined;
  if (hasPriority) {
    if (!isValidPriority(payload?.priority)) {
      return { ok: false, error: "Priority must be LOW, MEDIUM, or HIGH" };
    }
    priority = payload!.priority as TaskPriority;
  }

  return {
    ok: true,
    title,
    description: hasDescription ? normalizeDescription(payload?.description) : null,
    descriptionProvided: hasDescription,
    priority,
  };
}

function parseMovePayload(body: unknown):
  | { ok: true; status: TaskStatus; position: number }
  | { ok: false; error: string } {
  const payload = body as { status?: unknown; position?: unknown } | null | undefined;

  if (!payload?.status || !isValidStatus(payload.status)) {
    return { ok: false, error: "Status is required and must be TO_DO, IN_PROGRESS, or DONE" };
  }

  if (
    payload?.position === undefined ||
    payload?.position === null ||
    typeof payload.position !== "number" ||
    !Number.isInteger(payload.position) ||
    payload.position < 0
  ) {
    return { ok: false, error: "Position is required and must be a non-negative integer" };
  }

  return { ok: true, status: payload.status, position: payload.position };
}

function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255) return null;
  return trimmed;
}

function normalizeDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
