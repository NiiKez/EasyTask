import { pool } from "../db/pool.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";
export type TaskStatus = "TO_DO" | "IN_PROGRESS" | "DONE";

const VALID_PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH"];
const VALID_STATUSES: TaskStatus[] = ["TO_DO", "IN_PROGRESS", "DONE"];

interface TaskRow extends RowDataPacket {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  position: number;
  created_by: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface TaskRecord {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  position: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export function isValidPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && VALID_PRIORITIES.includes(value as TaskPriority);
}

export function isValidStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && VALID_STATUSES.includes(value as TaskStatus);
}

export async function listTasksForProject(projectId: number): Promise<TaskRecord[]> {
  const [rows] = await pool.query<TaskRow[]>(
    `SELECT id, project_id, title, description, priority, status, position,
            created_by, created_at, updated_at
     FROM tasks
     WHERE project_id = ?
     ORDER BY status, position ASC, id ASC`,
    [projectId],
  );
  return rows.map(mapTaskRow);
}

export async function getTaskById(taskId: number): Promise<TaskRecord | null> {
  const [rows] = await pool.query<TaskRow[]>(
    `SELECT id, project_id, title, description, priority, status, position,
            created_by, created_at, updated_at
     FROM tasks WHERE id = ? LIMIT 1`,
    [taskId],
  );
  return rows[0] ? mapTaskRow(rows[0]) : null;
}

export async function createTask(input: {
  projectId: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  createdBy: number;
}): Promise<number> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [posRows] = await connection.query<(RowDataPacket & { maxPos: number | null })[]>(
      "SELECT MAX(position) AS maxPos FROM tasks WHERE project_id = ? AND status = ?",
      [input.projectId, input.status],
    );
    const nextPosition = (posRows[0]?.maxPos ?? -1) + 1;

    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO tasks (project_id, title, description, priority, status, position, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.projectId,
        input.title,
        input.description,
        input.priority,
        input.status,
        nextPosition,
        input.createdBy,
      ],
    );

    await connection.commit();
    return result.insertId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateTask(
  taskId: number,
  data: { title?: string; description?: string | null; priority?: TaskPriority },
): Promise<boolean> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.title !== undefined) {
    fields.push("title = ?");
    values.push(data.title);
  }
  if (data.description !== undefined) {
    fields.push("description = ?");
    values.push(data.description);
  }
  if (data.priority !== undefined) {
    fields.push("priority = ?");
    values.push(data.priority);
  }

  if (fields.length === 0) return false;

  values.push(taskId);
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`,
    values,
  );
  return result.affectedRows > 0;
}

export async function deleteTask(taskId: number): Promise<boolean> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query<TaskRow[]>(
      "SELECT id, project_id, status, position FROM tasks WHERE id = ? LIMIT 1",
      [taskId],
    );
    const task = rows[0];
    if (!task) {
      await connection.rollback();
      return false;
    }

    await connection.query<ResultSetHeader>("DELETE FROM tasks WHERE id = ?", [taskId]);

    await connection.query<ResultSetHeader>(
      "UPDATE tasks SET position = position - 1 WHERE project_id = ? AND status = ? AND position > ?",
      [task.project_id, task.status, task.position],
    );

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function moveTask(
  taskId: number,
  newStatus: TaskStatus,
  newPosition: number,
): Promise<boolean> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query<TaskRow[]>(
      "SELECT id, project_id, status, position FROM tasks WHERE id = ? LIMIT 1 FOR UPDATE",
      [taskId],
    );
    const task = rows[0];
    if (!task) {
      await connection.rollback();
      return false;
    }

    const oldStatus = task.status;
    const oldPosition = task.position;
    const projectId = task.project_id;

    // Clamp position to valid range
    const [countRows] = await connection.query<(RowDataPacket & { cnt: number })[]>(
      "SELECT COUNT(*) AS cnt FROM tasks WHERE project_id = ? AND status = ? AND id != ?",
      [projectId, newStatus, taskId],
    );
    const maxPosition = countRows[0]?.cnt ?? 0;
    const clampedPosition = Math.min(newPosition, maxPosition);

    if (oldStatus === newStatus) {
      // Same-column reorder
      if (oldPosition === clampedPosition) {
        await connection.commit();
        return true;
      }

      if (oldPosition < clampedPosition) {
        await connection.query<ResultSetHeader>(
          `UPDATE tasks SET position = position - 1
           WHERE project_id = ? AND status = ? AND position > ? AND position <= ?`,
          [projectId, oldStatus, oldPosition, clampedPosition],
        );
      } else {
        await connection.query<ResultSetHeader>(
          `UPDATE tasks SET position = position + 1
           WHERE project_id = ? AND status = ? AND position >= ? AND position < ?`,
          [projectId, oldStatus, clampedPosition, oldPosition],
        );
      }
    } else {
      // Cross-column move: close gap in old column
      await connection.query<ResultSetHeader>(
        "UPDATE tasks SET position = position - 1 WHERE project_id = ? AND status = ? AND position > ?",
        [projectId, oldStatus, oldPosition],
      );

      // Make room in new column
      await connection.query<ResultSetHeader>(
        "UPDATE tasks SET position = position + 1 WHERE project_id = ? AND status = ? AND position >= ?",
        [projectId, newStatus, clampedPosition],
      );
    }

    await connection.query<ResultSetHeader>(
      "UPDATE tasks SET status = ?, position = ? WHERE id = ?",
      [newStatus, clampedPosition, taskId],
    );

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    position: row.position,
    createdBy: row.created_by,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function toIsoTimestamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}
