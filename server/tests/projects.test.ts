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

const now = "2026-02-17T10:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Projects API", () => {
  describe("GET /projects", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).get("/projects");
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/authentication required/i);
    });

    it("returns membership-scoped project summaries", async () => {
      mockQuery.mockResolvedValueOnce([
        [
          {
            id: 10,
            name: "Platform",
            description: "Core work",
            created_by: 7,
            created_at: now,
            updated_at: now,
            role: "ADMIN",
            is_owner: 1,
          },
        ],
      ]);

      const res = await request(app).get("/projects").set(authHeader(7));

      expect(res.status).toBe(200);
      expect(res.body.projects).toEqual([
        {
          id: 10,
          name: "Platform",
          description: "Core work",
          createdBy: 7,
          role: "ADMIN",
          isOwner: true,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    });
  });

  describe("POST /projects", () => {
    it("creates project and owner membership", async () => {
      const connection = createMockConnection();
      connection.query
        .mockResolvedValueOnce([{ insertId: 11 }])
        .mockResolvedValueOnce([{ insertId: 1 }]);
      mockGetConnection.mockResolvedValueOnce(connection);

      mockQuery.mockResolvedValueOnce([
        [
          {
            id: 11,
            name: "New Project",
            description: null,
            created_by: 7,
            created_at: now,
            updated_at: now,
            role: "ADMIN",
            is_owner: 1,
          },
        ],
      ]);

      const res = await request(app)
        .post("/projects")
        .set(authHeader(7))
        .send({ name: "  New Project  " });

      expect(res.status).toBe(201);
      expect(res.body.project).toMatchObject({
        id: 11,
        name: "New Project",
        role: "ADMIN",
        isOwner: true,
      });

      expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(1);
      expect(connection.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("INSERT INTO projects"),
        ["New Project", null, 7],
      );
      expect(connection.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("INSERT INTO project_memberships"),
        [11, 7],
      );
    });

    it("validates required name", async () => {
      const res = await request(app).post("/projects").set(authHeader(7)).send({ name: " " });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });
  });

  describe("GET /projects/:id", () => {
    it("returns 404 when project is not visible to current user", async () => {
      // middleware: getProjectMembership → no rows
      mockQuery.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/projects/99").set(authHeader(5));

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Project not found");
    });
  });

  describe("PATCH /projects/:id", () => {
    it("requires admin role", async () => {
      // middleware: getProjectMembership → MEMBER
      mockQuery.mockResolvedValueOnce([[{ role: "MEMBER" }]]);

      const res = await request(app)
        .patch("/projects/10")
        .set(authHeader(9))
        .send({ name: "Renamed" });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin/i);
    });

    it("updates project fields for admins", async () => {
      mockQuery
        // middleware: getProjectMembership → ADMIN
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        // controller: getProjectForUser (data fetch)
        .mockResolvedValueOnce([
          [
            {
              id: 10,
              name: "Platform",
              description: null,
              created_by: 7,
              created_at: now,
              updated_at: now,
              role: "ADMIN",
              is_owner: 1,
            },
          ],
        ])
        // controller: updateProject
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // controller: getProjectForUser (refresh)
        .mockResolvedValueOnce([
          [
            {
              id: 10,
              name: "Renamed",
              description: "Updated",
              created_by: 7,
              created_at: now,
              updated_at: now,
              role: "ADMIN",
              is_owner: 1,
            },
          ],
        ]);

      const res = await request(app)
        .patch("/projects/10")
        .set(authHeader(7))
        .send({ name: "Renamed", description: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.project).toMatchObject({
        id: 10,
        name: "Renamed",
        description: "Updated",
      });
    });
  });

  describe("DELETE /projects/:id", () => {
    it("requires admin role", async () => {
      // middleware: getProjectMembership → VIEWER
      mockQuery.mockResolvedValueOnce([[{ role: "VIEWER" }]]);

      const res = await request(app).delete("/projects/10").set(authHeader(9));

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin/i);
    });

    it("deletes project for admins", async () => {
      mockQuery
        // middleware: getProjectMembership → ADMIN
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        // controller: deleteProject
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app).delete("/projects/10").set(authHeader(7));

      expect(res.status).toBe(204);
    });
  });

  describe("GET /projects/:id/members", () => {
    it("returns member list when caller belongs to project", async () => {
      mockQuery
        // middleware: getProjectMembership → MEMBER
        .mockResolvedValueOnce([[{ role: "MEMBER" }]])
        // controller: listProjectMembers
        .mockResolvedValueOnce([
          [
            {
              id: 7,
              email: "owner@example.com",
              display_name: "Owner",
              role: "ADMIN",
              is_owner: 1,
            },
            {
              id: 9,
              email: "member@example.com",
              display_name: "Member",
              role: "MEMBER",
              is_owner: 0,
            },
          ],
        ]);

      const res = await request(app).get("/projects/10/members").set(authHeader(9));

      expect(res.status).toBe(200);
      expect(res.body.members).toEqual([
        {
          id: 7,
          email: "owner@example.com",
          displayName: "Owner",
          role: "ADMIN",
          isOwner: true,
        },
        {
          id: 9,
          email: "member@example.com",
          displayName: "Member",
          role: "MEMBER",
          isOwner: false,
        },
      ]);
    });
  });

  describe("PATCH /projects/:id/members/:userId", () => {
    it("requires admin role", async () => {
      // middleware: getProjectMembership → MEMBER
      mockQuery.mockResolvedValueOnce([[{ role: "MEMBER" }]]);

      const res = await request(app)
        .patch("/projects/10/members/9")
        .set(authHeader(8))
        .send({ role: "VIEWER" });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin/i);
    });

    it("blocks owner role changes", async () => {
      mockQuery
        // middleware: getProjectMembership → ADMIN
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        // controller: getProjectOwnerId
        .mockResolvedValueOnce([[{ created_by: 7 }]]);

      const res = await request(app)
        .patch("/projects/10/members/7")
        .set(authHeader(8))
        .send({ role: "VIEWER" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/owner role cannot be changed/i);
    });

    it("updates target member role", async () => {
      mockQuery
        // middleware: getProjectMembership → ADMIN
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        // controller: getProjectOwnerId
        .mockResolvedValueOnce([[{ created_by: 7 }]])
        // controller: updateProjectMemberRole
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // controller: listProjectMembers
        .mockResolvedValueOnce([
          [
            {
              id: 7,
              email: "owner@example.com",
              display_name: "Owner",
              role: "ADMIN",
              is_owner: 1,
            },
            {
              id: 9,
              email: "member@example.com",
              display_name: "Member",
              role: "VIEWER",
              is_owner: 0,
            },
          ],
        ]);

      const res = await request(app)
        .patch("/projects/10/members/9")
        .set(authHeader(7))
        .send({ role: "VIEWER" });

      expect(res.status).toBe(200);
      expect(res.body.member).toEqual({
        id: 9,
        email: "member@example.com",
        displayName: "Member",
        role: "VIEWER",
        isOwner: false,
      });
    });
  });
});

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
