import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireProjectMember, requireRole } from "../middleware/authorization.js";
import { getProjectMembership } from "../services/projects.service.js";
import { getTaskById } from "../services/tasks.service.js";
import {
  createNewTask,
  deleteTaskById,
  getTasks,
  moveTaskById,
  patchTask,
} from "../controllers/tasks.controller.js";

const router = Router();

router.use(authenticate);

// Project-scoped routes
router.get("/projects/:id/tasks", requireProjectMember, getTasks);
router.post("/projects/:id/tasks", requireProjectMember, requireRole("MEMBER"), createNewTask);

// Task-scoped routes (resolve project from task)
router.patch("/tasks/:taskId", resolveTaskProject, requireRole("MEMBER"), patchTask);
router.delete("/tasks/:taskId", resolveTaskProject, requireRole("MEMBER"), deleteTaskById);
router.patch("/tasks/:taskId/move", resolveTaskProject, requireRole("MEMBER"), moveTaskById);

function resolveTaskProject(req: Request, res: Response, next: NextFunction) {
  const rawTaskId = req.params.taskId;
  const parsed = Number(rawTaskId);
  if (!Number.isInteger(parsed) || parsed < 1) {
    res.status(400).json({ error: "Invalid task id" });
    return;
  }

  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  getTaskById(parsed)
    .then((task) => {
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      return getProjectMembership(task.projectId, userId).then((role) => {
        if (!role) {
          res.status(404).json({ error: "Task not found" });
          return;
        }

        req.membership = { projectId: task.projectId, role };
        next();
      });
    })
    .catch(next);
}

export default router;
