import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
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
router.get("/projects/:id", getProjectById);
router.patch("/projects/:id", patchProjectById);
router.delete("/projects/:id", deleteProjectById);
router.get("/projects/:id/members", getProjectMembersById);
router.patch("/projects/:id/members/:userId", patchProjectMemberRole);

export default router;
