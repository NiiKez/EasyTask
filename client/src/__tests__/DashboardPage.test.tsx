import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";
import DashboardPage from "../pages/DashboardPage.js";
import type { ProjectSummary, InvitationDetail } from "../lib/types.js";

/* ─── Mocks ─── */

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockLogout = vi.fn();
vi.mock("../context/AuthContext.js", () => ({
  useAuth: () => ({
    user: { id: 1, email: "test@test.com", displayName: "Test User" },
    logout: mockLogout,
    isAuthenticated: true,
    token: "fake-token",
  }),
}));

let mockApiFn: ReturnType<typeof vi.fn>;

vi.mock("../lib/api.js", () => ({
  api: (...args: unknown[]) => mockApiFn(...args),
}));

/* ─── Helpers ─── */

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderDashboard() {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleProjects: ProjectSummary[] = [
  {
    id: 1,
    name: "Alpha",
    description: "First project",
    createdBy: 1,
    role: "ADMIN",
    isOwner: true,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "Beta",
    description: null,
    createdBy: 2,
    role: "VIEWER",
    isOwner: false,
    createdAt: "2025-01-02T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  },
];

const sampleInvitations: InvitationDetail[] = [
  {
    id: 10,
    projectId: 5,
    projectName: "Gamma",
    inviterId: 3,
    inviterName: "Alice",
    role: "MEMBER",
    status: "PENDING",
    createdAt: "2025-01-05T00:00:00Z",
  },
];

function mockApiForDashboard(
  projects: ProjectSummary[] = sampleProjects,
  invitations: InvitationDetail[] = [],
) {
  mockApiFn.mockImplementation((path: string) => {
    if (path === "/projects") return Promise.resolve({ projects });
    if (path === "/invites") return Promise.resolve({ invitations });
    return Promise.resolve(undefined);
  });
}

/* ─── Tests ─── */

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFn = vi.fn();
  });

  it("shows loading state", () => {
    mockApiFn.mockReturnValue(new Promise(() => {})); // never resolves
    renderDashboard();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows empty state when no projects", async () => {
    mockApiFn.mockResolvedValue({ projects: [] });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("No projects yet")).toBeInTheDocument();
    });
    expect(screen.getByText("Create your first project")).toBeInTheDocument();
  });

  it("shows project cards with correct data", async () => {
    mockApiFn.mockResolvedValue({ projects: sampleProjects });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("First project")).toBeInTheDocument();
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    expect(screen.getByText("VIEWER")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
  });

  it("shows edit/delete only for admin projects", async () => {
    mockApiFn.mockResolvedValue({ projects: sampleProjects });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    const editButtons = screen.getAllByText("Edit");
    const deleteButtons = screen.getAllByText("Delete");
    // Only one admin project, so one set of buttons
    expect(editButtons).toHaveLength(1);
    expect(deleteButtons).toHaveLength(1);
  });

  it("shows error state with retry button", async () => {
    mockApiFn.mockRejectedValue({ error: "Server error" });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Failed to load projects")).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("retries on error retry button click", async () => {
    const user = userEvent.setup();
    mockApiFn.mockRejectedValueOnce({ error: "fail" });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
    mockApiFn.mockResolvedValue({ projects: sampleProjects });
    await user.click(screen.getByText("Retry"));
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
  });

  it("opens create modal and submits", async () => {
    const user = userEvent.setup();
    mockApiFn.mockResolvedValue({ projects: [] });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Create your first project")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Create your first project"));
    expect(screen.getByText("Create project")).toBeInTheDocument();

    // Fill form
    mockApiFn.mockResolvedValue({ project: sampleProjects[0] });
    await user.type(screen.getByLabelText("Name"), "New Project");
    await user.type(screen.getByLabelText("Description"), "A description");
    await user.click(screen.getByText("Create"));

    await waitFor(() => {
      expect(mockApiFn).toHaveBeenCalledWith("/projects", {
        method: "POST",
        body: JSON.stringify({ name: "New Project", description: "A description" }),
      });
    });
  });

  it("opens edit modal pre-filled and submits", async () => {
    const user = userEvent.setup();
    mockApiFn.mockResolvedValue({ projects: sampleProjects });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Edit"));
    expect(screen.getByText("Edit project")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Alpha");
    expect(screen.getByLabelText("Description")).toHaveValue("First project");

    mockApiFn.mockResolvedValue({ project: sampleProjects[0] });
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Alpha Updated");
    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(mockApiFn).toHaveBeenCalledWith("/projects/1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Alpha Updated", description: "First project" }),
      });
    });
  });

  it("shows delete confirmation and submits", async () => {
    const user = userEvent.setup();
    mockApiFn.mockResolvedValue({ projects: sampleProjects });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Delete"));
    expect(screen.getByText("Delete project")).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();

    mockApiFn.mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => {
      expect(mockApiFn).toHaveBeenCalledWith("/projects/1", { method: "DELETE" });
    });
  });

  it("navigates to project on card click", async () => {
    const user = userEvent.setup();
    mockApiFn.mockResolvedValue({ projects: sampleProjects });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Alpha"));
    expect(mockNavigate).toHaveBeenCalledWith("/projects/1");
  });

  it("logs out on logout button click", async () => {
    const user = userEvent.setup();
    mockApiFn.mockResolvedValue({ projects: [] });
    renderDashboard();
    await user.click(screen.getByText("Log out"));
    expect(mockLogout).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  it("displays user name in header", async () => {
    mockApiFn.mockResolvedValue({ projects: [] });
    renderDashboard();
    expect(screen.getByText("Test User")).toBeInTheDocument();
  });

  it("shows pending invitations section", async () => {
    mockApiForDashboard(sampleProjects, sampleInvitations);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Pending Invitations")).toBeInTheDocument();
    });
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    expect(screen.getByText(/Invited by Alice as/)).toBeInTheDocument();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Decline")).toBeInTheDocument();
  });

  it("does not show invitations section when empty", async () => {
    mockApiForDashboard(sampleProjects, []);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.queryByText("Pending Invitations")).not.toBeInTheDocument();
  });

  it("accepts an invitation", async () => {
    const user = userEvent.setup();
    mockApiForDashboard(sampleProjects, sampleInvitations);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Gamma")).toBeInTheDocument();
    });

    mockApiFn.mockResolvedValue({ invitation: { ...sampleInvitations[0], status: "ACCEPTED" } });
    await user.click(screen.getByText("Accept"));

    await waitFor(() => {
      expect(mockApiFn).toHaveBeenCalledWith("/invites/10/accept", { method: "POST" });
    });
  });

  it("declines an invitation", async () => {
    const user = userEvent.setup();
    mockApiForDashboard(sampleProjects, sampleInvitations);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Gamma")).toBeInTheDocument();
    });

    mockApiFn.mockResolvedValue({ invitation: { ...sampleInvitations[0], status: "DECLINED" } });
    await user.click(screen.getByText("Decline"));

    await waitFor(() => {
      expect(mockApiFn).toHaveBeenCalledWith("/invites/10/decline", { method: "POST" });
    });
  });
});
