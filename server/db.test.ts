import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "./db.js";

describe("workspace run persistence consistency", () => {
  let dataDir: string;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-db-"));
    store = createStore(dataDir);
  });

  afterEach(() => {
    store.rawDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function createConversation(title: string) {
    return store.saveConversation({
      title,
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
  }

  it("does not return run events for the wrong conversation", () => {
    const first = createConversation("first");
    const second = createConversation("second");
    const run = store.createWorkspaceRun({
      conversationId: first.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "hello",
    });
    store.appendWorkspaceRunEvent({
      runId: run.id,
      eventType: "tool_result",
      payload: { ok: true },
    });

    expect(store.listWorkspaceRunEvents(first.id, run.id).length).toBeGreaterThan(0);
    expect(store.listWorkspaceRunEvents(second.id, run.id)).toEqual([]);
    expect(store.getWorkspaceRunForConversation(second.id, run.id)).toBeNull();
  });

  it("finalizes terminal run state and terminal event idempotently", () => {
    const conversation = createConversation("run");
    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "hello",
    });

    const first = store.finalizeWorkspaceRun(run.id, "failed", "run_failed", { error: "boom" });
    const second = store.finalizeWorkspaceRun(run.id, "completed", "run_complete", {});

    expect(first.finalized).toBe(true);
    expect(second.finalized).toBe(false);
    expect(store.getWorkspaceRun(run.id)?.status).toBe("failed");
    expect(
      store.listWorkspaceRunEvents(conversation.id, run.id).filter((event) => event.eventType === "run_failed"),
    ).toHaveLength(1);
    expect(
      store.listWorkspaceRunEvents(conversation.id, run.id).filter((event) => event.eventType === "run_complete"),
    ).toHaveLength(0);
  });

  it("cascades messages, runs, and run events when deleting a conversation", () => {
    const conversation = createConversation("delete me");
    store.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "hello",
    });
    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "hello",
    });
    store.appendWorkspaceRunEvent({
      runId: run.id,
      eventType: "tool_result",
      payload: { ok: true },
    });

    expect(store.deleteConversation(conversation.id)).toBe(true);

    expect(store.listMessages(conversation.id)).toEqual([]);
    expect(store.listWorkspaceRuns(conversation.id)).toEqual([]);
    const orphanEvents = store.rawDb
      .prepare("SELECT count(*) AS count FROM workspace_run_events")
      .get() as { count: number };
    expect(orphanEvents.count).toBe(0);
  });

  it("creates a default agent and scopes conversations by agent", () => {
    const defaultAgent = store.getAgent("default-agent");
    expect(defaultAgent).toEqual(
      expect.objectContaining({
        id: "default-agent",
        name: "\uAE30\uBCF8 \uC5D0\uC774\uC804\uD2B8",
      }),
    );

    const secondAgent = store.saveAgent({
      name: "Research Agent",
      providerKind: "anthropic",
      model: "claude-sonnet-4-6",
      reasoningLevel: "medium",
    });
    const firstConversation = createConversation("default session");
    const secondConversation = store.saveConversation({
      agentId: secondAgent.id,
      title: "research session",
      providerKind: "anthropic",
      model: "claude-sonnet-4-6",
      reasoningLevel: "medium",
    });

    expect(firstConversation.agentId).toBe("default-agent");
    expect(secondConversation.agentId).toBe(secondAgent.id);
    expect(store.listConversations("default-agent").map((conversation) => conversation.id)).toEqual([
      firstConversation.id,
    ]);
    expect(store.listConversations(secondAgent.id).map((conversation) => conversation.id)).toEqual([
      secondConversation.id,
    ]);
  });

  it("keeps task events scoped to the owning agent", () => {
    const owner = store.saveAgent({
      name: "Owner Agent",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });
    const other = store.saveAgent({
      name: "Other Agent",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });
    const conversation = store.saveConversation({
      agentId: owner.id,
      title: "task session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });

    const task = store.createTask({
      agentId: owner.id,
      conversationId: conversation.id,
      title: "Follow-up",
      prompt: "Do background work",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });
    const transition = store.transitionTask({
      taskId: task.id,
      status: "running",
      eventType: "running",
      payload: { ok: true },
    });

    expect(transition.changed).toBe(true);
    expect(store.listTaskEvents(owner.id, task.id).length).toBeGreaterThan(1);
    expect(store.listTaskEvents(other.id, task.id)).toEqual([]);
    expect(store.getTaskForAgent(other.id, task.id)).toBeNull();
  });

  it("stores task metadata and heartbeat logs", () => {
    const agent = store.saveAgent({
      name: "Heartbeat Agent",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });
    const conversation = store.saveConversation({
      agentId: agent.id,
      title: "heartbeat session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });

    const parentTask = store.createTask({
      agentId: agent.id,
      conversationId: conversation.id,
      title: "Parent task",
      prompt: "Parent prompt",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      taskKind: "scheduled",
      scheduledFor: Date.now(),
    });
    const childTask = store.createTask({
      agentId: agent.id,
      conversationId: conversation.id,
      title: "Child task",
      prompt: "Child prompt",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      parentTaskId: parentTask.id,
    });

    expect(parentTask.taskKind).toBe("scheduled");
    expect(parentTask.parentTaskId).toBeNull();
    expect(childTask.taskKind).toBe("continuation");
    expect(childTask.parentTaskId).toBe(parentTask.id);
    expect(childTask.nestingDepth).toBe(parentTask.nestingDepth + 1);

    const log = store.createHeartbeatLog({
      agentId: agent.id,
      conversationId: conversation.id,
      triggerSource: "manual",
      summary: "Queued heartbeat",
    });
    const updatedLog = store.transitionHeartbeatLog({
      id: log.id,
      taskId: childTask.id,
      status: "running",
      summary: "Heartbeat started",
    });

    expect(updatedLog).not.toBeNull();
    expect(updatedLog).toEqual(
      expect.objectContaining({
        agentId: agent.id,
        conversationId: conversation.id,
        taskId: childTask.id,
        triggerSource: "manual",
        status: "running",
        summary: "Heartbeat started",
      }),
    );
    expect(store.listHeartbeatLogs(agent.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: log.id,
          taskId: childTask.id,
        }),
      ]),
    );
    expect(store.listHeartbeatLogs("default-agent")).toEqual([]);
  });

  it("persists sub-agent sessions and task flow records", () => {
    const agent = store.saveAgent({
      name: "Flow Agent",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const parentConversation = store.saveConversation({
      agentId: agent.id,
      title: "parent session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const childConversation = store.saveConversation({
      agentId: agent.id,
      title: "child session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      sessionKind: "subagent",
      parentConversationId: parentConversation.id,
      ownerRunId: null,
    });
    const originRun = store.createWorkspaceRun({
      conversationId: parentConversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "start the flow",
    });

    expect(
      store.listConversations(agent.id, {
        sessionKind: "subagent",
        parentConversationId: parentConversation.id,
      }).map((conversation) => conversation.id),
    ).toEqual([childConversation.id]);

    const flow = store.createTaskFlow({
      agentId: agent.id,
      conversationId: parentConversation.id,
      title: "Ship patch",
      triggerSource: "manual",
      originRunId: originRun.id,
    });
    const firstStep = store.createTaskFlowStep({
      flowId: flow.id,
      stepKey: "inspect",
      title: "Inspect repo",
      prompt: "Inspect the repo.",
    });
    const secondStep = store.createTaskFlowStep({
      flowId: flow.id,
      stepKey: "implement",
      dependencyStepKey: "inspect",
      title: "Implement fix",
      prompt: "Implement the fix.",
    });
    const flowTask = store.createTask({
      agentId: agent.id,
      conversationId: parentConversation.id,
      title: firstStep.title,
      prompt: firstStep.prompt,
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      taskKind: "flow_step",
      taskFlowId: flow.id,
      flowStepKey: firstStep.stepKey,
      originRunId: originRun.id,
    });

    const runningFlow = store.transitionTaskFlow({
      flowId: flow.id,
      status: "running",
    });
    const completedStep = store.transitionTaskFlowStep({
      stepId: firstStep.id,
      taskId: flowTask.id,
      status: "completed",
      completedAt: Date.now(),
    });
    const completedFlow = store.transitionTaskFlow({
      flowId: flow.id,
      status: "completed",
      resultSummary: "done",
      completedAt: Date.now(),
    });

    expect(runningFlow).toEqual(expect.objectContaining({ status: "running" }));
    expect(completedStep).toEqual(
      expect.objectContaining({
        id: firstStep.id,
        taskId: flowTask.id,
        status: "completed",
      }),
    );
    expect(completedFlow).toEqual(
      expect.objectContaining({
        id: flow.id,
        status: "completed",
        resultSummary: "done",
      }),
    );
    expect(store.listTaskFlowSteps(flow.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstStep.id,
          status: "completed",
        }),
        expect.objectContaining({
          id: secondStep.id,
          status: "queued",
        }),
      ]),
    );
    expect(store.getTask(flowTask.id)).toEqual(
      expect.objectContaining({
        taskKind: "flow_step",
        taskFlowId: flow.id,
        flowStepKey: firstStep.stepKey,
        originRunId: originRun.id,
      }),
    );
  });

  it("stores workspace run checkpoints and parent run links", () => {
    const conversation = store.saveConversation({
      title: "resume session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const parentTask = store.createTask({
      agentId: conversation.agentId,
      conversationId: conversation.id,
      title: "Parent task",
      prompt: "Parent prompt",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    const parentRun = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "parent run",
    });

    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      taskId: parentTask.id,
      parentRunId: parentRun.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "finish the job",
      phase: "planning",
      checkpoint: {
        stepIndex: 2,
        maxSteps: 4,
        userMessage: "finish the job",
        toolHistory: [{ tool: "list_tree", result: "ok" }],
        changedFiles: ["notes.txt"],
        runMode: "foreground",
        lastToolName: "list_tree",
      },
      resumeToken: "resume-token",
    });

    const patched = store.patchWorkspaceRun?.({
      runId: run.id,
      phase: "tool_execution",
      checkpoint: {
        stepIndex: 3,
        maxSteps: 4,
        userMessage: "finish the job",
        toolHistory: [{ tool: "list_tree", result: "ok" }],
        changedFiles: ["notes.txt", "summary.md"],
        runMode: "foreground",
        lastToolName: "write_file",
      },
      resumeToken: "resume-token-2",
    });

    expect(run).toEqual(
      expect.objectContaining({
        taskId: parentTask.id,
        parentRunId: parentRun.id,
        phase: "planning",
        resumeToken: "resume-token",
        checkpoint: expect.objectContaining({
          stepIndex: 2,
          lastToolName: "list_tree",
        }),
      }),
    );
    expect(patched).toEqual(
      expect.objectContaining({
        phase: "tool_execution",
        checkpoint: expect.objectContaining({
          stepIndex: 3,
          lastToolName: "write_file",
        }),
      }),
    );
    expect(store.getWorkspaceRun(run.id)).toEqual(
      expect.objectContaining({
        phase: "tool_execution",
        resumeToken: "resume-token-2",
        checkpoint: expect.objectContaining({
          changedFiles: ["notes.txt", "summary.md"],
        }),
      }),
    );
  });
});
