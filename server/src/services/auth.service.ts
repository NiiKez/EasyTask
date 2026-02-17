import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: { userId: number; email: string }): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: number; email: string } {
  return jwt.verify(token, env.JWT_SECRET) as { userId: number; email: string };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [rows] = await pool.query<UserRow[]>(
    "SELECT id, email, password_hash, display_name FROM users WHERE email = ?",
    [email],
  );
  return rows[0] ?? null;
}

export async function createUser(
  email: string,
  passwordHash: string,
  displayName: string,
): Promise<{ id: number; email: string; displayName: string }> {
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)",
    [email, passwordHash, displayName],
  );
  return { id: result.insertId, email, displayName };
}
