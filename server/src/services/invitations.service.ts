import { pool } from "../db/pool.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { ProjectRole } from "./projects.service.js";

type InvitationStatus = "PENDING" | "ACCEPTED" | "DECLINED";
type InvitationRole = "MEMBER" | "VIEWER";

interface InvitationRow extends RowDataPacket {
  id: number;
  project_id: number;
  inviter_id: number;
  invitee_id: number;
  role: InvitationRole;
  status: InvitationStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface InvitationDetailRow extends RowDataPacket {
  id: number;
  project_id: number;
  project_name: string;
  inviter_id: number;
  inviter_name: string;
  role: InvitationRole;
  status: InvitationStatus;
  created_at: Date | string;
}

export interface InvitationRecord {
  id: number;
  projectId: number;
  inviterId: number;
  inviteeId: number;
  role: InvitationRole;
  status: InvitationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InvitationDetail {
  id: number;
  projectId: number;
  projectName: string;
  inviterId: number;
  inviterName: string;
  role: InvitationRole;
  status: InvitationStatus;
  createdAt: string;
}

export function isValidInvitationRole(value: unknown): value is InvitationRole {
  return value === "MEMBER" || value === "VIEWER";
}

export async function createInvitation(
  projectId: number,
  inviterId: number,
  inviteeId: number,
  role: InvitationRole,
): Promise<InvitationRecord> {
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO invitations (project_id, inviter_id, invitee_id, role) VALUES (?, ?, ?, ?)",
    [projectId, inviterId, inviteeId, role],
  );

  return (await getInvitationById(result.insertId))!;
}

export async function findPendingInvitation(
  projectId: number,
  inviteeId: number,
): Promise<InvitationRecord | null> {
  const [rows] = await pool.query<InvitationRow[]>(
    "SELECT * FROM invitations WHERE project_id = ? AND invitee_id = ? AND status = 'PENDING' LIMIT 1",
    [projectId, inviteeId],
  );

  const row = rows[0];
  return row ? mapInvitationRow(row) : null;
}

export async function getPendingInvitationsForUser(
  userId: number,
): Promise<InvitationDetail[]> {
  const [rows] = await pool.query<InvitationDetailRow[]>(
    `
      SELECT
        i.id,
        i.project_id,
        p.name AS project_name,
        i.inviter_id,
        u.display_name AS inviter_name,
        i.role,
        i.status,
        i.created_at
      FROM invitations i
      JOIN projects p ON p.id = i.project_id
      JOIN users u ON u.id = i.inviter_id
      WHERE i.invitee_id = ? AND i.status = 'PENDING'
      ORDER BY i.created_at DESC, i.id DESC
    `,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    inviterId: row.inviter_id,
    inviterName: row.inviter_name,
    role: row.role,
    status: row.status,
    createdAt: toIsoTimestamp(row.created_at),
  }));
}

export async function getInvitationById(
  invitationId: number,
): Promise<InvitationRecord | null> {
  const [rows] = await pool.query<InvitationRow[]>(
    "SELECT * FROM invitations WHERE id = ? LIMIT 1",
    [invitationId],
  );

  const row = rows[0];
  return row ? mapInvitationRow(row) : null;
}

export async function acceptInvitation(
  invitationId: number,
  inviteeId: number,
  projectId: number,
  role: ProjectRole,
): Promise<InvitationRecord> {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query<ResultSetHeader>(
      "UPDATE invitations SET status = 'ACCEPTED' WHERE id = ?",
      [invitationId],
    );

    await connection.query<ResultSetHeader>(
      "INSERT INTO project_memberships (project_id, user_id, role) VALUES (?, ?, ?)",
      [projectId, inviteeId, role],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return (await getInvitationById(invitationId))!;
}

export async function declineInvitation(
  invitationId: number,
): Promise<InvitationRecord> {
  await pool.query<ResultSetHeader>(
    "UPDATE invitations SET status = 'DECLINED' WHERE id = ?",
    [invitationId],
  );

  return (await getInvitationById(invitationId))!;
}

function mapInvitationRow(row: InvitationRow): InvitationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id,
    role: row.role,
    status: row.status,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function toIsoTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toISOString();
}
