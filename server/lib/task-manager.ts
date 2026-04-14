import { createAbortError } from "./process-control.js";
import type {
  AgentHeartbeatRecord,
  ConversationRecord,
  HeartbeatLogRecord,
  HeartbeatTriggerSource,
  ProviderKind,
  ReasoningLevel,
  TaskKind,
  TaskFlowRecord,
  TaskFlowStepRecord,
  TaskRecord,
  TaskStatus,
} from "../types.js";

function parsePollInterval(value: string | number | undefined, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(500, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(500, parsed);
    }
  }
  return fallback;
}

function taskCompletionPrefix(taskKind: TaskKind | undefined) {
  switch (taskKind) {
    case "heartbeat":
      return "[\uD558\uD2B8\uBE44\uD2B8 \uC791\uC5C5 \uC644\uB8CC]";
    case "scheduled":
      return "[\uC608\uC57D \uC791\uC5C5 \uC644\uB8CC]";
    case "continuation":
      return "[\uACC4\uC18D \uC791\uC5C5 \uC644\uB8CC]";
    case "subagent":
      return "[\uC11C\uBE0C \uC5D0\uC774\uC804\uD2B8 \uC644\uB8CC]";
    case "flow_step":
      return "[\uD50C\uB85C\uC6B0 \uB2E8\uACC4 \uC644\uB8CC]";
    default:
      return "[\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC644\uB8CC]";
  }
}

function dueTimestamp(task: TaskRecord) {
  return task.scheduledFor ?? task.createdAt;
}

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
      taskKind?: TaskKind;
      parentTaskId?: string | null;
      nestingDepth?: number;
      scheduledFor?: number | null;
      taskFlowId?: string | null;
      flowStepKey?: string | null;
      originRunId?: string | null;
    }) => TaskRecord;
    getTask: (taskId: string) => TaskRecord | null;
    listTasks: (agentId: string) => TaskRecord[];
    listTasksForConversation?: (conversationId: string) => TaskRecord[];
    getConversation?: (conversationId: string) => ConversationRecord | null;
    listAgents?: () => Array<{ id: string }>;
    listHeartbeatLogs?: (agentId: string) => HeartbeatLogRecord[];
    transitionHeartbeatLog?: (input: {
      id: string;
      taskId?: string | null;
      status?: HeartbeatLogRecord["status"];
      summary?: string | null;
      errorText?: string | null;
      startedAt?: number | null;
      completedAt?: number | null;
    }) => HeartbeatLogRecord | null;
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
    createTaskFlow?: (input: {
      agentId: string;
      conversationId: string;
      title: string;
      triggerSource?: TaskFlowRecord["triggerSource"];
      originRunId?: string | null;
    }) => TaskFlowRecord;
    getTaskFlow?: (flowId: string) => TaskFlowRecord | null;
    listTaskFlows?: (agentId: string) => TaskFlowRecord[];
    transitionTaskFlow?: (input: {
      flowId: string;
      status?: TaskFlowRecord["status"];
      resultSummary?: string | null;
      errorText?: string | null;
      completedAt?: number | null;
    }) => TaskFlowRecord | null;
    createTaskFlowStep?: (input: {
      flowId: string;
      stepKey: string;
      dependencyStepKey?: string | null;
      title: string;
      prompt: string;
    }) => TaskFlowStepRecord;
    getTaskFlowStep?: (stepId: string) => TaskFlowStepRecord | null;
    listTaskFlowSteps?: (flowId: string) => TaskFlowStepRecord[];
    transitionTaskFlowStep?: (input: {
      stepId: string;
      taskId?: string | null;
      status?: TaskFlowStepRecord["status"];
      completedAt?: number | null;
    }) => TaskFlowStepRecord | null;
  };
  executeTask: (params: {
    task: TaskRecord;
    signal: AbortSignal;
    onStatus: (payload: Record<string, unknown>) => void;
    isHeartbeatRun: boolean;
    currentTaskId: string | null;
    nestingDepth: number;
  }) => Promise<{
    runId: string;
    assistantText: string;
  }>;
  schedulerEnabled?: boolean;
  pollIntervalMs?: number;
  getHeartbeatState?: (agentId: string) => AgentHeartbeatRecord | null;
  scheduleHeartbeatRun?: (input: {
    agentId: string;
    triggerSource: HeartbeatTriggerSource;
  }) => Promise<unknown>;
}) {
  const runningControllers = new Map<string, AbortController>();
  const knownAgentIds = new Set<string>();
  const schedulerEnabled = params.schedulerEnabled ?? process.env.ENABLE_AGENT_AUTOMATIONS === "true";
  const pollIntervalMs = parsePollInterval(
    params.pollIntervalMs ?? process.env.HEARTBEAT_POLL_INTERVAL_MS,
    5_000,
  );
  let schedulerBusy = false;

  function registerAgentId(agentId: string) {
    if (agentId) {
      knownAgentIds.add(agentId);
    }
  }

  function getHeartbeatLogForTask(task: TaskRecord) {
    if (task.taskKind !== "heartbeat" || !params.store.listHeartbeatLogs) {
      return null;
    }
    return (
      params.store
        .listHeartbeatLogs(task.agentId)
        .find((log) => log.taskId === task.id) ?? null
    );
  }

  function getFlowForTask(task: TaskRecord) {
    if (!task.taskFlowId || !params.store.getTaskFlow) {
      return null;
    }
    return params.store.getTaskFlow(task.taskFlowId);
  }

  function getFlowStepForTask(task: TaskRecord) {
    if (!task.taskFlowId || !task.flowStepKey || !params.store.listTaskFlowSteps) {
      return null;
    }
    return (
      params.store
        .listTaskFlowSteps(task.taskFlowId)
        .find((step) => step.stepKey === task.flowStepKey) ?? null
    );
  }

  function transitionFlowForTask(
    task: TaskRecord,
    status: Extract<TaskStatus, "completed" | "failed" | "timed_out" | "cancelled">,
    resultSummary: string | null,
  ) {
    const flow = getFlowForTask(task);
    const flowStep = getFlowStepForTask(task);
    if (!flow || !flowStep || !params.store.transitionTaskFlow || !params.store.transitionTaskFlowStep) {
      return;
    }

    const completedAt = Date.now();
    const stepStatus =
      status === "completed"
        ? "completed"
        : status === "cancelled"
          ? "cancelled"
          : "failed";
    params.store.transitionTaskFlowStep({
      stepId: flowStep.id,
      taskId: task.id,
      status: stepStatus,
      completedAt,
    });

    const steps = params.store.listTaskFlowSteps?.(flow.id) ?? [];
    const queuedSteps = steps.filter((step) => step.status === "queued");
    const blockingFailures = steps.some(
      (step) => step.status === "failed" || step.status === "cancelled",
    );
    const allCompleted = steps.length > 0 && steps.every((step) => step.status === "completed");

    if (status === "completed" && allCompleted) {
      params.store.transitionTaskFlow({
        flowId: flow.id,
        status: "completed",
        resultSummary,
        completedAt,
      });
      return;
    }

    if (blockingFailures || status === "timed_out") {
      params.store.transitionTaskFlow({
        flowId: flow.id,
        status: status === "cancelled" ? "cancelled" : "failed",
        errorText: resultSummary,
        completedAt,
      });
      return;
    }

    if (queuedSteps.length > 0) {
      params.store.transitionTaskFlow({
        flowId: flow.id,
        status: "running",
        resultSummary: resultSummary ?? flow.resultSummary,
      });
      void startTaskFlow(flow.id);
    }
  }

  function announceSubagentCompletion(task: TaskRecord, assistantText: string) {
    if (task.taskKind !== "subagent" || !params.store.getConversation) {
      return;
    }
    const childConversation = params.store.getConversation(task.conversationId);
    const parentConversationId = childConversation?.parentConversationId ?? null;
    if (!childConversation || !parentConversationId) {
      return;
    }

    params.store.appendMessage({
      conversationId: parentConversationId,
      role: "assistant",
      content: [
        `[Sub-agent complete: ${childConversation.title}]`,
        "",
        assistantText.trim(),
      ].join("\n"),
    });
  }

  async function startTaskFlow(flowId: string) {
    const flow = params.store.getTaskFlow?.(flowId);
    if (!flow || !params.store.listTaskFlowSteps || !params.store.transitionTaskFlow) {
      return flow;
    }

    const existingRunningTask = params
      .store
      .listTasks(flow.agentId)
      .some((task) => task.taskFlowId === flow.id && (task.status === "queued" || task.status === "running"));
    if (existingRunningTask) {
      return flow;
    }

    const steps = params.store.listTaskFlowSteps(flow.id);
    const completedStepKeys = new Set(
      steps.filter((step) => step.status === "completed").map((step) => step.stepKey),
    );
    const nextStep =
      steps.find(
        (step) =>
          step.status === "queued" &&
          (!step.dependencyStepKey || completedStepKeys.has(step.dependencyStepKey)),
      ) ?? null;

    if (!nextStep) {
      const allCompleted = steps.length > 0 && steps.every((step) => step.status === "completed");
      if (allCompleted) {
        params.store.transitionTaskFlow({
          flowId,
          status: "completed",
          completedAt: Date.now(),
        });
      }
      return params.store.getTaskFlow?.(flowId) ?? null;
    }

    const task = await enqueueDetachedTask({
      agentId: flow.agentId,
      conversationId: flow.conversationId,
      title: nextStep.title,
      prompt: nextStep.prompt,
      providerKind:
        params.store.getConversation?.(flow.conversationId)?.providerKind ?? "openai",
      model: params.store.getConversation?.(flow.conversationId)?.model ?? "gpt-5.4",
      reasoningLevel:
        params.store.getConversation?.(flow.conversationId)?.reasoningLevel ?? "medium",
      taskKind: "flow_step",
      taskFlowId: flow.id,
      flowStepKey: nextStep.stepKey,
      originRunId: flow.originRunId,
      startImmediately: false,
    });
    params.store.transitionTaskFlowStep?.({
      stepId: nextStep.id,
      taskId: task.id,
      status: "running",
    });
    params.store.transitionTaskFlow({
      flowId,
      status: "running",
    });
    void runTask(task.id);
    return params.store.getTaskFlow?.(flowId) ?? null;
  }

  async function cancelTaskFlow(flowId: string) {
    const flow = params.store.getTaskFlow?.(flowId);
    if (!flow) {
      throw new Error("Task flow not found.");
    }
    const flowTasks = params.store
      .listTasks(flow.agentId)
      .filter(
        (task) =>
          task.taskFlowId === flowId && (task.status === "queued" || task.status === "running"),
      );
    for (const task of flowTasks) {
      await cancelTask(task.id);
    }
    params.store.transitionTaskFlow?.({
      flowId,
      status: "cancelled",
      completedAt: Date.now(),
    });
    for (const step of params.store.listTaskFlowSteps?.(flowId) ?? []) {
      if (step.status === "queued" || step.status === "running") {
        params.store.transitionTaskFlowStep?.({
          stepId: step.id,
          status: "cancelled",
          completedAt: Date.now(),
        });
      }
    }
    return params.store.getTaskFlow?.(flowId) ?? null;
  }

  async function runTask(taskId: string) {
    const task = params.store.getTask(taskId);
    if (!task || task.status !== "queued" || runningControllers.has(taskId)) {
      return params.store.getTask(taskId);
    }

    registerAgentId(task.agentId);

    const controller = new AbortController();
    runningControllers.set(taskId, controller);
    const taskKind = task.taskKind ?? "detached";
    const heartbeatLog = getHeartbeatLogForTask(task);
    params.store.transitionTask({
      taskId,
      status: "running",
      eventType: "running",
      payload: {
        message: `Task started (${taskKind}).`,
      },
    });
    if (heartbeatLog && params.store.transitionHeartbeatLog) {
      params.store.transitionHeartbeatLog({
        id: heartbeatLog.id,
        status: "running",
        summary: "Heartbeat task is running.",
        startedAt: Date.now(),
      });
    }

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
        isHeartbeatRun: taskKind === "heartbeat",
        currentTaskId: task.id,
        nestingDepth: task.nestingDepth ?? 0,
      });

      const message = params.store.appendMessage({
        conversationId: task.conversationId,
        role: "assistant",
        content: [taskCompletionPrefix(taskKind), "", result.assistantText.trim()].join("\n"),
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
      announceSubagentCompletion(task, result.assistantText);
      transitionFlowForTask(task, "completed", result.assistantText);
      if (heartbeatLog && params.store.transitionHeartbeatLog) {
        params.store.transitionHeartbeatLog({
          id: heartbeatLog.id,
          status: "completed",
          summary: "Heartbeat task completed.",
          completedAt: Date.now(),
        });
      }
    } catch (error) {
      const status: TaskStatus = controller.signal.aborted
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
      transitionFlowForTask(
        task,
        status,
        error instanceof Error ? error.message : "Task failed.",
      );
      if (heartbeatLog && params.store.transitionHeartbeatLog) {
        params.store.transitionHeartbeatLog({
          id: heartbeatLog.id,
          status: status === "cancelled" ? "cancelled" : "failed",
          summary: status === "cancelled" ? "Heartbeat task cancelled." : "Heartbeat task failed.",
          errorText: error instanceof Error ? error.message : "Task failed.",
          completedAt: Date.now(),
        });
      }
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
    taskKind?: TaskKind;
    parentTaskId?: string | null;
    nestingDepth?: number;
    scheduledFor?: number | null;
    startImmediately?: boolean;
    taskFlowId?: string | null;
    flowStepKey?: string | null;
    originRunId?: string | null;
  }) {
    registerAgentId(input.agentId);
    const taskKind = input.taskKind ?? "detached";
    const task = params.store.createTask({
      agentId: input.agentId,
      conversationId: input.conversationId,
      title: input.title ?? (input.prompt.trim().slice(0, 60) || "\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5"),
      prompt: input.prompt,
      providerKind: input.providerKind,
      model: input.model,
      reasoningLevel: input.reasoningLevel,
      taskKind,
      parentTaskId: input.parentTaskId ?? null,
      nestingDepth: input.nestingDepth ?? 0,
      scheduledFor: input.scheduledFor ?? null,
      taskFlowId: input.taskFlowId ?? null,
      flowStepKey: input.flowStepKey ?? null,
      originRunId: input.originRunId ?? null,
    });

    const startImmediately =
      input.startImmediately ?? (taskKind === "detached" || taskKind === "continuation");
    if (startImmediately && !task.scheduledFor) {
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
    transitionFlowForTask(task, "cancelled", "Task cancelled before start.");
    return params.store.getTask(taskId);
  }

  async function tick() {
    if (!schedulerEnabled || schedulerBusy) {
      return;
    }

    schedulerBusy = true;
    try {
      const now = Date.now();
      const agentIds = new Set<string>([
        ...knownAgentIds,
        ...(params.store.listAgents?.().map((agent) => agent.id) ?? []),
      ]);

      if (params.getHeartbeatState && params.scheduleHeartbeatRun) {
        for (const agentId of agentIds) {
          const activeHeartbeat = params.store
            .listTasks(agentId)
            .some(
              (task) =>
                (task.taskKind ?? "detached") === "heartbeat" &&
                (task.status === "queued" || task.status === "running"),
            );
          if (activeHeartbeat) {
            continue;
          }

          const heartbeat = params.getHeartbeatState(agentId);
          if (!heartbeat || heartbeat.parseError || !heartbeat.enabled) {
            continue;
          }

          const lastRunTimestamp = heartbeat.lastRun ? Date.parse(heartbeat.lastRun) : Number.NaN;
          const nextDueAt = Number.isNaN(lastRunTimestamp)
            ? 0
            : lastRunTimestamp + heartbeat.intervalMinutes * 60_000;
          if (nextDueAt <= now) {
            await params.scheduleHeartbeatRun({
              agentId,
              triggerSource: "scheduler",
            });
          }
        }
      }

      if (params.store.listTaskFlows) {
        for (const agentId of agentIds) {
          for (const flow of params.store
            .listTaskFlows(agentId)
            .filter((item) => item.status === "queued" || item.status === "running")) {
            await startTaskFlow(flow.id);
          }
        }
      }

      const dueTasks = [...agentIds]
        .flatMap((agentId) => params.store.listTasks(agentId))
        .filter((task) => {
          const taskKind = task.taskKind ?? "detached";
          return (
            task.status === "queued" &&
            !runningControllers.has(task.id) &&
            (taskKind === "heartbeat" || task.scheduledFor == null || task.scheduledFor <= now)
          );
        })
        .sort((left, right) => {
          const leftDue = dueTimestamp(left);
          const rightDue = dueTimestamp(right);
          if (leftDue !== rightDue) {
            return leftDue - rightDue;
          }
          return left.createdAt - right.createdAt;
        });

      for (const task of dueTasks) {
        await runTask(task.id);
      }
    } finally {
      schedulerBusy = false;
    }
  }

  const interval = schedulerEnabled
    ? setInterval(() => {
        void tick();
      }, pollIntervalMs)
    : null;
  if (interval && typeof interval.unref === "function") {
    interval.unref();
  }
  if (schedulerEnabled) {
    void tick();
  }

  return {
    enqueueDetachedTask,
    runTask,
    cancelTask,
    startTaskFlow,
    cancelTaskFlow,
    tick,
    getRunningTaskIds: () => [...runningControllers.keys()],
    dispose() {
      if (interval) {
        clearInterval(interval);
      }
      for (const controller of runningControllers.values()) {
        controller.abort(createAbortError("Task manager disposed."));
      }
      runningControllers.clear();
    },
  };
}
