export type Role = "ADMIN" | "MEMBER" | "VIEWER";

export interface ProjectSummary {
  id: number;
  name: string;
  description: string | null;
  createdBy: number;
  role: Role;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}
