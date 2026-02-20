export type Role = "ADMIN" | "MEMBER" | "VIEWER";
export type Priority = "LOW" | "MEDIUM" | "HIGH";
export type Status = "TO_DO" | "IN_PROGRESS" | "DONE";

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

export interface TaskRecord {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  priority: Priority;
  status: Status;
  position: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}
