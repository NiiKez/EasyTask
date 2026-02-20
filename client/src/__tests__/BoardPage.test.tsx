import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";
import BoardPage from "../pages/BoardPage.js";
import type { ProjectSummary, TaskRecord } from "../lib/types.js";

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

function renderBoard() {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/projects/1"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<BoardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleProject: ProjectSummary = {
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
  ...sampleProject,
  role: "VIEWER",
  isOwner: false,
};

const sampleTasks: TaskRecord[] = [
  {
    id: 1,
    projectId: 1,
    title: "Design UI",
    description: "Create mockups",
    priority: "HIGH",
    status: "TO_DO",
    position: 0,
    createdBy: 1,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  },
  {
    id: 2,
    projectId: 1,
    title: "Write tests",
    description: null,
    priority: "MEDIUM",
    status: "IN_PROGRESS",
    position: 0,
    createdBy: 1,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  },
  {
    id: 3,
    projectId: 1,
    title: "Setup CI",
    description: "Configure pipeline",
    priority: "LOW",
    status: "DONE",
    position: 0,
    createdBy: 1,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  },
];

function mockApiForBoard(project = sampleProject, tasks = sampleTasks) {
  mockApiFn.mockImplementation((path: string) => {
    if (path === "/projects/1") return Promise.resolve({ project });
    if (path === "/projects/1/tasks") return Promise.resolve({ tasks });
    return Promise.resolve(undefined);
  });
}

/* ─── Tests ─── */

describe("BoardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFn = vi.fn();
  });

  it("shows loading state", () => {
    mockApiFn.mockReturnValue(new Promise(() => {}));
    renderBoard();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders columns with task data", async () => {
    mockApiForBoard();
    renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("To Do")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Design UI")).toBeInTheDocument();
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("Setup CI")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("MEDIUM")).toBeInTheDocument();
    expect(screen.getByText("LOW")).toBeInTheDocument();
  });

  it("shows column counts", async () => {
    mockApiForBoard();
    renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Design UI")).toBeInTheDocument();
    });
    // Each column has 1 task, so 3 count badges showing (1)
    const counts = screen.getAllByText("(1)");
    expect(counts).toHaveLength(3);
  });

  it("shows error state with retry button", async () => {
    mockApiFn.mockRejectedValue({ error: "Server error" });
    renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Failed to load board")).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("opens create modal and submits", async () => {
    const user = userEvent.setup();
    mockApiForBoard();
    renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Design UI")).toBeInTheDocument();
    });

    const addButtons = screen.getAllByText("+ Add");
    await user.click(addButtons[0]); // first column (TO_DO)
    expect(screen.getByText("Create task")).toBeInTheDocument();

    mockApiFn.mockResolvedValue({ task: sampleTasks[0] });
    await user.type(screen.getByLabelText("Title"), "New Task");
    await user.type(screen.getByLabelText("Description"), "A description");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockApiFn).toHaveBeenCalledWith("/projects/1/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "New Task",
          description: "A description",
          priority: "MEDIUM",
          status: "TO_DO",
        }),
      });
    });
  });

  it("opens edit modal pre-filled and submits", async () => {
    const user = userEvent.setup();
    mockApiForBoard();
    renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Design UI")).toBeInTheDocument();
    });

    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]);
    expect(screen.getByText("Edit task")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Design UI");
    expect(screen.getByLabelText("Description")).toHaveValue("Create mockups");
    expect(screen.getByLabelText("Priority")).toHaveValue("HIGH");

    mockApiFn.mockResolvedValue({ task: sampleTasks[0] });
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Design UI v2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApiFn).toHaveBeenCalledWith("/tasks/1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Design UI v2",
          description: "Create mockups",
          priority: "HIGH",
        }),
      });
    });
  });

  it("shows delete confirmation and submits", async () => {
    const user = userEvent.setup();
    mockApiForBoard();
    renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Design UI")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByText("Delete");
    await user.click(deleteButtons[0]);
    expect(screen.getByText("Delete task")).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();

    mockApiFn.mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => {
      expect(mockApiFn).toHaveBeenCalledWith("/tasks/1", { method: "DELETE" });
    });
  });

  it("hides action buttons for VIEWER role", async () => {
    mockApiForBoard(viewerProject);
    renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Design UI")).toBeInTheDocument();
    });
    expect(screen.queryAllByText("+ Add")).toHaveLength(0);
    expect(screen.queryAllByText("Edit")).toHaveLength(0);
    expect(screen.queryAllByText("Delete")).toHaveLength(0);
  });

  it("navigates back to dashboard on back button", async () => {
    const user = userEvent.setup();
    mockApiForBoard();
    renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    await user.click(screen.getByText("← Back"));
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
  });

  it("renders drag handles for ADMIN/MEMBER but not VIEWER", async () => {
    // ADMIN — cards should have sortable drag attributes
    mockApiForBoard(sampleProject, sampleTasks);
    const { unmount } = renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Design UI")).toBeInTheDocument();
    });
    // Sortable cards get aria-roledescription="sortable"
    const sortableCards = screen.getAllByRole("button", { hidden: true }).filter(
      (el) => el.getAttribute("aria-roledescription") === "sortable",
    );
    expect(sortableCards.length).toBeGreaterThan(0);
    unmount();

    // VIEWER — no sortable attributes
    mockApiForBoard(viewerProject, sampleTasks);
    renderBoard();
    await waitFor(() => {
      expect(screen.getByText("Design UI")).toBeInTheDocument();
    });
    const viewerSortables = screen
      .queryAllByRole("button", { hidden: true })
      .filter((el) => el.getAttribute("aria-roledescription") === "sortable");
    expect(viewerSortables).toHaveLength(0);
  });
});
