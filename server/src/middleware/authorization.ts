import type { Request, Response, NextFunction } from "express";
import {
  getProjectMembership,
  hasAtLeastRole,
  type ProjectRole,
} from "../services/projects.service.js";

declare global {
  namespace Express {
    interface Request {
      membership?: { projectId: number; role: ProjectRole };
    }
  }
}

export function requireProjectMember(req: Request, res: Response, next: NextFunction) {
  const raw = req.params.id;
  const projectId = parsePositiveInt(raw);
  if (projectId === null) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }

  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  getProjectMembership(projectId, userId)
    .then((role) => {
      if (!role) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      req.membership = { projectId, role };
      next();
    })
    .catch(next);
}

export function requireRole(minimumRole: ProjectRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    const membership = req.membership;
    if (!membership) {
      next(new Error("requireRole used without requireProjectMember"));
      return;
    }

    if (!hasAtLeastRole(membership.role, minimumRole)) {
      res.status(403).json({ error: `${minimumRole} role required` });
      return;
    }

    next();
  };
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
