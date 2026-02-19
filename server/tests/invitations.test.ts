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

function invitationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    project_id: 10,
    inviter_id: 7,
    invitee_id: 9,
    role: "MEMBER",
    status: "PENDING",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// --- Tests ---

describe("Invitations API", () => {
  // ==========================================
  // POST /projects/:id/invites
  // ==========================================
  describe("POST /projects/:id/invites", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .post("/projects/10/invites")
        .send({ email: "invitee@example.com", role: "MEMBER" });

      expect(res.status).toBe(401);
    });

    it("returns 403 for non-ADMIN role", async () => {
      // middleware: getProjectMembership → MEMBER
      mockQuery.mockResolvedValueOnce([[{ role: "MEMBER" }]]);

      const res = await request(app)
        .post("/projects/10/invites")
        .set(authHeader(9))
        .send({ email: "invitee@example.com", role: "MEMBER" });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin/i);
    });

    it("returns 400 when email is missing", async () => {
      // middleware: getProjectMembership → ADMIN
      mockQuery.mockResolvedValueOnce([[{ role: "ADMIN" }]]);

      const res = await request(app)
        .post("/projects/10/invites")
        .set(authHeader(7))
        .send({ role: "MEMBER" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it("returns 400 when email is empty string", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "ADMIN" }]]);

      const res = await request(app)
        .post("/projects/10/invites")
        .set(authHeader(7))
        .send({ email: "  ", role: "MEMBER" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it("returns 400 when role is invalid", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "ADMIN" }]]);

      const res = await request(app)
        .post("/projects/10/invites")
        .set(authHeader(7))
        .send({ email: "invitee@example.com", role: "SUPERUSER" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/role/i);
    });

    it("returns 400 when role is ADMIN", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "ADMIN" }]]);

      const res = await request(app)
        .post("/projects/10/invites")
        .set(authHeader(7))
        .send({ email: "invitee@example.com", role: "ADMIN" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/role/i);
    });

    it("returns 404 when invitee email not found", async () => {
      mockQuery
        // middleware: getProjectMembership → ADMIN
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        // findUserByEmail → not found
        .mockResolvedValueOnce([[]]);

      const res = await request(app)
        .post("/projects/10/invites")
        .set(authHeader(7))
        .send({ email: "nobody@example.com", role: "MEMBER" });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/user not found/i);
    });

    it("returns 400 when inviting yourself", async () => {
      mockQuery
        // middleware: getProjectMembership → ADMIN
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        // findUserByEmail → returns the same user
        .mockResolvedValueOnce([
          [{ id: 7, email: "user7@example.com", password_hash: "hash", display_name: "User 7" }],
        ]);

      const res = await request(app)
        .post("/projects/10/invites")
        .set(authHeader(7))
        .send({ email: "user7@example.com", role: "MEMBER" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cannot invite yourself/i);
    });

    it("returns 409 when user is already a member", async () => {
      mockQuery
        // middleware: getProjectMembership → ADMIN
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        // findUserByEmail → found
        .mockResolvedValueOnce([
          [{ id: 9, email: "member@example.com", password_hash: "hash", display_name: "Member" }],
        ])
        // getProjectMembership (invitee) → already a member
        .mockResolvedValueOnce([[{ role: "MEMBER" }]]);

      const res = await request(app)
        .post("/projects/10/invites")
        .set(authHeader(7))
        .send({ email: "member@example.com", role: "MEMBER" });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already a member/i);
    });

    it("returns 409 when invitation is already pending", async () => {
      mockQuery
        // middleware: getProjectMembership → ADMIN
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        // findUserByEmail → found
        .mockResolvedValueOnce([
          [{ id: 9, email: "invitee@example.com", password_hash: "hash", display_name: "Invitee" }],
        ])
        // getProjectMembership (invitee) → not a member
        .mockResolvedValueOnce([[]])
        // findPendingInvitation → exists
        .mockResolvedValueOnce([[invitationRow()]]);

      const res = await request(app)
        .post("/projects/10/invites")
        .set(authHeader(7))
        .send({ email: "invitee@example.com", role: "MEMBER" });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already pending/i);
    });

    it("creates invitation successfully (201)", async () => {
      mockQuery
        // middleware: getProjectMembership → ADMIN
        .mockResolvedValueOnce([[{ role: "ADMIN" }]])
        // findUserByEmail → found
        .mockResolvedValueOnce([
          [{ id: 9, email: "invitee@example.com", password_hash: "hash", display_name: "Invitee" }],
        ])
        // getProjectMembership (invitee) → not a member
        .mockResolvedValueOnce([[]])
        // findPendingInvitation → none
        .mockResolvedValueOnce([[]])
        // INSERT invitation
        .mockResolvedValueOnce([{ insertId: 1 }])
        // getInvitationById (after insert)
        .mockResolvedValueOnce([[invitationRow()]]);

      const res = await request(app)
        .post("/projects/10/invites")
        .set(authHeader(7))
        .send({ email: "invitee@example.com", role: "MEMBER" });

      expect(res.status).toBe(201);
      expect(res.body.invitation).toEqual({
        id: 1,
        projectId: 10,
        inviterId: 7,
        inviteeId: 9,
        role: "MEMBER",
        status: "PENDING",
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  // ==========================================
  // GET /invites
  // ==========================================
  describe("GET /invites", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).get("/invites");
      expect(res.status).toBe(401);
    });

    it("returns pending invitations with project and inviter details", async () => {
      mockQuery.mockResolvedValueOnce([
        [
          {
            id: 1,
            project_id: 10,
            project_name: "Platform",
            inviter_id: 7,
            inviter_name: "Admin User",
            role: "MEMBER",
            status: "PENDING",
            created_at: now,
          },
        ],
      ]);

      const res = await request(app).get("/invites").set(authHeader(9));

      expect(res.status).toBe(200);
      expect(res.body.invitations).toEqual([
        {
          id: 1,
          projectId: 10,
          projectName: "Platform",
          inviterId: 7,
          inviterName: "Admin User",
          role: "MEMBER",
          status: "PENDING",
          createdAt: now,
        },
      ]);
    });

    it("returns empty array when no pending invitations", async () => {
      mockQuery.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/invites").set(authHeader(9));

      expect(res.status).toBe(200);
      expect(res.body.invitations).toEqual([]);
    });
  });

  // ==========================================
  // POST /invites/:id/accept
  // ==========================================
  describe("POST /invites/:id/accept", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).post("/invites/1/accept");
      expect(res.status).toBe(401);
    });

    it("returns 404 when invitation not found", async () => {
      // getInvitationById → not found
      mockQuery.mockResolvedValueOnce([[]]);

      const res = await request(app).post("/invites/999/accept").set(authHeader(9));

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/invitation not found/i);
    });

    it("returns 403 when user is not the invitee", async () => {
      // getInvitationById → found (invitee is user 9)
      mockQuery.mockResolvedValueOnce([[invitationRow({ invitee_id: 9 })]]);

      // user 5 tries to accept
      const res = await request(app).post("/invites/1/accept").set(authHeader(5));

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not authorized/i);
    });

    it("returns 409 when invitation already processed", async () => {
      // getInvitationById → already accepted
      mockQuery.mockResolvedValueOnce([[invitationRow({ status: "ACCEPTED" })]]);

      const res = await request(app).post("/invites/1/accept").set(authHeader(9));

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already processed/i);
    });

    it("accepts invitation successfully with transaction", async () => {
      const connection = createMockConnection();
      connection.query
        // UPDATE status to ACCEPTED
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // INSERT into project_memberships
        .mockResolvedValueOnce([{ insertId: 1 }]);
      mockGetConnection.mockResolvedValueOnce(connection);

      mockQuery
        // getInvitationById (controller check)
        .mockResolvedValueOnce([[invitationRow()]])
        // getInvitationById (after accept)
        .mockResolvedValueOnce([[invitationRow({ status: "ACCEPTED" })]]);

      const res = await request(app).post("/invites/1/accept").set(authHeader(9));

      expect(res.status).toBe(200);
      expect(res.body.invitation).toMatchObject({
        id: 1,
        status: "ACCEPTED",
      });

      expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
      expect(connection.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("UPDATE invitations SET status = 'ACCEPTED'"),
        [1],
      );
      expect(connection.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("INSERT INTO project_memberships"),
        [10, 9, "MEMBER"],
      );
    });
  });

  // ==========================================
  // POST /invites/:id/decline
  // ==========================================
  describe("POST /invites/:id/decline", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).post("/invites/1/decline");
      expect(res.status).toBe(401);
    });

    it("returns 404 when invitation not found", async () => {
      mockQuery.mockResolvedValueOnce([[]]);

      const res = await request(app).post("/invites/999/decline").set(authHeader(9));

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/invitation not found/i);
    });

    it("returns 403 when user is not the invitee", async () => {
      mockQuery.mockResolvedValueOnce([[invitationRow({ invitee_id: 9 })]]);

      const res = await request(app).post("/invites/1/decline").set(authHeader(5));

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not authorized/i);
    });

    it("returns 409 when invitation already processed", async () => {
      mockQuery.mockResolvedValueOnce([[invitationRow({ status: "DECLINED" })]]);

      const res = await request(app).post("/invites/1/decline").set(authHeader(9));

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already processed/i);
    });

    it("declines invitation successfully", async () => {
      mockQuery
        // getInvitationById (controller check)
        .mockResolvedValueOnce([[invitationRow()]])
        // UPDATE status to DECLINED
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // getInvitationById (after decline)
        .mockResolvedValueOnce([[invitationRow({ status: "DECLINED" })]]);

      const res = await request(app).post("/invites/1/decline").set(authHeader(9));

      expect(res.status).toBe(200);
      expect(res.body.invitation).toMatchObject({
        id: 1,
        status: "DECLINED",
      });
    });
  });
});
