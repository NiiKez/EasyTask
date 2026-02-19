import { pool } from "../db/pool.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

export type ProjectRole = "ADMIN" | "MEMBER" | "VIEWER";

const ROLE_RANK: Record<ProjectRole, number> = {
  VIEWER: 1,
  MEMBER: 2,
  ADMIN: 3,
};

interface ProjectForUserRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  created_by: number;
  created_at: Date | string;
  updated_at: Date | string;
  role: ProjectRole;
  is_owner: number;
}

interface ProjectMembershipRow extends RowDataPacket {
  role: ProjectRole;
}

interface ProjectOwnerRow extends RowDataPacket {
  created_by: number;
}

interface ProjectMemberRow extends RowDataPacket {
  id: number;
  email: string;
  display_name: string;
  role: ProjectRole;
  is_owner: number;
}

export interface ProjectRecord {
  id: number;
  name: string;
  description: string | null;
  createdBy: number;
  role: ProjectRole;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberRecord {
  id: number;
  email: string;
  displayName: string;
  role: ProjectRole;
  isOwner: boolean;
}

export function hasAtLeastRole(role: ProjectRole, required: ProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export function isValidProjectRole(value: unknown): value is ProjectRole {
  return value === "ADMIN" || value === "MEMBER" || value === "VIEWER";
}

export async function listProjectsForUser(userId: number): Promise<ProjectRecord[]> {
  const [rows] = await pool.query<ProjectForUserRow[]>(
    `
      SELECT
        p.id,
        p.name,
        p.description,
        p.created_by,
        p.created_at,
        p.updated_at,
        pm.role,
        CASE WHEN p.created_by = pm.user_id THEN 1 ELSE 0 END AS is_owner
      FROM project_memberships pm
      JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = ?
      ORDER BY p.updated_at DESC, p.id DESC
    `,
    [userId],
  );

  return rows.map(mapProjectRow);
}

export async function getProjectForUser(
  projectId: number,
  userId: number,
): Promise<ProjectRecord | null> {
  const [rows] = await pool.query<ProjectForUserRow[]>(
    `
      SELECT
        p.id,
        p.name,
        p.description,
        p.created_by,
        p.created_at,
        p.updated_at,
        pm.role,
        CASE WHEN p.created_by = pm.user_id THEN 1 ELSE 0 END AS is_owner
      FROM projects p
      JOIN project_memberships pm ON pm.project_id = p.id
      WHERE p.id = ? AND pm.user_id = ?
      LIMIT 1
    `,
    [projectId, userId],
  );

  const row = rows[0];
  return row ? mapProjectRow(row) : null;
}

export async function createProjectForUser(input: {
  name: string;
  description: string | null;
  userId: number;
}): Promise<number> {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [projectResult] = await connection.query<ResultSetHeader>(
      "INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)",
      [input.name, input.description, input.userId],
    );

    await connection.query<ResultSetHeader>(
      "INSERT INTO project_memberships (project_id, user_id, role) VALUES (?, ?, 'ADMIN')",
      [projectResult.insertId, input.userId],
    );

    await connection.commit();
    return projectResult.insertId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateProject(
  projectId: number,
  data: { name: string; description: string | null },
): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE projects SET name = ?, description = ? WHERE id = ?",
    [data.name, data.description, projectId],
  );
  return result.affectedRows > 0;
}

export async function deleteProject(projectId: number): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>("DELETE FROM projects WHERE id = ?", [
    projectId,
  ]);
  return result.affectedRows > 0;
}

export async function getProjectMembership(
  projectId: number,
  userId: number,
): Promise<ProjectRole | null> {
  const [rows] = await pool.query<ProjectMembershipRow[]>(
    "SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ? LIMIT 1",
    [projectId, userId],
  );
  return rows[0]?.role ?? null;
}

export async function getProjectOwnerId(projectId: number): Promise<number | null> {
  const [rows] = await pool.query<ProjectOwnerRow[]>(
    "SELECT created_by FROM projects WHERE id = ? LIMIT 1",
    [projectId],
  );
  return rows[0]?.created_by ?? null;
}

export async function listProjectMembers(projectId: number): Promise<ProjectMemberRecord[]> {
  const [rows] = await pool.query<ProjectMemberRow[]>(
    `
      SELECT
        u.id,
        u.email,
        u.display_name,
        pm.role,
        CASE WHEN p.created_by = u.id THEN 1 ELSE 0 END AS is_owner
      FROM project_memberships pm
      JOIN users u ON u.id = pm.user_id
      JOIN projects p ON p.id = pm.project_id
      WHERE pm.project_id = ?
      ORDER BY is_owner DESC, u.display_name ASC, u.id ASC
    `,
    [projectId],
  );

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isOwner: row.is_owner === 1,
  }));
}

export async function updateProjectMemberRole(
  projectId: number,
  userId: number,
  role: ProjectRole,
): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE project_memberships SET role = ? WHERE project_id = ? AND user_id = ?",
    [role, projectId, userId],
  );
  return result.affectedRows > 0;
}

function mapProjectRow(row: ProjectForUserRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdBy: row.created_by,
    role: row.role,
    isOwner: row.is_owner === 1,
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
