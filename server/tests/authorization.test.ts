import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { requireProjectMember, requireRole } from "../src/middleware/authorization.js";
import { signToken, verifyToken } from "../src/services/auth.service.js";

vi.mock("../src/db/pool.js", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from "../src/db/pool.js";

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

function buildApp(...handlers: express.RequestHandler[]) {
  const app = express();
  app.use(express.json());

  // Simulate authenticate middleware by reading Authorization header
  app.use((req, _res, next) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      try {
        req.user = verifyToken(header.slice(7));
      } catch {
        // leave req.user undefined
      }
    }
    next();
  });

  app.get("/projects/:id/test", ...handlers, (_req, res) => {
    res.status(200).json({ membership: _req.membership });
  });

  return app;
}

function authHeader(userId: number): Record<string, string> {
  const token = signToken({ userId, email: `user${userId}@example.com` });
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireProjectMember", () => {
  const app = buildApp(requireProjectMember);

  it("returns 400 for non-numeric project id", async () => {
    const res = await request(app).get("/projects/abc/test").set(authHeader(1));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid project id");
  });

  it("returns 400 for negative project id", async () => {
    const res = await request(app).get("/projects/-1/test").set(authHeader(1));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid project id");
  });

  it("returns 401 when user is not authenticated", async () => {
    const res = await request(app).get("/projects/1/test");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 404 when user is not a project member", async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const res = await request(app).get("/projects/99/test").set(authHeader(5));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Project not found");
  });

  it("attaches membership and calls next on success", async () => {
    mockQuery.mockResolvedValueOnce([[{ role: "MEMBER" }]]);

    const res = await request(app).get("/projects/10/test").set(authHeader(5));
    expect(res.status).toBe(200);
    expect(res.body.membership).toEqual({ projectId: 10, role: "MEMBER" });
  });
});

describe("requireRole", () => {
  describe('requireRole("ADMIN")', () => {
    const app = buildApp(requireProjectMember, requireRole("ADMIN"));

    it("returns 403 for MEMBER role", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "MEMBER" }]]);

      const res = await request(app).get("/projects/10/test").set(authHeader(5));
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin role required/i);
    });

    it("returns 403 for VIEWER role", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "VIEWER" }]]);

      const res = await request(app).get("/projects/10/test").set(authHeader(5));
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin role required/i);
    });

    it("passes for ADMIN role", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "ADMIN" }]]);

      const res = await request(app).get("/projects/10/test").set(authHeader(5));
      expect(res.status).toBe(200);
      expect(res.body.membership).toEqual({ projectId: 10, role: "ADMIN" });
    });
  });

  describe('requireRole("MEMBER")', () => {
    const app = buildApp(requireProjectMember, requireRole("MEMBER"));

    it("returns 403 for VIEWER role", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "VIEWER" }]]);

      const res = await request(app).get("/projects/10/test").set(authHeader(5));
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/member role required/i);
    });

    it("passes for MEMBER role", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "MEMBER" }]]);

      const res = await request(app).get("/projects/10/test").set(authHeader(5));
      expect(res.status).toBe(200);
    });

    it("passes for ADMIN role", async () => {
      mockQuery.mockResolvedValueOnce([[{ role: "ADMIN" }]]);

      const res = await request(app).get("/projects/10/test").set(authHeader(5));
      expect(res.status).toBe(200);
    });
  });
});
