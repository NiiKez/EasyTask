import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { ProjectSummary, ProjectMember, Role } from "../lib/types.js";

const roleBadgeColors: Record<Role, string> = {
  ADMIN: "bg-purple-100 text-purple-700",
  MEMBER: "bg-blue-100 text-blue-700",
  VIEWER: "bg-gray-100 text-gray-600",
};

export default function MembersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<{ project: ProjectSummary }>(`/projects/${projectId}`),
  });

  const membersQuery = useQuery({
    queryKey: ["members", projectId],
    queryFn: () =>
      api<{ members: ProjectMember[] }>(`/projects/${projectId}/members`),
  });

  const project = projectQuery.data?.project;
  const members = membersQuery.data?.members ?? [];
  const isLoading = projectQuery.isLoading || membersQuery.isLoading;
  const isError = projectQuery.isError || membersQuery.isError;
  const isAdmin = project?.role === "ADMIN";

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4">
          <button
            onClick={() => navigate(`/projects/${projectId}`)}
            className="rounded px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            &larr; Back to board
          </button>
          {project && (
            <h1 className="text-xl font-bold text-gray-900">
              {project.name} — Members
            </h1>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-20">
            <div
              className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"
              role="status"
            >
              <span className="sr-only">Loading members…</span>
            </div>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="py-20 text-center">
            <p className="mb-4 text-red-600">Failed to load members</p>
            <button
              onClick={() => {
                projectQuery.refetch();
                membersQuery.refetch();
              }}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        )}

        {/* Content */}
        {!isLoading && !isError && (
          <>
            {/* Invite form (admin only) */}
            {isAdmin && (
              <InviteForm
                projectId={projectId!}
                onSuccess={() =>
                  queryClient.invalidateQueries({
                    queryKey: ["members", projectId],
                  })
                }
              />
            )}

            {/* Member list */}
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Members ({members.length})
                </h2>
              </div>
              <ul className="divide-y divide-gray-100">
                {members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isAdmin={isAdmin}
                    projectId={projectId!}
                  />
                ))}
              </ul>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/* ─── Invite Form ─── */

function InviteForm({
  projectId,
  onSuccess,
}: {
  projectId: string;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"MEMBER" | "VIEWER">("MEMBER");
  const [error, setError] = useState<string | null>(null);

  const inviteMutation = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      api(`/projects/${projectId}/invites`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      setEmail("");
      setRole("MEMBER");
      setError(null);
      onSuccess();
    },
    onError: (err: { error?: string }) => {
      setError(err.error ?? "Failed to send invitation");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setError(null);
    inviteMutation.mutate({ email: trimmed, role });
  };

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">
        Invite a user
      </h2>
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div className="flex-1">
          <label
            htmlFor="invite-email"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="user@example.com"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="invite-role"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as "MEMBER" | "VIEWER")}
            className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={inviteMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {inviteMutation.isPending ? "Sending…" : "Send invite"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

/* ─── Member Row ─── */

function MemberRow({
  member,
  isAdmin,
  projectId,
}: {
  member: ProjectMember;
  isAdmin: boolean;
  projectId: string;
}) {
  const queryClient = useQueryClient();

  const roleMutation = useMutation({
    mutationFn: (newRole: Role) =>
      api<{ member: ProjectMember }>(
        `/projects/${projectId}/members/${member.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ role: newRole }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", projectId] });
    },
  });

  return (
    <li className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">
            {member.displayName}
          </p>
          <p className="text-xs text-gray-500">{member.email}</p>
        </div>
        {member.isOwner && (
          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
            Owner
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isAdmin && !member.isOwner ? (
          <select
            value={member.role}
            onChange={(e) => roleMutation.mutate(e.target.value as Role)}
            disabled={roleMutation.isPending}
            aria-label={`Change role for ${member.displayName}`}
            className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            <option value="ADMIN">Admin</option>
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer</option>
          </select>
        ) : (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeColors[member.role]}`}
          >
            {member.role}
          </span>
        )}
      </div>
    </li>
  );
}
