import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { signToken } from "../src/services/auth.service.js";

vi.mock("../src/db/pool.js", () => ({
  pool: {
    query: vi.fn(),
    getConnection: vi.fn(),
  },
}));

import { pool } from "../src/db/pool.js";

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const mockGetConnection = pool.getConnection as ReturnType<typeof vi.fn>;

const now = "2026-02-19T10:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Helpers ---

function authHeader(userId: number): Record<string, string> {
  const token = signToken({ userId, email: `user${userId}@example.com` });
  return { Authorization: `Bearer ${token}` };
}

function createMockConnection() {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    project_id: 10,
    title: "Test task",
    description: null,
    priority: "MEDIUM",
    status: "TO_DO",
    position: 0,
    created_by: 7,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// --- Tests ---

describe("Tasks API", () => {
  // ==========================================
  // GET /projects/:id/tasks
  // ==========================================
  describe("GET /projects/:id/tasks", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).get("/projects/10/tasks");
      expect(res.status).toBe(401);
    });

    it("returns 404 when user is not a project member", async () => {
      mockQuery.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/projects/10/tasks").set(authHeader(5));
      expect(res.status).toBe(404);
    });

    it("returns tasks for a project member", async () => {
      mockQuery
        // middleware: getProjectMembership → MEMBER
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        // controller: listTasksForProject
        .mockResolvedValueOnce([
          [
            taskRow({ id: 1, position: 0 }),
            taskRow({ id: 2, title: "Second task", position: 1 }),
          ],
        ]);

      const res = await request(app).get("/projects/10/tasks").set(authHeader(7));

      expect(res.status).toBe(200);
      expect(res.body.tasks).toHaveLength(2);
      expect(res.body.tasks[0]).toEqual({
        id: 1,
        projectId: 10,
        title: "Test task",
        description: null,
        priority: "MEDIUM",
        status: "TO_DO",
        position: 0,
        createdBy: 7,
        createdAt: now,
        updatedAt: now,
      });
    });

    it("returns empty array when project has no tasks", async () => {
      mockQuery
        .mockResolvedValueOnce([[{ role: "VIEWER" }]])
        .mockResolvedValueOnce([[]]);

      const res = await request(app).get("/projects/10/tasks").set(authHeader(7));

      expect(res.status).toBe(200);
      expect(res.body.tasks).toEqual([]);
    });
  });

  // ==========================================
  // POST /projects/:id/tasks
  // ==========================================
  describe("POST /projects/:id/tasks", () => {
    it("returns 403 for VIEWER role", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "VIEWER" }]]);

      const res = await request(app)
        .post("/projects/10/tasks")
        .set(authHeader(9))
        .send({ title: "New task" });

      expect(res.status).toBe(403);
    });

    it("creates a task with defaults", async () => {
      const connection = createMockConnection();
      connection.query
        // MAX(position) query
        .mockResolvedValueOnce([[{ maxPos: 2 }]])
        // INSERT
        .mockResolvedValueOnce([{ insertId: 5 }]);
      mockGetConnection.mockResolvedValueOnce(connection);

      mockQuery
        // middleware: getProjectMembership → MEMBER
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        // controller: getTaskById (after create)
        .mockResolvedValueOnce([[taskRow({ id: 5, position: 3 })]]);

      const res = await request(app)
        .post("/projects/10/tasks")
        .set(authHeader(7))
        .send({ title: "  New task  " });

      expect(res.status).toBe(201);
      expect(res.body.task).toMatchObject({
        id: 5,
        projectId: 10,
        title: "Test task",
        priority: "MEDIUM",
        status: "TO_DO",
        position: 3,
      });

      expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it("creates a task with explicit priority and status", async () => {
      const connection = createMockConnection();
      connection.query
        .mockResolvedValueOnce([[{ maxPos: null }]])
        .mockResolvedValueOnce([{ insertId: 6 }]);
      mockGetConnection.mockResolvedValueOnce(connection);

      mockQuery
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        .mockResolvedValueOnce([
          [taskRow({ id: 6, priority: "HIGH", status: "IN_PROGRESS", position: 0 })],
        ]);

      const res = await request(app)
        .post("/projects/10/tasks")
        .set(authHeader(7))
        .send({ title: "Urgent", priority: "HIGH", status: "IN_PROGRESS" });

      expect(res.status).toBe(201);
      expect(connection.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("INSERT INTO tasks"),
        [10, "Urgent", null, "HIGH", "IN_PROGRESS", 0, 7],
      );
    });

    it("validates required title", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "MEMBER" }]]);

      const res = await request(app)
        .post("/projects/10/tasks")
        .set(authHeader(7))
        .send({ title: " " });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title/i);
    });

    it("validates invalid priority", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "MEMBER" }]]);

      const res = await request(app)
        .post("/projects/10/tasks")
        .set(authHeader(7))
        .send({ title: "Task", priority: "URGENT" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/priority/i);
    });

    it("validates invalid status", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "MEMBER" }]]);

      const res = await request(app)
        .post("/projects/10/tasks")
        .set(authHeader(7))
        .send({ title: "Task", status: "ARCHIVED" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/status/i);
    });
  });

  // ==========================================
  // PATCH /tasks/:taskId
  // ==========================================
  describe("PATCH /tasks/:taskId", () => {
    it("returns 403 for VIEWER role", async () => {
      mockQuery
        // resolveTaskProject: getTaskById
        .mockResolvedValueOnce([[taskRow()]])
        // resolveTaskProject: getProjectMembership
        .mockResolvedValueOnce([[{ role: "VIEWER" }]]);

      const res = await request(app)
        .patch("/tasks/1")
        .set(authHeader(9))
        .send({ title: "Updated" });

      expect(res.status).toBe(403);
    });

    it("returns 404 when task does not exist", async () => {
      // resolveTaskProject: getTaskById → empty
      mockQuery.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .patch("/tasks/999")
        .set(authHeader(7))
        .send({ title: "Updated" });

      expect(res.status).toBe(404);
    });

    it("updates task title", async () => {
      mockQuery
        // resolveTaskProject: getTaskById
        .mockResolvedValueOnce([[taskRow()]])
        // resolveTaskProject: getProjectMembership
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        // controller: getTaskById (existence check)
        .mockResolvedValueOnce([[taskRow()]])
        // controller: updateTask
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // controller: getTaskById (refresh)
        .mockResolvedValueOnce([[taskRow({ title: "Updated title" })]]);

      const res = await request(app)
        .patch("/tasks/1")
        .set(authHeader(7))
        .send({ title: "Updated title" });

      expect(res.status).toBe(200);
      expect(res.body.task.title).toBe("Updated title");
    });

    it("updates task priority", async () => {
      mockQuery
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[taskRow({ priority: "HIGH" })]]);

      const res = await request(app)
        .patch("/tasks/1")
        .set(authHeader(7))
        .send({ priority: "HIGH" });

      expect(res.status).toBe(200);
      expect(res.body.task.priority).toBe("HIGH");
    });

    it("validates empty payload", async () => {
      mockQuery
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        .mockResolvedValueOnce([[taskRow()]]);

      const res = await request(app).patch("/tasks/1").set(authHeader(7)).send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/provide at least one/i);
    });

    it("validates invalid priority value", async () => {
      mockQuery
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        .mockResolvedValueOnce([[taskRow()]]);

      const res = await request(app)
        .patch("/tasks/1")
        .set(authHeader(7))
        .send({ priority: "URGENT" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/priority/i);
    });
  });

  // ==========================================
  // DELETE /tasks/:taskId
  // ==========================================
  describe("DELETE /tasks/:taskId", () => {
    it("returns 403 for VIEWER role", async () => {
      mockQuery
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[{ role: "VIEWER" }]]);

      const res = await request(app).delete("/tasks/1").set(authHeader(9));

      expect(res.status).toBe(403);
    });

    it("deletes task and returns 204", async () => {
      const connection = createMockConnection();
      connection.query
        // SELECT task for position info
        .mockResolvedValueOnce([[taskRow()]])
        // DELETE
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // Shift positions
        .mockResolvedValueOnce([{ affectedRows: 0 }]);
      mockGetConnection.mockResolvedValueOnce(connection);

      mockQuery
        // resolveTaskProject: getTaskById
        .mockResolvedValueOnce([[taskRow()]])
        // resolveTaskProject: getProjectMembership
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        // controller: getTaskById (existence check)
        .mockResolvedValueOnce([[taskRow()]]);

      const res = await request(app).delete("/tasks/1").set(authHeader(7));

      expect(res.status).toBe(204);
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it("returns 404 when task does not exist", async () => {
      mockQuery.mockResolvedValueOnce([[]]);

      const res = await request(app).delete("/tasks/999").set(authHeader(7));

      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // PATCH /tasks/:taskId/move
  // ==========================================
  describe("PATCH /tasks/:taskId/move", () => {
    it("returns 403 for VIEWER role", async () => {
      mockQuery
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[{ role: "VIEWER" }]]);

      const res = await request(app)
        .patch("/tasks/1/move")
        .set(authHeader(9))
        .send({ status: "DONE", position: 0 });

      expect(res.status).toBe(403);
    });

    it("moves task cross-column", async () => {
      const connection = createMockConnection();
      connection.query
        // SELECT FOR UPDATE
        .mockResolvedValueOnce([[taskRow({ status: "TO_DO", position: 0 })]])
        // COUNT for clamping
        .mockResolvedValueOnce([[{ cnt: 2 }]])
        // Close gap in old column
        .mockResolvedValueOnce([{ affectedRows: 0 }])
        // Make room in new column
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // Update task
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      mockGetConnection.mockResolvedValueOnce(connection);

      mockQuery
        // resolveTaskProject: getTaskById
        .mockResolvedValueOnce([[taskRow()]])
        // resolveTaskProject: getProjectMembership
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        // controller: getTaskById (existence check)
        .mockResolvedValueOnce([[taskRow()]])
        // controller: getTaskById (refresh after move)
        .mockResolvedValueOnce([[taskRow({ status: "IN_PROGRESS", position: 1 })]]);

      const res = await request(app)
        .patch("/tasks/1/move")
        .set(authHeader(7))
        .send({ status: "IN_PROGRESS", position: 1 });

      expect(res.status).toBe(200);
      expect(res.body.task.status).toBe("IN_PROGRESS");
      expect(res.body.task.position).toBe(1);
      expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    it("reorders task within same column", async () => {
      const connection = createMockConnection();
      connection.query
        // SELECT FOR UPDATE
        .mockResolvedValueOnce([[taskRow({ status: "TO_DO", position: 0 })]])
        // COUNT for clamping
        .mockResolvedValueOnce([[{ cnt: 3 }]])
        // Shift tasks (moving down)
        .mockResolvedValueOnce([{ affectedRows: 2 }])
        // Update task position
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      mockGetConnection.mockResolvedValueOnce(connection);

      mockQuery
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[taskRow({ position: 2 })]]);

      const res = await request(app)
        .patch("/tasks/1/move")
        .set(authHeader(7))
        .send({ status: "TO_DO", position: 2 });

      expect(res.status).toBe(200);
      expect(res.body.task.position).toBe(2);
    });

    it("validates missing status", async () => {
      mockQuery
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        .mockResolvedValueOnce([[taskRow()]]);

      const res = await request(app)
        .patch("/tasks/1/move")
        .set(authHeader(7))
        .send({ position: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/status/i);
    });

    it("validates missing position", async () => {
      mockQuery
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        .mockResolvedValueOnce([[taskRow()]]);

      const res = await request(app)
        .patch("/tasks/1/move")
        .set(authHeader(7))
        .send({ status: "DONE" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/position/i);
    });

    it("validates negative position", async () => {
      mockQuery
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        .mockResolvedValueOnce([[taskRow()]]);

      const res = await request(app)
        .patch("/tasks/1/move")
        .set(authHeader(7))
        .send({ status: "DONE", position: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/position/i);
    });

    it("validates invalid status value", async () => {
      mockQuery
        .mockResolvedValueOnce([[taskRow()]])
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        .mockResolvedValueOnce([[taskRow()]]);

      const res = await request(app)
        .patch("/tasks/1/move")
        .set(authHeader(7))
        .send({ status: "ARCHIVED", position: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/status/i);
    });
  });
});
