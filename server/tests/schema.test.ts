import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../src/db/migrations");

function readMigration(filename: string): string {
  return readFileSync(path.join(migrationsDir, filename), "utf-8");
}

describe("database migrations", () => {
  it("contains all expected migration files in order", () => {
    const files = readdirSync(migrationsDir).sort();
    expect(files).toEqual([
      "001_users.sql",
      "002_projects.sql",
      "003_project_memberships.sql",
      "004_tasks.sql",
      "005_invitations.sql",
    ]);
  });

  describe("001_users", () => {
    const sql = readMigration("001_users.sql");

    it("creates users table with required columns", () => {
      expect(sql).toContain("CREATE TABLE");
      expect(sql).toContain("users");
      expect(sql).toContain("email VARCHAR(255)");
      expect(sql).toContain("password_hash VARCHAR(255)");
      expect(sql).toContain("display_name VARCHAR(100)");
    });

    it("has unique constraint on email", () => {
      expect(sql).toMatch(/UNIQUE.*email/i);
    });
  });

  describe("002_projects", () => {
    const sql = readMigration("002_projects.sql");

    it("creates projects table with required columns", () => {
      expect(sql).toContain("CREATE TABLE");
      expect(sql).toContain("projects");
      expect(sql).toContain("name VARCHAR(100)");
      expect(sql).toContain("created_by INT UNSIGNED");
    });

    it("has foreign key to users", () => {
      expect(sql).toMatch(/FOREIGN KEY.*created_by.*REFERENCES users/i);
    });
  });

  describe("003_project_memberships", () => {
    const sql = readMigration("003_project_memberships.sql");

    it("creates project_memberships table with role enum", () => {
      expect(sql).toContain("CREATE TABLE");
      expect(sql).toContain("project_memberships");
      expect(sql).toMatch(/role ENUM\('ADMIN', 'MEMBER', 'VIEWER'\)/);
    });

    it("has unique constraint on project_id + user_id", () => {
      expect(sql).toMatch(/UNIQUE.*project.*user/i);
    });

    it("has foreign keys to projects and users", () => {
      expect(sql).toMatch(/FOREIGN KEY.*project_id.*REFERENCES projects/i);
      expect(sql).toMatch(/FOREIGN KEY.*user_id.*REFERENCES users/i);
    });

    it("indexes user_id for membership lookups", () => {
      expect(sql).toMatch(/INDEX.*user/i);
    });
  });

  describe("004_tasks", () => {
    const sql = readMigration("004_tasks.sql");

    it("creates tasks table with required columns", () => {
      expect(sql).toContain("CREATE TABLE");
      expect(sql).toContain("tasks");
      expect(sql).toContain("title VARCHAR(255)");
      expect(sql).toContain("position INT UNSIGNED");
    });

    it("has status enum matching board columns", () => {
      expect(sql).toMatch(/status ENUM\('TO_DO', 'IN_PROGRESS', 'DONE'\)/);
    });

    it("has priority enum", () => {
      expect(sql).toMatch(/priority ENUM\('LOW', 'MEDIUM', 'HIGH'\)/);
    });

    it("has composite index on project_id + status", () => {
      expect(sql).toMatch(/INDEX.*project_id.*status/i);
    });

    it("has foreign keys to projects and users", () => {
      expect(sql).toMatch(/FOREIGN KEY.*project_id.*REFERENCES projects/i);
      expect(sql).toMatch(/FOREIGN KEY.*created_by.*REFERENCES users/i);
    });
  });

  describe("005_invitations", () => {
    const sql = readMigration("005_invitations.sql");

    it("creates invitations table with required columns", () => {
      expect(sql).toContain("CREATE TABLE");
      expect(sql).toContain("invitations");
      expect(sql).toContain("inviter_id INT UNSIGNED");
      expect(sql).toContain("invitee_id INT UNSIGNED");
    });

    it("has status enum for invitation lifecycle", () => {
      expect(sql).toMatch(/status ENUM\('PENDING', 'ACCEPTED', 'DECLINED'\)/);
    });

    it("has role enum matching membership roles", () => {
      expect(sql).toMatch(/role ENUM\('ADMIN', 'MEMBER', 'VIEWER'\)/);
    });

    it("has composite index on invitee_id + status", () => {
      expect(sql).toMatch(/INDEX.*invitee.*status/i);
    });

    it("has unique constraint to prevent duplicate active invites", () => {
      expect(sql).toMatch(/UNIQUE.*project.*invitee.*status/i);
    });

    it("has foreign keys to projects and users", () => {
      expect(sql).toMatch(/FOREIGN KEY.*project_id.*REFERENCES projects/i);
      expect(sql).toMatch(/FOREIGN KEY.*inviter_id.*REFERENCES users/i);
      expect(sql).toMatch(/FOREIGN KEY.*invitee_id.*REFERENCES users/i);
    });
  });
});
