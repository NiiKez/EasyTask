import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireProjectMember, requireRole } from "../middleware/authorization.js";
import {
  acceptInvite,
  createInvite,
  declineInvite,
  listPendingInvites,
} from "../controllers/invitations.controller.js";

const router = Router();

router.use(authenticate);

// Project-scoped: create invitation (ADMIN only)
router.post("/projects/:id/invites", requireProjectMember, requireRole("ADMIN"), createInvite);

// User-scoped: list own pending invitations
router.get("/invites", listPendingInvites);

// User-scoped: accept or decline invitation
router.post("/invites/:id/accept", acceptInvite);
router.post("/invites/:id/decline", declineInvite);

export default router;
