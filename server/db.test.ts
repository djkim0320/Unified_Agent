import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
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

  it("records schema migrations and configures SQLite pragmas", () => {
    const migrations = store.rawDb
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version ASC")
      .all() as Array<{ version: number; name: string }>;

    expect(migrations.map((migration) => migration.version)).toEqual(
      expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    );
    expect(store.rawDb.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(String(store.rawDb.pragma("journal_mode", { simple: true })).toLowerCase()).toBe("wal");
  });

  it("upgrades an existing partial conversation schema without deleting data", () => {
    store.rawDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const db = new Database(path.join(dataDir, "chat.sqlite"));
    const now = Date.now();
    db.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider_kind TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO conversations (id, title, provider_kind, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("legacy-conversation", "legacy", "openai", "gpt-5.4", now, now);
    db.close();

    store = createStore(dataDir);
    expect(store.getConversation("legacy-conversation")).toEqual(
      expect.objectContaining({
        id: "legacy-conversation",
        agentId: "default-agent",
        reasoningLevel: "medium",
      }),
    );
    expect(
      store.rawDb
        .prepare("SELECT COUNT(*) as count FROM schema_migrations")
        .get() as { count: number },
    ).toEqual(expect.objectContaining({ count: expect.any(Number) }));
  });

  it("backfills task flow step positions in legacy created-at order", () => {
    store.rawDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const db = new Database(path.join(dataDir, "chat.sqlite"));
    const now = Date.now();
    db.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        default_provider_kind TEXT NOT NULL,
        default_model TEXT NOT NULL,
        default_reasoning_level TEXT NOT NULL DEFAULT 'medium',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        channel_kind TEXT NOT NULL DEFAULT 'webchat',
        session_kind TEXT NOT NULL DEFAULT 'primary',
        parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        owner_run_id TEXT,
        title TEXT NOT NULL,
        provider_kind TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_level TEXT NOT NULL DEFAULT 'medium',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE task_flows (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        origin_run_id TEXT,
        trigger_source TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        result_summary TEXT,
        error_text TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE TABLE task_flow_steps (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL REFERENCES task_flows(id) ON DELETE CASCADE,
        task_id TEXT,
        step_key TEXT NOT NULL,
        dependency_step_key TEXT,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `);
    db.prepare(
      `INSERT INTO agents (id, name, description, default_provider_kind, default_model, default_reasoning_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("default-agent", "Default", null, "openai", "gpt-5.4", "medium", now, now);
    db.prepare(
      `INSERT INTO conversations (id, agent_id, title, provider_kind, model, reasoning_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("conversation-1", "default-agent", "Legacy flow", "openai", "gpt-5.4", "medium", now, now);
    db.prepare(
      `INSERT INTO task_flows (id, agent_id, conversation_id, origin_run_id, trigger_source, title, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("flow-1", "default-agent", "conversation-1", null, "manual", "Legacy", "queued", now, now);
    const insertStep = db.prepare(
      `INSERT INTO task_flow_steps (id, flow_id, task_id, step_key, dependency_step_key, title, prompt, status, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertStep.run("step-late", "flow-1", null, "late", null, "Late", "Late.", "queued", now + 30, now + 30, null);
    insertStep.run("step-early", "flow-1", null, "early", null, "Early", "Early.", "queued", now + 10, now + 10, null);
    insertStep.run("step-middle", "flow-1", null, "middle", null, "Middle", "Middle.", "queued", now + 20, now + 20, null);
    db.close();

    store = createStore(dataDir);
    expect(store.listTaskFlowSteps("flow-1").map((step) => [step.stepKey, step.position])).toEqual([
      ["early", 0],
      ["middle", 1],
      ["late", 2],
    ]);
  });

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

  it("can reopen an existing store without re-creating workspace tables", () => {
    const conversation = createConversation("restart-safe");
    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "hello again",
    });
    store.appendWorkspaceRunEvent({
      runId: run.id,
      eventType: "status",
      payload: { message: "still here" },
    });

    store.rawDb.close();

    const reopened = createStore(dataDir);
    try {
      expect(reopened.getConversation(conversation.id)).toEqual(expect.objectContaining({ id: conversation.id }));
      expect(reopened.getWorkspaceRun(run.id)).toEqual(expect.objectContaining({ id: run.id }));
      expect(reopened.listWorkspaceRunEvents(conversation.id, run.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "status",
          }),
        ]),
      );
      store = reopened;
    } catch (error) {
      reopened.rawDb.close();
      throw error;
    }
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
      position: 0,
      title: "Inspect repo",
      prompt: "Inspect the repo.",
    });
    const secondStep = store.createTaskFlowStep({
      flowId: flow.id,
      stepKey: "implement",
      dependencyStepKey: "inspect",
      position: 1,
      title: "Implement fix",
      prompt: "Implement the fix.",
    });
    const emptyDraftFlow = store.createTaskFlow({
      agentId: agent.id,
      conversationId: parentConversation.id,
      title: "Empty draft",
      triggerSource: "manual",
    });
    expect(store.listTaskFlowSteps(emptyDraftFlow.id)).toEqual([]);
    expect(store.replaceTaskFlowSteps(emptyDraftFlow.id, [], "Renamed empty draft")).toEqual([]);
    expect(store.getTaskFlow(emptyDraftFlow.id)).toEqual(
      expect.objectContaining({
        id: emptyDraftFlow.id,
        title: "Renamed empty draft",
        status: "queued",
      }),
    );
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
          position: 0,
          status: "completed",
        }),
        expect.objectContaining({
          id: secondStep.id,
          position: 1,
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
