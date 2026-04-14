import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskManager } from "./task-manager.js";
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
      }) {
        const flow = flows.get(input.flowId);
        if (!flow) {
          return null;
        }
        flow.status = input.status ?? flow.status;
        flow.resultSummary = input.resultSummary ?? flow.resultSummary;
        flow.errorText = input.errorText ?? flow.errorText;
        flow.completedAt = input.completedAt ?? flow.completedAt;
        flow.updatedAt = Date.now();
        return { ...flow };
      },
      createTaskFlowStep(input: {
        flowId: string;
        stepKey: string;
        dependencyStepKey?: string | null;
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
          .sort((left, right) => left.createdAt - right.createdAt);
      },
      transitionTaskFlowStep(input: {
        stepId: string;
        taskId?: string | null;
        status?: import("../types.js").TaskFlowStepStatus;
        completedAt?: number | null;
      }) {
        const step = flowSteps.get(input.stepId);
        if (!step) {
          return null;
        }
        step.taskId = input.taskId ?? step.taskId;
        step.status = input.status ?? step.status;
        step.completedAt = input.completedAt ?? step.completedAt;
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
