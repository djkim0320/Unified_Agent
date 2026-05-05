import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskManager } from "./task-manager.js";
import { EngineRunError } from "./agent-engine.js";
import type { ProviderKind, ReasoningLevel, TaskRecord, TaskStatus } from "../types.js";

function createTaskStore() {
  const tasks = new Map<string, TaskRecord>();
  const flows = new Map<string, import("../types.js").TaskFlowRecord>();
  const flowSteps = new Map<string, import("../types.js").TaskFlowStepRecord>();
  const conversations = new Map<
    string,
    import("../types.js").ConversationRecord
  >();
  const agents = [{ id: "agent-1" }];
  const messages: Array<{ conversationId: string; role: "assistant"; content: string }> = [];
  const taskEvents: Array<{ taskId: string; eventType: string; payload: Record<string, unknown> }> = [];
  let sequence = 0;
  let flowSequence = 0;
  let flowStepSequence = 0;

  function cloneTask(task: TaskRecord) {
    return { ...task };
  }

  return {
    tasks,
    flows,
    flowSteps,
    conversations,
    agents,
    messages,
    taskEvents,
    store: {
      createTask(input: {
        agentId: string;
        conversationId: string;
        title: string;
        prompt: string;
        providerKind: ProviderKind;
        model: string;
        reasoningLevel: ReasoningLevel;
        taskKind?: TaskRecord["taskKind"];
        parentTaskId?: string | null;
        nestingDepth?: number;
        scheduledFor?: number | null;
        taskFlowId?: string | null;
        flowStepKey?: string | null;
        originRunId?: string | null;
        automationRuleId?: string | null;
      }) {
        const timestamp = Date.now();
        const id = `task-${++sequence}`;
        const task: TaskRecord = {
          id,
          agentId: input.agentId,
          conversationId: input.conversationId,
          runId: null,
          taskKind: input.taskKind ?? "detached",
          taskFlowId: input.taskFlowId ?? null,
          flowStepKey: input.flowStepKey ?? null,
          originRunId: input.originRunId ?? null,
          automationRuleId: input.automationRuleId ?? null,
          parentTaskId: input.parentTaskId ?? null,
          nestingDepth: input.nestingDepth ?? 0,
          title: input.title,
          prompt: input.prompt,
          providerKind: input.providerKind,
          model: input.model,
          reasoningLevel: input.reasoningLevel,
          status: "queued",
          resultText: null,
          createdAt: timestamp,
          startedAt: null,
          completedAt: null,
          scheduledFor: input.scheduledFor ?? null,
          updatedAt: timestamp,
        };
        tasks.set(id, task);
        return cloneTask(task);
      },
      getTask(taskId: string) {
        const task = tasks.get(taskId);
        return task ? cloneTask(task) : null;
      },
      listTasks(agentId: string) {
        return [...tasks.values()]
          .filter((task) => task.agentId === agentId)
          .map(cloneTask)
          .sort((left, right) => left.createdAt - right.createdAt);
      },
      listAgents() {
        return agents;
      },
      getConversation(conversationId: string) {
        return conversations.get(conversationId) ?? null;
      },
      saveConversation(input: {
        id?: string;
        agentId: string;
        title: string;
        providerKind: ProviderKind;
        model: string;
        reasoningLevel: ReasoningLevel;
        sessionKind?: import("../types.js").ConversationRecord["sessionKind"];
        parentConversationId?: string | null;
        ownerRunId?: string | null;
      }) {
        const id = input.id ?? `conversation-${conversations.size + 1}`;
        const now = Date.now();
        const conversation: import("../types.js").ConversationRecord = {
          id,
          agentId: input.agentId,
          channelKind: "webchat",
          sessionKind: input.sessionKind ?? "primary",
          parentConversationId: input.parentConversationId ?? null,
          ownerRunId: input.ownerRunId ?? null,
          title: input.title,
          providerKind: input.providerKind,
          model: input.model,
          reasoningLevel: input.reasoningLevel,
          createdAt: now,
          updatedAt: now,
        };
        conversations.set(id, conversation);
        return conversation;
      },
      transitionTask(input: {
        taskId: string;
        status: TaskStatus;
        eventType: string;
        payload?: Record<string, unknown>;
        runId?: string | null;
        resultText?: string | null;
      }) {
        const task = tasks.get(input.taskId);
        if (!task) {
          return { changed: false, finalized: false, task: null };
        }
        if (task.status !== "queued" && task.status !== "running") {
          return { changed: false, finalized: false, task: cloneTask(task) };
        }

        task.status = input.status;
        task.runId = input.runId ?? task.runId;
        task.resultText = input.resultText ?? task.resultText;
        task.updatedAt = Date.now();
        if (input.status === "running") {
          task.startedAt = task.startedAt ?? task.updatedAt;
        }
        if (
          input.status === "completed" ||
          input.status === "failed" ||
          input.status === "timed_out" ||
          input.status === "cancelled"
        ) {
          task.completedAt = task.updatedAt;
        }

        taskEvents.push({
          taskId: task.id,
          eventType: input.eventType,
          payload: input.payload ?? {},
        });
        return { changed: true, finalized: true, task: cloneTask(task) };
      },
      appendTaskEvent(input: { taskId: string; eventType: string; payload: Record<string, unknown> }) {
        taskEvents.push(input);
        return { id: `event-${taskEvents.length}`, ...input, createdAt: Date.now() };
      },
      appendMessage(input: { conversationId: string; role: "assistant"; content: string }) {
        messages.push(input);
        return { id: `message-${messages.length}` };
      },
      createTaskFlow(input: {
        agentId: string;
        conversationId: string;
        title: string;
        triggerSource?: import("../types.js").TaskFlowTriggerSource;
        originRunId?: string | null;
      }) {
        const timestamp = Date.now();
        const id = `flow-${++flowSequence}`;
        const flow: import("../types.js").TaskFlowRecord = {
          id,
          agentId: input.agentId,
          conversationId: input.conversationId,
          originRunId: input.originRunId ?? null,
          triggerSource: input.triggerSource ?? "manual",
          title: input.title,
          status: "queued",
          resultSummary: null,
          errorText: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
        };
        flows.set(id, flow);
        return flow;
      },
      getTaskFlow(flowId: string) {
        return flows.get(flowId) ?? null;
      },
      listTaskFlows(agentId: string) {
        return [...flows.values()]
          .filter((flow) => flow.agentId === agentId)
          .sort((left, right) => left.createdAt - right.createdAt);
      },
      transitionTaskFlow(input: {
        flowId: string;
        status?: import("../types.js").TaskFlowStatus;
        resultSummary?: string | null;
        errorText?: string | null;
        completedAt?: number | null;
        clearResultSummary?: boolean;
        clearErrorText?: boolean;
        clearCompletedAt?: boolean;
      }) {
        const flow = flows.get(input.flowId);
        if (!flow) {
          return null;
        }
        flow.status = input.status ?? flow.status;
        flow.resultSummary = input.clearResultSummary ? null : input.resultSummary ?? flow.resultSummary;
        flow.errorText = input.clearErrorText ? null : input.errorText ?? flow.errorText;
        flow.completedAt = input.clearCompletedAt ? null : input.completedAt ?? flow.completedAt;
        flow.updatedAt = Date.now();
        return { ...flow };
      },
      createTaskFlowStep(input: {
        flowId: string;
        stepKey: string;
        dependencyStepKey?: string | null;
        position?: number;
        title: string;
        prompt: string;
      }) {
        const timestamp = Date.now();
        const id = `flow-step-${++flowStepSequence}`;
        const step: import("../types.js").TaskFlowStepRecord = {
          id,
          flowId: input.flowId,
          taskId: null,
          stepKey: input.stepKey,
          dependencyStepKey: input.dependencyStepKey ?? null,
          position: input.position ?? flowStepSequence - 1,
          title: input.title,
          prompt: input.prompt,
          status: "queued",
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
        };
        flowSteps.set(id, step);
        return step;
      },
      getTaskFlowStep(stepId: string) {
        return flowSteps.get(stepId) ?? null;
      },
      listTaskFlowSteps(flowId: string) {
        return [...flowSteps.values()]
          .filter((step) => step.flowId === flowId)
          .sort((left, right) => left.position - right.position || left.createdAt - right.createdAt);
      },
      transitionTaskFlowStep(input: {
        stepId: string;
        taskId?: string | null;
        status?: import("../types.js").TaskFlowStepStatus;
        completedAt?: number | null;
        clearTaskId?: boolean;
        clearCompletedAt?: boolean;
      }) {
        const step = flowSteps.get(input.stepId);
        if (!step) {
          return null;
        }
        step.taskId = input.clearTaskId ? null : input.taskId ?? step.taskId;
        step.status = input.status ?? step.status;
        step.completedAt = input.clearCompletedAt ? null : input.completedAt ?? step.completedAt;
        step.updatedAt = Date.now();
        return { ...step };
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createTaskManager", () => {
  it("runs scheduled tasks when they become due", async () => {
    const harness = createTaskStore();
    const executeTask = vi.fn(async () => ({
      runId: "run-1",
      assistantText: "scheduled result",
    }));
    const manager = createTaskManager({
      store: harness.store,
      executeTask,
      schedulerEnabled: true,
      pollIntervalMs: 25,
    });

    try {
      const task = await manager.enqueueDetachedTask({
        agentId: "agent-1",
        conversationId: "conversation-1",
        prompt: "Check later",
        title: "Follow up",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
        taskKind: "scheduled",
        scheduledFor: Date.now() - 1,
        startImmediately: false,
      });

      await vi.waitFor(() => {
        expect(executeTask).toHaveBeenCalledTimes(1);
      });

      const [firstCall] = executeTask.mock.calls as unknown as Array<[Record<string, unknown>]>;
      expect(firstCall[0]).toEqual(
        expect.objectContaining({
          currentTaskId: task.id,
          nestingDepth: 0,
          isHeartbeatRun: false,
        }),
      );
      expect(harness.store.getTask(task.id)?.status).toBe("completed");
      expect(harness.messages[0]?.content).toContain("scheduled result");
    } finally {
      manager.dispose();
    }
  });

  it("materializes due automation rules through the scheduled task path without duplicates", async () => {
    const harness = createTaskStore();
    const executeTask = vi.fn(async () => ({
      runId: "run-automation",
      assistantText: "automation result",
    }));
    const dueRule: import("../types.js").AutomationRuleRecord = {
      id: "rule-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      title: "Rule",
      prompt: "Do the scheduled thing.",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      enabled: true,
      intervalMinutes: 60,
      nextRunAt: Date.now() - 1,
      lastRunAt: null,
      lastTaskId: null,
      runCount: 0,
      createdAt: Date.now() - 100,
      updatedAt: Date.now() - 100,
    };
    const automationStore = {
      ...harness.store,
      listDueAutomationRules: vi.fn((timestamp: number) =>
        dueRule.enabled && dueRule.nextRunAt <= timestamp ? [dueRule] : [],
      ),
      enqueueAutomationRuleTask: vi.fn((ruleId: string, timestamp = Date.now()) => {
        const active = [...harness.tasks.values()].find(
          (task) =>
            task.automationRuleId === ruleId &&
            (task.status === "queued" || task.status === "running"),
        );
        if (active) {
          return { rule: dueRule, task: active, enqueued: false };
        }
        const task = harness.store.createTask({
          agentId: dueRule.agentId,
          conversationId: dueRule.conversationId,
          title: `[자동화] ${dueRule.title}`,
          prompt: dueRule.prompt,
          providerKind: dueRule.providerKind,
          model: dueRule.model,
          reasoningLevel: dueRule.reasoningLevel,
          taskKind: "scheduled",
          scheduledFor: timestamp,
          automationRuleId: dueRule.id,
        });
        dueRule.lastRunAt = timestamp;
        dueRule.lastTaskId = task.id;
        dueRule.nextRunAt = timestamp + dueRule.intervalMinutes * 60_000;
        dueRule.runCount += 1;
        return { rule: dueRule, task, enqueued: true };
      }),
    };
    const manager = createTaskManager({
      store: automationStore,
      executeTask,
      schedulerEnabled: true,
      pollIntervalMs: 25,
    });

    try {
      await vi.waitFor(() => {
        expect(executeTask).toHaveBeenCalledTimes(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(automationStore.enqueueAutomationRuleTask).toHaveBeenCalled();
      expect([...harness.tasks.values()].filter((task) => task.automationRuleId === dueRule.id)).toHaveLength(1);
      expect(harness.store.getTask(dueRule.lastTaskId!)?.status).toBe("completed");
    } finally {
      manager.dispose();
    }
  });

  it("does not persist a fabricated assistant message when engine output is empty", async () => {
    const harness = createTaskStore();
    const executeTask = vi.fn(async () => ({
      runId: "run-empty",
      assistantText: "",
      changedFiles: [],
    }));
    const manager = createTaskManager({
      store: harness.store,
      executeTask,
      schedulerEnabled: false,
      pollIntervalMs: 5,
    });

    try {
      const task = await manager.enqueueDetachedTask({
        agentId: "agent-1",
        conversationId: "conversation-1",
        prompt: "Run but produce no final text",
        title: "Empty result",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
        startImmediately: true,
      });

      await vi.waitFor(() => {
        expect(harness.store.getTask(task.id)?.status).toBe("completed");
      });

      expect(harness.messages).toHaveLength(0);
      expect(harness.store.getTask(task.id)?.resultText).toBeNull();
      expect(
        harness.taskEvents.find((event) => event.taskId === task.id && event.eventType === "result_delivered")?.payload,
      ).toMatchObject({
        messageId: null,
        assistantTextPresent: false,
      });
    } finally {
      manager.dispose();
    }
  });

  it("uses structured engine timeout status instead of matching error text", async () => {
    const harness = createTaskStore();
    const executeTask = vi.fn(async () => {
      throw new EngineRunError("opencode 실행 시간이 초과되었습니다.", "failed", "run-timeout", "timed_out");
    });
    const manager = createTaskManager({
      store: harness.store,
      executeTask,
      schedulerEnabled: false,
      pollIntervalMs: 5,
    });

    try {
      const task = await manager.enqueueDetachedTask({
        agentId: "agent-1",
        conversationId: "conversation-1",
        prompt: "Run until timeout",
        title: "Timeout result",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
        startImmediately: true,
      });

      await vi.waitFor(() => {
        expect(harness.store.getTask(task.id)?.status).toBe("timed_out");
      });
      expect(harness.store.getTask(task.id)?.resultText).toContain("opencode 실행 시간이 초과되었습니다.");
    } finally {
      manager.dispose();
    }
  });

  it("coordinates flow steps in order", async () => {
    const harness = createTaskStore();
    const conversation = harness.store.saveConversation({
      agentId: "agent-1",
      title: "flow session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    let releaseInspect: () => void = () => {};
    const inspectStarted = new Promise<void>((resolve) => {
      releaseInspect = resolve;
    });
    const executeTask = vi.fn(async ({ task }: { task: TaskRecord }) => {
      if (task.flowStepKey === "inspect") {
        await inspectStarted;
      }
      return {
        runId: `run-${task.id}`,
        assistantText: `completed ${task.flowStepKey ?? task.id}`,
      };
    });
    const manager = createTaskManager({
      store: harness.store,
      executeTask,
      schedulerEnabled: false,
    });

    try {
      const flow = harness.store.createTaskFlow({
        agentId: "agent-1",
        conversationId: conversation.id,
        title: "Ship patch",
      });
      harness.store.createTaskFlowStep({
        flowId: flow.id,
        stepKey: "inspect",
        title: "Inspect repo",
        prompt: "Inspect the repo and report back.",
      });
      harness.store.createTaskFlowStep({
        flowId: flow.id,
        stepKey: "implement",
        dependencyStepKey: "inspect",
        title: "Implement fix",
        prompt: "Apply the required fix.",
      });

      await manager.startTaskFlow(flow.id);
      await vi.waitFor(() => {
        expect(executeTask).toHaveBeenCalledTimes(1);
      });
      const firstTask = [...harness.tasks.values()].find((task) => task.flowStepKey === "inspect");
      expect(firstTask).toEqual(
        expect.objectContaining({
          taskKind: "flow_step",
          taskFlowId: flow.id,
          flowStepKey: "inspect",
          status: "running",
        }),
      );
      expect(harness.flows.get(flow.id)?.status).toBe("running");

      releaseInspect();
      await vi.waitFor(() => {
        expect(
          harness.store.listTaskFlowSteps(flow.id).find((step) => step.stepKey === "inspect")?.status,
        ).toBe("completed");
      });
      await manager.startTaskFlow(flow.id);
      await vi.waitFor(() => {
        expect(executeTask).toHaveBeenCalledTimes(2);
      });
      await vi.waitFor(() => {
        expect(
          harness.store.listTaskFlowSteps(flow.id).find((step) => step.stepKey === "implement")?.status,
        ).toBe("completed");
      });
      await vi.waitFor(() => {
        expect(harness.flows.get(flow.id)?.status).toBe("completed");
      });
      await vi.waitFor(() => {
        expect(manager.getRunningTaskIds()).toHaveLength(0);
      });
      const flowSteps = harness.store.listTaskFlowSteps(flow.id);
      expect(flowSteps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stepKey: "inspect",
            status: "completed",
          }),
          expect.objectContaining({
            stepKey: "implement",
            status: "completed",
          }),
        ]),
      );
    } finally {
      manager.dispose();
    }
  });

  it("recovers stale running flow steps on scheduler tick after a manager restart", async () => {
    const harness = createTaskStore();
    const conversation = harness.store.saveConversation({
      agentId: "agent-1",
      title: "restart flow session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const executeTask = vi.fn(async ({ task }: { task: TaskRecord }) => ({
      runId: `run-${task.id}`,
      assistantText: `recovered ${task.flowStepKey ?? task.id}`,
    }));
    const flow = harness.store.createTaskFlow({
      agentId: "agent-1",
      conversationId: conversation.id,
      title: "Recover after restart",
    });
    const step = harness.store.createTaskFlowStep({
      flowId: flow.id,
      stepKey: "recover",
      title: "Recover stale step",
      prompt: "Continue this long-running step after a restart.",
    });
    const staleTask = harness.store.createTask({
      agentId: "agent-1",
      conversationId: conversation.id,
      title: step.title,
      prompt: step.prompt,
      providerKind: conversation.providerKind,
      model: conversation.model,
      reasoningLevel: conversation.reasoningLevel,
      taskKind: "flow_step",
      taskFlowId: flow.id,
      flowStepKey: step.stepKey,
    });
    harness.store.transitionTask({
      taskId: staleTask.id,
      status: "running",
      eventType: "running",
      payload: { message: "Simulated task from a previous process." },
    });
    harness.store.transitionTaskFlowStep({
      stepId: step.id,
      taskId: staleTask.id,
      status: "running",
    });
    harness.store.transitionTaskFlow({
      flowId: flow.id,
      status: "running",
      clearCompletedAt: true,
    });

    const manager = createTaskManager({
      store: harness.store,
      executeTask,
      schedulerEnabled: true,
      pollIntervalMs: 5,
    });

    try {
      await manager.tick();

      await vi.waitFor(() => {
        expect(harness.store.getTask(staleTask.id)?.status).toBe("cancelled");
      });
      await vi.waitFor(() => {
        expect(executeTask).toHaveBeenCalledTimes(1);
      });
      await vi.waitFor(() => {
        expect(harness.flows.get(flow.id)?.status).toBe("completed");
      });

      const replacementTask = [...harness.tasks.values()].find(
        (task) => task.id !== staleTask.id && task.flowStepKey === step.stepKey,
      );
      expect(replacementTask).toEqual(
        expect.objectContaining({
          status: "completed",
          taskFlowId: flow.id,
          flowStepKey: step.stepKey,
        }),
      );
      expect(harness.store.getTaskFlowStep(step.id)).toEqual(
        expect.objectContaining({
          taskId: replacementTask?.id,
          status: "completed",
        }),
      );
    } finally {
      manager.dispose();
    }
  });

  it("marks a failed flow step and retries the dependency chain", async () => {
    const harness = createTaskStore();
    const conversation = harness.store.saveConversation({
      agentId: "agent-1",
      title: "retry flow session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    let implementAttempts = 0;
    const executeTask = vi.fn(async ({ task }: { task: TaskRecord }) => {
      if (task.flowStepKey === "implement" && implementAttempts++ === 0) {
        throw new Error("implementation failed");
      }
      return {
        runId: `run-${task.id}`,
        assistantText: `completed ${task.flowStepKey ?? task.id}`,
      };
    });
    const manager = createTaskManager({
      store: harness.store,
      executeTask,
      schedulerEnabled: false,
    });

    try {
      const flow = harness.store.createTaskFlow({
        agentId: "agent-1",
        conversationId: conversation.id,
        title: "Retry patch",
      });
      harness.store.createTaskFlowStep({
        flowId: flow.id,
        stepKey: "inspect",
        title: "Inspect",
        prompt: "Inspect.",
      });
      const implementStep = harness.store.createTaskFlowStep({
        flowId: flow.id,
        stepKey: "implement",
        dependencyStepKey: "inspect",
        title: "Implement",
        prompt: "Implement.",
      });

      await manager.startTaskFlow(flow.id);
      await vi.waitFor(() => {
        expect(harness.flows.get(flow.id)?.status).toBe("failed");
      });
      expect(harness.store.getTaskFlowStep(implementStep.id)?.status).toBe("failed");

      await manager.retryTaskFlowStep(flow.id, implementStep.id);
      await vi.waitFor(() => {
        expect(harness.flows.get(flow.id)?.status).toBe("completed");
      });
      expect(implementAttempts).toBe(2);
      expect(harness.store.getTaskFlowStep(implementStep.id)?.status).toBe("completed");
    } finally {
      manager.dispose();
    }
  });

  it("treats skipped steps as dependency-satisfied", async () => {
    const harness = createTaskStore();
    const conversation = harness.store.saveConversation({
      agentId: "agent-1",
      title: "skip flow session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const executeTask = vi.fn(async ({ task }: { task: TaskRecord }) => ({
      runId: `run-${task.id}`,
      assistantText: `completed ${task.flowStepKey ?? task.id}`,
    }));
    const manager = createTaskManager({
      store: harness.store,
      executeTask,
      schedulerEnabled: false,
    });

    try {
      const flow = harness.store.createTaskFlow({
        agentId: "agent-1",
        conversationId: conversation.id,
        title: "Skip patch",
      });
      const inspectStep = harness.store.createTaskFlowStep({
        flowId: flow.id,
        stepKey: "inspect",
        title: "Inspect",
        prompt: "Inspect.",
      });
      harness.store.createTaskFlowStep({
        flowId: flow.id,
        stepKey: "summarize",
        dependencyStepKey: "inspect",
        title: "Summarize",
        prompt: "Summarize.",
      });

      await manager.skipTaskFlowStep(flow.id, inspectStep.id);
      await vi.waitFor(() => {
        expect(executeTask).toHaveBeenCalledTimes(1);
      });
      await vi.waitFor(() => {
        expect(harness.flows.get(flow.id)?.status).toBe("completed");
      });
      expect(harness.store.getTaskFlowStep(inspectStep.id)?.status).toBe("skipped");
    } finally {
      manager.dispose();
    }
  });

  it("keeps skipped running steps stable after late task cancellation", async () => {
    const harness = createTaskStore();
    const conversation = harness.store.saveConversation({
      agentId: "agent-1",
      title: "skip running flow session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    let abortObserved: () => void = () => {};
    const abortSettled = new Promise<void>((resolve) => {
      abortObserved = resolve;
    });
    const executeTask = vi.fn(async ({ signal }: { task: TaskRecord; signal: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      abortObserved();
      throw new Error("cancel observed after operator skipped step");
    });
    const manager = createTaskManager({
      store: harness.store,
      executeTask,
      schedulerEnabled: false,
    });

    try {
      const flow = harness.store.createTaskFlow({
        agentId: "agent-1",
        conversationId: conversation.id,
        title: "Skip running patch",
      });
      const step = harness.store.createTaskFlowStep({
        flowId: flow.id,
        stepKey: "inspect",
        title: "Inspect",
        prompt: "Inspect.",
      });

      await manager.startTaskFlow(flow.id);
      await vi.waitFor(() => {
        expect(harness.store.getTaskFlowStep(step.id)?.status).toBe("running");
      });

      await manager.skipTaskFlowStep(flow.id, step.id);
      expect(harness.store.getTaskFlowStep(step.id)?.status).toBe("skipped");
      expect(harness.flows.get(flow.id)?.status).toBe("completed");

      await abortSettled;
      await vi.waitFor(() => {
        const task = [...harness.tasks.values()].find((entry) => entry.flowStepKey === "inspect");
        expect(task?.status).toBe("cancelled");
      });
      expect(harness.store.getTaskFlowStep(step.id)?.status).toBe("skipped");
      expect(harness.flows.get(flow.id)?.status).toBe("completed");
    } finally {
      manager.dispose();
    }
  });

  it("announces sub-agent completion back to the parent session", async () => {
    const harness = createTaskStore();
    const parentConversation = harness.store.saveConversation({
      agentId: "agent-1",
      title: "Parent session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const childConversation = harness.store.saveConversation({
      agentId: "agent-1",
      title: "Child session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      sessionKind: "subagent",
      parentConversationId: parentConversation.id,
      ownerRunId: "run-1",
    });
    const executeTask = vi.fn(async () => ({
      runId: "run-2",
      assistantText: "child result",
    }));
    const manager = createTaskManager({
      store: harness.store,
      executeTask,
      schedulerEnabled: false,
    });

    try {
      const task = harness.store.createTask({
        agentId: "agent-1",
        conversationId: childConversation.id,
        title: "Child task",
        prompt: "Investigate the repo",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
        taskKind: "subagent",
      });

      await manager.runTask(task.id);

      expect(harness.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            conversationId: parentConversation.id,
            role: "assistant",
            content: expect.stringContaining("[Sub-agent complete: Child session]"),
          }),
        ]),
      );
      expect(harness.messages[0]?.content).toContain("child result");
      expect(harness.tasks.get(task.id)?.status).toBe("completed");
    } finally {
      manager.dispose();
    }
  });

  it("passes heartbeat context through the scheduler", async () => {
    const harness = createTaskStore();
    const executeTask = vi.fn(async () => ({
      runId: "run-2",
      assistantText: "heartbeat result",
    }));
    const manager = createTaskManager({
      store: harness.store,
      executeTask,
      schedulerEnabled: true,
      pollIntervalMs: 25,
    });

    try {
      const task = await manager.enqueueDetachedTask({
        agentId: "agent-1",
        conversationId: "conversation-1",
        prompt: "Heartbeat check",
        title: "Heartbeat",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "medium",
        taskKind: "heartbeat",
        parentTaskId: null,
        nestingDepth: 1,
        startImmediately: false,
      });

      await vi.waitFor(() => {
        expect(executeTask).toHaveBeenCalledTimes(1);
      });

      const [firstCall] = executeTask.mock.calls as unknown as Array<[Record<string, unknown>]>;
      expect(firstCall[0]).toEqual(
        expect.objectContaining({
          currentTaskId: task.id,
          nestingDepth: 1,
          isHeartbeatRun: true,
        }),
      );
      expect(harness.store.getTask(task.id)?.status).toBe("completed");
    } finally {
      manager.dispose();
    }
  });
});
