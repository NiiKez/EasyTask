import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app.js";

// Mock the pool module
vi.mock("../src/db/pool.js", () => ({
  pool: { query: vi.fn() },
}));

// Mock bcrypt
vi.mock("bcrypt", () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
  },
}));

import { pool } from "../src/db/pool.js";
import bcrypt from "bcrypt";

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const mockHash = bcrypt.hash as ReturnType<typeof vi.fn>;
const mockCompare = bcrypt.compare as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Signup ──────────────────────────────────────────────

describe("POST /auth/signup", () => {
  const validBody = {
    email: "test@example.com",
    password: "password123",
    displayName: "Test User",
  };

  it("returns 400 when fields are missing", async () => {
    const res = await request(app).post("/auth/signup").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("returns 400 for invalid email format", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ ...validBody, email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it("returns 400 when password is too short", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ ...validBody, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
  });

  it("returns 409 when email already exists", async () => {
    // findUserByEmail returns an existing user
    mockQuery.mockResolvedValueOnce([
      [{ id: 1, email: "test@example.com", password_hash: "h", display_name: "X" }],
    ]);

    const res = await request(app).post("/auth/signup").send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  it("returns 201 with token and user on success", async () => {
    // findUserByEmail returns no user
    mockQuery.mockResolvedValueOnce([[]]);
    // createUser insert
    mockQuery.mockResolvedValueOnce([{ insertId: 42 }]);
    mockHash.mockResolvedValueOnce("hashed_pw");

    const res = await request(app).post("/auth/signup").send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user).toEqual({
      id: 42,
      email: "test@example.com",
      displayName: "Test User",
    });
  });
});

// ── Login ───────────────────────────────────────────────

describe("POST /auth/login", () => {
  const validBody = { email: "test@example.com", password: "password123" };

  it("returns 400 when fields are missing", async () => {
    const res = await request(app).post("/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("returns 401 for unknown email", async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const res = await request(app).post("/auth/login").send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("returns 401 for wrong password", async () => {
    mockQuery.mockResolvedValueOnce([
      [{ id: 1, email: "test@example.com", password_hash: "h", display_name: "Test" }],
    ]);
    mockCompare.mockResolvedValueOnce(false);

    const res = await request(app).post("/auth/login").send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("returns 200 with token and user on success", async () => {
    mockQuery.mockResolvedValueOnce([
      [{ id: 1, email: "test@example.com", password_hash: "h", display_name: "Test" }],
    ]);
    mockCompare.mockResolvedValueOnce(true);

    const res = await request(app).post("/auth/login").send(validBody);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user).toEqual({
      id: 1,
      email: "test@example.com",
      displayName: "Test",
    });
  });
});

// ── Authenticate Middleware ─────────────────────────────

describe("authenticate middleware", () => {
  // We test by importing and using the middleware directly via a mini-app
  // since no protected routes exist yet. We'll mount a test route.

  let testApp: ReturnType<typeof import("express").default>;

  beforeEach(async () => {
    const express = (await import("express")).default;
    const { authenticate } = await import("../src/middleware/authenticate.js");
    testApp = express();
    testApp.use(express.json());
    testApp.get("/protected", authenticate, (req, res) => {
      res.json({ user: req.user });
    });
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(testApp).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication/i);
  });

  it("returns 401 for an invalid token", async () => {
    const res = await request(testApp)
      .get("/protected")
      .set("Authorization", "Bearer invalid.token.here");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  it("passes and sets req.user for a valid token", async () => {
    // Get a real token by importing signToken
    const { signToken } = await import("../src/services/auth.service.js");
    const token = signToken({ userId: 7, email: "a@b.com" });

    const res = await request(testApp)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ userId: 7, email: "a@b.com" });
  });
});
