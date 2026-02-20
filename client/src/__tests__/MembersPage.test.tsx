import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";
import MembersPage from "../pages/MembersPage.js";
import type { ProjectSummary, ProjectMember } from "../lib/types.js";

/* ─── Mocks ─── */

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../context/AuthContext.js", () => ({
  useAuth: () => ({
    user: { id: 1, email: "test@test.com", displayName: "Test User" },
    logout: vi.fn(),
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

function renderMembers() {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/projects/1/members"]}>
        <Routes>
          <Route
            path="/projects/:projectId/members"
            element={<MembersPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const adminProject: ProjectSummary = {
  id: 1,
  name: "Alpha",
  description: "First project",
  createdBy: 1,
  role: "ADMIN",
  isOwner: true,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

const viewerProject: ProjectSummary = {
  ...adminProject,
  role: "VIEWER",
  isOwner: false,
};

const sampleMembers: ProjectMember[] = [
  {
    id: 1,
    email: "owner@test.com",
    displayName: "Owner User",
    role: "ADMIN",
    isOwner: true,
  },
  {
    id: 2,
    email: "member@test.com",
    displayName: "Member User",
    role: "MEMBER",
    isOwner: false,
  },
  {
    id: 3,
    email: "viewer@test.com",
    displayName: "Viewer User",
    role: "VIEWER",
    isOwner: false,
  },
];

function mockApiForMembers(
  project = adminProject,
  members = sampleMembers,
) {
  mockApiFn.mockImplementation((path: string) => {
    if (path === "/projects/1") return Promise.resolve({ project });
    if (path === "/projects/1/members") return Promise.resolve({ members });
    return Promise.resolve(undefined);
  });
}

/* ─── Tests ─── */

describe("MembersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFn = vi.fn();
  });

  it("shows loading state", () => {
    mockApiFn.mockReturnValue(new Promise(() => {}));
    renderMembers();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders member list with roles and owner badge", async () => {
    mockApiForMembers();
    renderMembers();
    await waitFor(() => {
      expect(screen.getByText("Owner User")).toBeInTheDocument();
    });
    expect(screen.getByText("Member User")).toBeInTheDocument();
    expect(screen.getByText("Viewer User")).toBeInTheDocument();
    expect(screen.getByText("owner@test.com")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Members (3)")).toBeInTheDocument();
  });

  it("ADMIN sees role dropdowns and invite form", async () => {
    mockApiForMembers(adminProject);
    renderMembers();
    await waitFor(() => {
      expect(screen.getByText("Owner User")).toBeInTheDocument();
    });
    // Invite form visible
    expect(screen.getByText("Invite a user")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toBeInTheDocument();
    expect(screen.getByText("Send invite")).toBeInTheDocument();

    // Role dropdowns for non-owner members
    const roleSelects = screen.getAllByRole("combobox");
    // One for invite role + two for non-owner members
    expect(roleSelects.length).toBe(3);
  });

  it("VIEWER does not see role controls or invite form", async () => {
    mockApiForMembers(viewerProject);
    renderMembers();
    await waitFor(() => {
      expect(screen.getByText("Owner User")).toBeInTheDocument();
    });
    expect(screen.queryByText("Invite a user")).not.toBeInTheDocument();
    // Should see role badges instead of dropdowns
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    expect(screen.getByText("MEMBER")).toBeInTheDocument();
    expect(screen.getByText("VIEWER")).toBeInTheDocument();
    // No comboboxes
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("role change calls correct API", async () => {
    const user = userEvent.setup();
    mockApiForMembers();
    renderMembers();
    await waitFor(() => {
      expect(screen.getByText("Member User")).toBeInTheDocument();
    });

    // Find the role select for "Member User"
    const memberSelect = screen.getByLabelText("Change role for Member User");
    expect(memberSelect).toHaveValue("MEMBER");

    mockApiFn.mockResolvedValue({
      member: { ...sampleMembers[1], role: "VIEWER" },
    });
    await user.selectOptions(memberSelect, "VIEWER");

    await waitFor(() => {
      expect(mockApiFn).toHaveBeenCalledWith("/projects/1/members/2", {
        method: "PATCH",
        body: JSON.stringify({ role: "VIEWER" }),
      });
    });
  });

  it("invite form submits correctly", async () => {
    const user = userEvent.setup();
    mockApiForMembers();
    renderMembers();
    await waitFor(() => {
      expect(screen.getByText("Invite a user")).toBeInTheDocument();
    });

    mockApiFn.mockResolvedValue({ invitation: { id: 1 } });
    await user.type(screen.getByLabelText("Email"), "new@test.com");
    await user.click(screen.getByText("Send invite"));

    await waitFor(() => {
      expect(mockApiFn).toHaveBeenCalledWith("/projects/1/invites", {
        method: "POST",
        body: JSON.stringify({ email: "new@test.com", role: "MEMBER" }),
      });
    });
  });

  it("shows error message from failed invite", async () => {
    const user = userEvent.setup();
    mockApiForMembers();
    renderMembers();
    await waitFor(() => {
      expect(screen.getByText("Invite a user")).toBeInTheDocument();
    });

    mockApiFn.mockRejectedValue({ error: "User not found" });
    await user.type(screen.getByLabelText("Email"), "unknown@test.com");
    await user.click(screen.getByText("Send invite"));

    await waitFor(() => {
      expect(screen.getByText("User not found")).toBeInTheDocument();
    });
  });

  it("navigates back to board", async () => {
    const user = userEvent.setup();
    mockApiForMembers();
    renderMembers();
    await waitFor(() => {
      expect(screen.getByText("Owner User")).toBeInTheDocument();
    });
    await user.click(screen.getByText("← Back to board"));
    expect(mockNavigate).toHaveBeenCalledWith("/projects/1");
  });

  it("shows error state with retry button", async () => {
    mockApiFn.mockRejectedValue({ error: "Server error" });
    renderMembers();
    await waitFor(() => {
      expect(screen.getByText("Failed to load members")).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});
