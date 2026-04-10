import { createAbortError } from "./process-control.js";
import type { ProviderKind, ReasoningLevel, TaskRecord, TaskStatus } from "../types.js";

export function createTaskManager(params: {
  store: {
    createTask: (input: {
      agentId: string;
      conversationId: string;
      title: string;
      prompt: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
      scheduledFor?: number | null;
    }) => TaskRecord;
    getTask: (taskId: string) => TaskRecord | null;
    listTasks: (agentId: string) => TaskRecord[];
    transitionTask: (input: {
      taskId: string;
      status: TaskStatus;
      eventType:
        | "queued"
        | "running"
        | "status"
        | "completed"
        | "failed"
        | "timed_out"
        | "cancelled"
        | "result_delivered";
      payload?: Record<string, unknown>;
      runId?: string | null;
      resultText?: string | null;
    }) => { changed?: boolean; finalized?: boolean; task: TaskRecord | null } | TaskRecord | null;
    appendTaskEvent: (input: {
      taskId: string;
      eventType:
        | "queued"
        | "running"
        | "status"
        | "completed"
        | "failed"
        | "timed_out"
        | "cancelled"
        | "result_delivered";
      payload: Record<string, unknown>;
    }) => unknown;
    appendMessage: (input: {
      conversationId: string;
      role: "assistant";
      content: string;
    }) => { id: string };
  };
  executeTask: (params: {
    task: TaskRecord;
    signal: AbortSignal;
    onStatus: (payload: Record<string, unknown>) => void;
  }) => Promise<{
    runId: string;
    assistantText: string;
  }>;
  schedulerEnabled?: boolean;
  pollIntervalMs?: number;
}) {
  const runningControllers = new Map<string, AbortController>();
  const schedulerEnabled = params.schedulerEnabled ?? false;
  const pollIntervalMs = params.pollIntervalMs ?? 5_000;

  async function runTask(taskId: string) {
    const task = params.store.getTask(taskId);
    if (!task || task.status !== "queued") {
      return params.store.getTask(taskId);
    }

    const controller = new AbortController();
    runningControllers.set(taskId, controller);
    params.store.transitionTask({
      taskId,
      status: "running",
      eventType: "running",
      payload: { message: "Task started." },
    });

    try {
      const result = await params.executeTask({
        task,
        signal: controller.signal,
        onStatus(payload) {
          params.store.appendTaskEvent({
            taskId,
            eventType: "status",
            payload,
          });
        },
      });

      const message = params.store.appendMessage({
        conversationId: task.conversationId,
        role: "assistant",
        content: ["[백그라운드 작업 완료]", "", result.assistantText.trim()].join("\n"),
      });
      params.store.transitionTask({
        taskId,
        status: "completed",
        eventType: "completed",
        payload: {
          runId: result.runId,
          messageId: message.id,
        },
        runId: result.runId,
        resultText: result.assistantText,
      });
      params.store.appendTaskEvent({
        taskId,
        eventType: "result_delivered",
        payload: {
          messageId: message.id,
        },
      });
    } catch (error) {
      const status: TaskStatus =
        controller.signal.aborted
          ? "cancelled"
          : error instanceof Error && /timed out/i.test(error.message)
            ? "timed_out"
            : "failed";
      params.store.transitionTask({
        taskId,
        status,
        eventType: status === "timed_out" ? "timed_out" : status,
        payload: {
          error: error instanceof Error ? error.message : "Task failed.",
        },
        resultText: error instanceof Error ? error.message : "Task failed.",
      });
    } finally {
      runningControllers.delete(taskId);
    }

    return params.store.getTask(taskId);
  }

  async function enqueueDetachedTask(input: {
    agentId: string;
    conversationId: string;
    prompt: string;
    title?: string;
    providerKind: ProviderKind;
    model: string;
    reasoningLevel: ReasoningLevel;
    scheduledFor?: number | null;
    startImmediately?: boolean;
  }) {
    const task = params.store.createTask({
      agentId: input.agentId,
      conversationId: input.conversationId,
      title: input.title ?? (input.prompt.trim().slice(0, 60) || "백그라운드 작업"),
      prompt: input.prompt,
      providerKind: input.providerKind,
      model: input.model,
      reasoningLevel: input.reasoningLevel,
      scheduledFor: input.scheduledFor ?? null,
    });

    if ((input.startImmediately ?? true) && !input.scheduledFor) {
      void runTask(task.id);
    }

    return task;
  }

  async function cancelTask(taskId: string) {
    const task = params.store.getTask(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    const running = runningControllers.get(taskId);
    if (running) {
      running.abort(createAbortError("Task cancelled."));
      return params.store.getTask(taskId);
    }

    params.store.transitionTask({
      taskId,
      status: "cancelled",
      eventType: "cancelled",
      payload: { message: "Task cancelled before start." },
      resultText: null,
    });
    return params.store.getTask(taskId);
  }

  function tick() {
    if (!schedulerEnabled) {
      return;
    }
    // Scheduler support stays deliberately conservative in this patch. Immediate
    // detached tasks start right away; future scheduled tasks are reserved for the
    // next iteration of the local automation loop.
  }

  const interval = schedulerEnabled
    ? setInterval(() => {
        void tick();
      }, pollIntervalMs)
    : null;
  if (interval && typeof interval.unref === "function") {
    interval.unref();
  }

  return {
    enqueueDetachedTask,
    runTask,
    cancelTask,
    getRunningTaskIds: () => [...runningControllers.keys()],
    dispose() {
      interval && clearInterval(interval);
      for (const controller of runningControllers.values()) {
        controller.abort(createAbortError("Task manager disposed."));
      }
      runningControllers.clear();
    },
  };
}
