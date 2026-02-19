import type { NextFunction, Request, Response } from "express";
import { findUserByEmail } from "../services/auth.service.js";
import { getProjectMembership } from "../services/projects.service.js";
import {
  acceptInvitation,
  createInvitation,
  declineInvitation,
  findPendingInvitation,
  getInvitationById,
  getPendingInvitationsForUser,
  isValidInvitationRole,
} from "../services/invitations.service.js";

export async function createInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.membership!;
    const inviterId = req.user!.userId;

    const email = parseEmail(req.body?.email);
    if (!email) {
      res.status(400).json({ error: "Valid email is required" });
      return;
    }

    const role = req.body?.role;
    if (!isValidInvitationRole(role)) {
      res.status(400).json({ error: "Role must be MEMBER or VIEWER" });
      return;
    }

    const invitee = await findUserByEmail(email);
    if (!invitee) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (invitee.id === inviterId) {
      res.status(400).json({ error: "Cannot invite yourself" });
      return;
    }

    const existingMembership = await getProjectMembership(projectId, invitee.id);
    if (existingMembership) {
      res.status(409).json({ error: "User is already a member" });
      return;
    }

    const pendingInvite = await findPendingInvitation(projectId, invitee.id);
    if (pendingInvite) {
      res.status(409).json({ error: "Invitation already pending" });
      return;
    }

    const invitation = await createInvitation(projectId, inviterId, invitee.id, role);
    res.status(201).json({ invitation });
  } catch (err) {
    next(err);
  }
}

export async function listPendingInvites(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const invitations = await getPendingInvitationsForUser(userId);
    res.status(200).json({ invitations });
  } catch (err) {
    next(err);
  }
}

export async function acceptInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const invitationId = parsePositiveInt(req.params.id);
    if (invitationId === null) {
      res.status(400).json({ error: "Invalid invitation id" });
      return;
    }

    const userId = req.user!.userId;

    const existing = await getInvitationById(invitationId);
    if (!existing) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    if (existing.inviteeId !== userId) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    if (existing.status !== "PENDING") {
      res.status(409).json({ error: "Invitation already processed" });
      return;
    }

    const invitation = await acceptInvitation(
      invitationId,
      existing.inviteeId,
      existing.projectId,
      existing.role,
    );
    res.status(200).json({ invitation });
  } catch (err) {
    next(err);
  }
}

export async function declineInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const invitationId = parsePositiveInt(req.params.id);
    if (invitationId === null) {
      res.status(400).json({ error: "Invalid invitation id" });
      return;
    }

    const userId = req.user!.userId;

    const existing = await getInvitationById(invitationId);
    if (!existing) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    if (existing.inviteeId !== userId) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    if (existing.status !== "PENDING") {
      res.status(409).json({ error: "Invitation already processed" });
      return;
    }

    const invitation = await declineInvitation(invitationId);
    res.status(200).json({ invitation });
  } catch (err) {
    next(err);
  }
}

function parseEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
