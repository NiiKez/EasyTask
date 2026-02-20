import { useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../lib/api.js";
import type { ProjectSummary, TaskRecord, Priority, Status } from "../lib/types.js";

interface TaskFormData {
  title: string;
  description: string;
  priority: Priority;
}

type ModalState =
  | { kind: "closed" }
  | { kind: "create"; defaultStatus: Status }
  | { kind: "edit"; task: TaskRecord }
  | { kind: "delete"; task: TaskRecord };

const COLUMNS: { status: Status; label: string }[] = [
  { status: "TO_DO", label: "To Do" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "DONE", label: "Done" },
];

const priorityBadgeColors: Record<Priority, string> = {
  LOW: "bg-gray-100 text-gray-600",
  MEDIUM: "bg-yellow-100 text-yellow-700",
  HIGH: "bg-red-100 text-red-700",
};

export default function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [activeTask, setActiveTask] = useState<TaskRecord | null>(null);
  const [overColumn, setOverColumn] = useState<Status | null>(null);
  const previousTasksRef = useRef<{ tasks: TaskRecord[] } | undefined>(undefined);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<{ project: ProjectSummary }>(`/projects/${projectId}`),
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api<{ tasks: TaskRecord[] }>(`/projects/${projectId}/tasks`),
  });

  const createMutation = useMutation({
    mutationFn: (data: TaskFormData & { status: Status }) =>
      api<{ task: TaskRecord }>(`/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      setModal({ kind: "closed" });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TaskFormData }) =>
      api<{ task: TaskRecord }>(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      setModal({ kind: "closed" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      api<void>(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      setModal({ kind: "closed" });
    },
  });

  const project = projectQuery.data?.project;
  const tasks = tasksQuery.data?.tasks ?? [];
  const isLoading = projectQuery.isLoading || tasksQuery.isLoading;
  const isError = projectQuery.isError || tasksQuery.isError;
  const canEdit = project?.role === "ADMIN" || project?.role === "MEMBER";

  function tasksForColumn(status: Status) {
    return tasks
      .filter((t) => t.status === status)
      .sort((a, b) => a.position - b.position);
  }

  const findColumnForTask = useCallback(
    (taskId: number): Status | undefined => {
      return tasks.find((t) => t.id === taskId)?.status;
    },
    [tasks],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === Number(event.active.id));
      setActiveTask(task ?? null);
    },
    [tasks],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;
      if (!over) {
        setOverColumn(null);
        return;
      }
      // over.id could be a task id or a column droppable id
      const overId = String(over.id);
      // Check if over a column droppable (status string)
      if (["TO_DO", "IN_PROGRESS", "DONE"].includes(overId)) {
        setOverColumn(overId as Status);
        return;
      }
      // Otherwise it's a task — find which column it belongs to
      const col = findColumnForTask(Number(overId));
      setOverColumn(col ?? null);
    },
    [findColumnForTask],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTask(null);
      setOverColumn(null);
      const { active, over } = event;
      if (!over) return;

      const taskId = Number(active.id);
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      // Determine target column
      const overId = String(over.id);
      let targetStatus: Status;
      if (["TO_DO", "IN_PROGRESS", "DONE"].includes(overId)) {
        targetStatus = overId as Status;
      } else {
        const overTask = tasks.find((t) => t.id === Number(overId));
        if (!overTask) return;
        targetStatus = overTask.status;
      }

      // Compute target position
      const targetColumnTasks = tasksForColumn(targetStatus).filter(
        (t) => t.id !== taskId,
      );
      let targetPosition: number;

      if (["TO_DO", "IN_PROGRESS", "DONE"].includes(overId)) {
        // Dropped on empty column area — append at end
        targetPosition = targetColumnTasks.length;
      } else {
        const overIndex = targetColumnTasks.findIndex(
          (t) => t.id === Number(overId),
        );
        targetPosition = overIndex >= 0 ? overIndex : targetColumnTasks.length;
      }

      // No-op if same position
      if (task.status === targetStatus && task.position === targetPosition) {
        return;
      }

      // Snapshot for rollback
      const queryKey = ["tasks", projectId];
      previousTasksRef.current =
        queryClient.getQueryData<{ tasks: TaskRecord[] }>(queryKey);

      // Optimistic update
      queryClient.setQueryData<{ tasks: TaskRecord[] }>(queryKey, (old) => {
        if (!old) return old;
        const updated = old.tasks.map((t) => ({ ...t }));

        // Remove task from old column and re-index
        const oldColumnTasks = updated
          .filter((t) => t.status === task.status && t.id !== taskId)
          .sort((a, b) => a.position - b.position);
        oldColumnTasks.forEach((t, i) => {
          t.position = i;
        });

        // Build new column (excluding the moved task)
        const newColumnTasks =
          task.status === targetStatus
            ? oldColumnTasks // same column — already removed
            : updated
                .filter((t) => t.status === targetStatus && t.id !== taskId)
                .sort((a, b) => a.position - b.position);

        // Insert moved task at target position
        const movedTask = updated.find((t) => t.id === taskId)!;
        movedTask.status = targetStatus;
        newColumnTasks.splice(targetPosition, 0, movedTask);
        newColumnTasks.forEach((t, i) => {
          t.position = i;
        });

        return { tasks: updated };
      });

      // API call
      try {
        await api(`/tasks/${taskId}/move`, {
          method: "PATCH",
          body: JSON.stringify({
            status: targetStatus,
            position: targetPosition,
          }),
        });
        queryClient.invalidateQueries({ queryKey });
      } catch {
        // Rollback
        if (previousTasksRef.current) {
          queryClient.setQueryData(queryKey, previousTasksRef.current);
        }
      }
    },
    [tasks, projectId, queryClient, tasksForColumn],
  );

  const boardContent = (
    <main className="mx-auto flex w-full max-w-7xl flex-1 gap-4 overflow-x-auto px-4 py-6">
      {COLUMNS.map(({ status, label }) => {
        const columnTasks = tasksForColumn(status);
        return (
          <div key={status} className="flex w-80 flex-shrink-0 flex-col rounded-lg bg-gray-100 p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">
                {label}{" "}
                <span className="text-gray-400">({columnTasks.length})</span>
              </h2>
              {canEdit && (
                <button
                  onClick={() => setModal({ kind: "create", defaultStatus: status })}
                  className="rounded px-2 py-0.5 text-sm font-medium text-blue-600 hover:bg-blue-50"
                  aria-label={`Add task to ${label}`}
                >
                  + Add
                </button>
              )}
            </div>
            {canEdit ? (
              <SortableContext
                items={columnTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <DroppableColumn
                  status={status}
                  highlight={overColumn === status && activeTask?.status !== status}
                >
                  {columnTasks.map((task) => (
                    <SortableTaskCard
                      key={task.id}
                      task={task}
                      canEdit={canEdit}
                      onEdit={() => setModal({ kind: "edit", task })}
                      onDelete={() => setModal({ kind: "delete", task })}
                    />
                  ))}
                </DroppableColumn>
              </SortableContext>
            ) : (
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    canEdit={canEdit}
                    onEdit={() => setModal({ kind: "edit", task })}
                    onDelete={() => setModal({ kind: "delete", task })}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </main>
  );

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="rounded px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            &larr; Back
          </button>
          {project && (
            <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
          )}
        </div>
      </header>

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" role="status">
            <span className="sr-only">Loading board…</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="mb-4 text-red-600">Failed to load board</p>
            <button
              onClick={() => {
                projectQuery.refetch();
                tasksQuery.refetch();
              }}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Board columns */}
      {!isLoading && !isError && canEdit && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {boardContent}
          <DragOverlay>
            {activeTask ? (
              <TaskCard
                task={activeTask}
                canEdit={false}
                onEdit={() => {}}
                onDelete={() => {}}
                isOverlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!isLoading && !isError && !canEdit && boardContent}

      {/* Modals */}
      {modal.kind === "create" && (
        <TaskFormModal
          title="Create task"
          submitLabel="Create"
          isSubmitting={createMutation.isPending}
          onClose={() => setModal({ kind: "closed" })}
          onSubmit={(data) => createMutation.mutate({ ...data, status: modal.defaultStatus })}
        />
      )}

      {modal.kind === "edit" && (
        <TaskFormModal
          title="Edit task"
          submitLabel="Save"
          initialData={{
            title: modal.task.title,
            description: modal.task.description ?? "",
            priority: modal.task.priority,
          }}
          isSubmitting={editMutation.isPending}
          onClose={() => setModal({ kind: "closed" })}
          onSubmit={(data) => editMutation.mutate({ id: modal.task.id, data })}
        />
      )}

      {modal.kind === "delete" && (
        <DeleteTaskModal
          taskTitle={modal.task.title}
          isDeleting={deleteMutation.isPending}
          onClose={() => setModal({ kind: "closed" })}
          onConfirm={() => deleteMutation.mutate(modal.task.id)}
        />
      )}
    </div>
  );
}

/* ─── Droppable Column ─── */

function DroppableColumn({
  status,
  highlight,
  children,
}: {
  status: Status;
  highlight: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-1 flex-col gap-2 overflow-y-auto rounded transition-colors ${
        highlight ? "bg-blue-50" : ""
      }`}
      data-column={status}
    >
      {children}
    </div>
  );
}

/* ─── Sortable Task Card ─── */

function SortableTaskCard({
  task,
  canEdit,
  onEdit,
  onDelete,
}: {
  task: TaskRecord;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard
        task={task}
        canEdit={canEdit}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}

/* ─── Task Card ─── */

function TaskCard({
  task,
  canEdit,
  onEdit,
  onDelete,
  isOverlay,
}: {
  task: TaskRecord;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  isOverlay?: boolean;
}) {
  return (
    <div
      className={`rounded-md border border-gray-200 bg-white p-3 shadow-sm ${
        isOverlay ? "rotate-2 shadow-lg" : ""
      }`}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-900">{task.title}</h3>
        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${priorityBadgeColors[task.priority]}`}>
          {task.priority}
        </span>
      </div>
      {task.description && (
        <p className="mb-2 line-clamp-2 text-xs text-gray-500">{task.description}</p>
      )}
      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="rounded px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Task Form Modal (Create / Edit) ─── */

function TaskFormModal({
  title,
  submitLabel,
  initialData,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initialData?: TaskFormData;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (data: TaskFormData) => void;
}) {
  const [taskTitle, setTaskTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [priority, setPriority] = useState<Priority>(initialData?.priority ?? "MEDIUM");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = taskTitle.trim();
    if (!trimmed) return;
    onSubmit({ title: trimmed, description: description.trim(), priority });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="task-title" className="mb-1 block text-sm font-medium text-gray-700">
              Title
            </label>
            <input
              id="task-title"
              type="text"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              required
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Task title"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="task-description" className="mb-1 block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Optional description"
            />
          </div>
          <div className="mb-6">
            <label htmlFor="task-priority" className="mb-1 block text-sm font-medium text-gray-700">
              Priority
            </label>
            <select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
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

/* ─── Delete Task Modal ─── */

function DeleteTaskModal({
  taskTitle,
  isDeleting,
  onClose,
  onConfirm,
}: {
  taskTitle: string;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-2 text-lg font-semibold">Delete task</h2>
        <p className="mb-6 text-sm text-gray-600">
          Are you sure you want to delete <strong>{taskTitle}</strong>? This action cannot be undone.
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
