import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import type { ProjectSummary, InvitationDetail } from "../lib/types.js";

interface ProjectFormData {
  name: string;
  description: string;
}

type ModalState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; project: ProjectSummary }
  | { kind: "delete"; project: ProjectSummary };

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: ProjectSummary[] }>("/projects"),
  });

  const invitationsQuery = useQuery({
    queryKey: ["invitations"],
    queryFn: () => api<{ invitations: InvitationDetail[] }>("/invites"),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: number) =>
      api(`/invites/${id}/accept`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const declineMutation = useMutation({
    mutationFn: (id: number) =>
      api(`/invites/${id}/decline`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: ProjectFormData) =>
      api<{ project: ProjectSummary }>("/projects", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setModal({ kind: "closed" });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ProjectFormData }) =>
      api<{ project: ProjectSummary }>(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setModal({ kind: "closed" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      api<void>(`/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setModal({ kind: "closed" });
    },
  });

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const projects = projectsQuery.data?.projects ?? [];
  const invitations = invitationsQuery.data?.invitations ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">My Projects</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user?.displayName}</span>
            <button
              onClick={handleLogout}
              className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-300"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Pending invitations */}
        {invitations.length > 0 && (
          <div className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              Pending Invitations
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <p className="font-medium text-gray-900">
                    {inv.projectName}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Invited by {inv.inviterName} as{" "}
                    <span className="font-medium">{inv.role}</span>
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => acceptMutation.mutate(inv.id)}
                      disabled={acceptMutation.isPending}
                      className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => declineMutation.mutate(inv.id)}
                      disabled={declineMutation.isPending}
                      className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading state */}
        {projectsQuery.isLoading && (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" role="status">
              <span className="sr-only">Loading projects…</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {projectsQuery.isError && (
          <div className="py-20 text-center">
            <p className="mb-4 text-red-600">Failed to load projects</p>
            <button
              onClick={() => projectsQuery.refetch()}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {projectsQuery.isSuccess && projects.length === 0 && (
          <div className="py-20 text-center">
            <h2 className="mb-2 text-lg font-semibold text-gray-900">No projects yet</h2>
            <p className="mb-6 text-gray-500">Create your first project to get started.</p>
            <button
              onClick={() => setModal({ kind: "create" })}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Create your first project
            </button>
          </div>
        )}

        {/* Populated state */}
        {projectsQuery.isSuccess && projects.length > 0 && (
          <>
            <div className="mb-6 flex items-center justify-between">
              <p className="text-sm text-gray-500">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
              <button
                onClick={() => setModal({ kind: "create" })}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                New project
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  onEdit={() => setModal({ kind: "edit", project })}
                  onDelete={() => setModal({ kind: "delete", project })}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Modals */}
      {modal.kind === "create" && (
        <ProjectFormModal
          title="Create project"
          submitLabel="Create"
          isSubmitting={createMutation.isPending}
          onClose={() => setModal({ kind: "closed" })}
          onSubmit={(data) => createMutation.mutate(data)}
        />
      )}

      {modal.kind === "edit" && (
        <ProjectFormModal
          title="Edit project"
          submitLabel="Save"
          initialData={{ name: modal.project.name, description: modal.project.description ?? "" }}
          isSubmitting={editMutation.isPending}
          onClose={() => setModal({ kind: "closed" })}
          onSubmit={(data) => editMutation.mutate({ id: modal.project.id, data })}
        />
      )}

      {modal.kind === "delete" && (
        <DeleteConfirmModal
          projectName={modal.project.name}
          isDeleting={deleteMutation.isPending}
          onClose={() => setModal({ kind: "closed" })}
          onConfirm={() => deleteMutation.mutate(modal.project.id)}
        />
      )}
    </div>
  );
}

/* ─── Project Card ─── */

const roleBadgeColors: Record<string, string> = {
  ADMIN: "bg-purple-100 text-purple-700",
  MEMBER: "bg-blue-100 text-blue-700",
  VIEWER: "bg-gray-100 text-gray-600",
};

function ProjectCard({
  project,
  onClick,
  onEdit,
  onDelete,
}: {
  project: ProjectSummary;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isAdmin = project.role === "ADMIN";

  return (
    <div
      className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
      onClick={onClick}
    >
      <div className="mb-2 flex items-start justify-between">
        <h3 className="font-semibold text-gray-900">{project.name}</h3>
        <div className="flex items-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeColors[project.role]}`}>
            {project.role}
          </span>
          {project.isOwner && (
            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
              Owner
            </span>
          )}
        </div>
      </div>
      {project.description && (
        <p className="mb-3 line-clamp-2 text-sm text-gray-500">{project.description}</p>
      )}
      {isAdmin && (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onEdit}
            className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Project Form Modal (Create / Edit) ─── */

function ProjectFormModal({
  title,
  submitLabel,
  initialData,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initialData?: ProjectFormData;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (data: ProjectFormData) => void;
}) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSubmit({ name: trimmedName, description: description.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="project-name" className="mb-1 block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Project name"
            />
          </div>
          <div className="mb-6">
            <label htmlFor="project-description" className="mb-1 block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Optional description"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Saving…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Delete Confirm Modal ─── */

function DeleteConfirmModal({
  projectName,
  isDeleting,
  onClose,
  onConfirm,
}: {
  projectName: string;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-2 text-lg font-semibold">Delete project</h2>
        <p className="mb-6 text-sm text-gray-600">
          Are you sure you want to delete <strong>{projectName}</strong>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isDeleting ? "Deleting…" : "Confirm delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
