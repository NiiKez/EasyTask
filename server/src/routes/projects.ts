import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireProjectMember, requireRole } from "../middleware/authorization.js";
import {
  createProject,
  deleteProjectById,
  getProjectById,
  getProjectMembersById,
  getProjects,
  patchProjectById,
  patchProjectMemberRole,
} from "../controllers/projects.controller.js";

const router = Router();

router.use(authenticate);

router.get("/projects", getProjects);
router.post("/projects", createProject);
router.get("/projects/:id", requireProjectMember, getProjectById);
router.patch("/projects/:id", requireProjectMember, requireRole("ADMIN"), patchProjectById);
router.delete("/projects/:id", requireProjectMember, requireRole("ADMIN"), deleteProjectById);
router.get("/projects/:id/members", requireProjectMember, getProjectMembersById);
router.patch(
  "/projects/:id/members/:userId",
  requireProjectMember,
  requireRole("ADMIN"),
  patchProjectMemberRole,
);

export default router;
