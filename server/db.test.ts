import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "./db.js";

describe("workspace run persistence consistency", () => {
  let dataDir: string;
  let store: ReturnType<typeof createStore>;
  let originalMaxRunEvents: string | undefined;
  let originalMaxTaskEvents: string | undefined;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-db-"));
    originalMaxRunEvents = process.env.AETHEROPS_MAX_RUN_EVENTS_PER_RUN;
    originalMaxTaskEvents = process.env.AETHEROPS_MAX_TASK_EVENTS_PER_TASK;
    store = createStore(dataDir);
  });

  afterEach(() => {
    store.rawDb.close();
    if (originalMaxRunEvents === undefined) {
      delete process.env.AETHEROPS_MAX_RUN_EVENTS_PER_RUN;
    } else {
      process.env.AETHEROPS_MAX_RUN_EVENTS_PER_RUN = originalMaxRunEvents;
    }
    if (originalMaxTaskEvents === undefined) {
      delete process.env.AETHEROPS_MAX_TASK_EVENTS_PER_TASK;
    } else {
      process.env.AETHEROPS_MAX_TASK_EVENTS_PER_TASK = originalMaxTaskEvents;
    }
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
        expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17]),
      );
    expect(store.rawDb.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(String(store.rawDb.pragma("journal_mode", { simple: true })).toLowerCase()).toBe("wal");
  });

  it("persists automation rules and materializes due rules as scheduled tasks once", () => {
    const conversation = createConversation("automation");
    const rule = store.createAutomationRule({
      agentId: "default-agent",
      conversationId: conversation.id,
      title: "Daily cockpit sweep",
      prompt: "Summarize changed files and next actions.",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      enabled: true,
      intervalMinutes: 15,
      nextRunAt: 100,
    });

    expect(store.listAutomationRules("default-agent")).toEqual([
      expect.objectContaining({
        id: rule.id,
        title: "Daily cockpit sweep",
        enabled: true,
        providerKind: "openai",
        reasoningLevel: "high",
      }),
    ]);

    const updated = store.updateAutomationRule({
      agentId: "default-agent",
      ruleId: rule.id,
      intervalMinutes: 30,
      nextRunAt: 200,
    });
    expect(updated).toEqual(expect.objectContaining({ intervalMinutes: 30, nextRunAt: 200 }));
    expect(store.listDueAutomationRules(199)).toEqual([]);
    expect(store.listDueAutomationRules(200)).toHaveLength(1);

    const first = store.enqueueAutomationRuleTask(rule.id, 200);
    expect(first?.enqueued).toBe(true);
    expect(first?.task).toEqual(
      expect.objectContaining({
        automationRuleId: rule.id,
        taskKind: "scheduled",
        status: "queued",
        scheduledFor: 200,
      }),
    );
    expect(store.getAutomationRule(rule.id)).toEqual(
      expect.objectContaining({
        lastTaskId: first?.task.id,
        lastRunAt: 200,
        runCount: 1,
        nextRunAt: 200 + 30 * 60_000,
      }),
    );

    const second = store.enqueueAutomationRuleTask(rule.id, 200, true);
    expect(second?.enqueued).toBe(false);
    expect(second?.task.id).toBe(first?.task.id);

    expect(store.deleteAutomationRule("default-agent", rule.id)).toBe(true);
    expect(store.getTask(first!.task.id)).toEqual(
      expect.objectContaining({
        id: first!.task.id,
        automationRuleId: null,
      }),
    );
  });

  it("does not bootstrap removed memory/plugin stores for fresh databases", () => {
    const rows = store.rawDb
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE name = 'plugins' OR name = 'memory_index' OR name LIKE 'memory_index_%'
         ORDER BY name ASC`,
      )
      .all() as Array<{ name: string }>;

    expect(rows).toEqual([]);
  });

  it("persists project memory metadata, artifact snapshots, and custom skill templates", () => {
    const conversation = createConversation("hardening coverage");
    const summary = store.saveSessionSummary({
      conversationId: conversation.id,
      summary: "Current project summary",
      decisions: ["Keep opencode as the only execution engine"],
      openQuestions: ["Which validation flow should run next?"],
      nextActions: ["Review the latest run report"],
      metadata: {
        currentGoal: "Polish the operations cockpit",
        completedWork: ["Added snapshot-backed artifacts"],
        importantArtifacts: ["report.md"],
        lastVerification: "pnpm test",
      },
    });

    expect(store.getSessionSummary(conversation.id)).toEqual(
      expect.objectContaining({
        conversationId: conversation.id,
        summary: summary.summary,
        decisions: ["Keep opencode as the only execution engine"],
        metadata: expect.objectContaining({
          currentGoal: "Polish the operations cockpit",
          importantArtifacts: ["report.md"],
        }),
      }),
    );

    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "Update a file",
    });
    const artifacts = store.createArtifactsForRun({
      agentId: conversation.agentId,
      conversationId: conversation.id,
      runId: run.id,
      changedFiles: ["src/result.ts"],
      snapshots: [
        {
          path: "src/result.ts",
          beforeContent: "export const value = 'before';\n",
          afterContent: "export const value = 'after';\n",
          beforeHash: "before-hash",
          afterHash: "after-hash",
          sizeBytes: 29,
          encoding: "utf8",
          binary: false,
          truncated: false,
        },
      ],
    });

    expect(artifacts).toHaveLength(1);
    expect(store.getArtifactVersion(artifacts[0].id)).toEqual(
      expect.objectContaining({
        path: "src/result.ts",
        beforeContent: "export const value = 'before';\n",
        afterContent: "export const value = 'after';\n",
        binary: false,
        truncated: false,
      }),
    );

    const skill = store.saveCustomSkillTemplate({
      agentId: conversation.agentId,
      scope: "agent",
      name: "Local verification",
      category: "Quality",
      summary: "Create a reusable verification plan.",
      description: "A local-only prompt and flow template.",
      standingOrderPatch: "Always report verification gaps.",
      flowTemplate: {
        title: "Verification flow",
        steps: [
          {
            stepKey: "verify",
            title: "Verify",
            prompt: "Run the agreed validation through opencode and summarize results.",
            dependencyStepKey: null,
          },
        ],
      },
      verificationChecklist: ["typecheck", "test", "build"],
      heartbeatInstructions: "Check for stale failed tasks.",
      suggestedPrompt: "Prepare a verification report.",
      tags: ["verification"],
    });

    expect(store.listCustomSkillTemplates(conversation.agentId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: skill.id,
          builtIn: false,
          name: "Local verification",
          tags: ["verification"],
        }),
      ]),
    );
    expect(store.deleteCustomSkillTemplate(conversation.agentId, skill.id)).toBe(true);
    expect(store.getCustomSkillTemplate(conversation.agentId, skill.id)).toBeNull();
  });

  it("preserves legacy memory/plugin tables when opening old databases", () => {
    store.rawDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const db = new Database(path.join(dataDir, "chat.sqlite"));
    db.exec(`
      CREATE TABLE memory_index (
        agent_id TEXT,
        path TEXT,
        kind TEXT,
        line INTEGER,
        reason TEXT,
        text TEXT
      );
      INSERT INTO memory_index (agent_id, path, kind, line, reason, text)
      VALUES ('default-agent', 'legacy.md', 'note', 1, 'legacy', 'keep me');

      CREATE TABLE plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO plugins (id, name, manifest_json, enabled, created_at, updated_at)
      VALUES ('plugin-1', 'Legacy Plugin', '{}', 1, 1, 1);
    `);
    db.close();

    store = createStore(dataDir);

    expect(
      store.rawDb.prepare("SELECT COUNT(*) AS count FROM memory_index").get(),
    ).toEqual({ count: 1 });
    expect(store.rawDb.prepare("SELECT COUNT(*) AS count FROM plugins").get()).toEqual({
      count: 1,
    });
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

  it("keeps terminal task transitions idempotent", () => {
    const agent = store.saveAgent({
      name: "Terminal Agent",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });
    const conversation = store.saveConversation({
      agentId: agent.id,
      title: "terminal session",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });
    const task = store.createTask({
      agentId: agent.id,
      conversationId: conversation.id,
      title: "Terminal work",
      prompt: "Complete once",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });

    const completed = store.transitionTask({
      taskId: task.id,
      status: "completed",
      eventType: "completed",
      resultText: "done",
    });
    const eventCountAfterComplete = store.listTaskEvents(agent.id, task.id).length;
    const failed = store.transitionTask({
      taskId: task.id,
      status: "failed",
      eventType: "failed",
      resultText: "should not overwrite",
    });

    expect(completed.changed).toBe(true);
    expect(failed.changed).toBe(false);
    expect(store.getTask(task.id)).toEqual(
      expect.objectContaining({
        status: "completed",
        resultText: "done",
      }),
    );
    expect(store.listTaskEvents(agent.id, task.id)).toHaveLength(eventCountAfterComplete);
  });

  it("recovers stale running tasks, runs, heartbeat logs, and flow steps after restart", () => {
    const agent = store.getDefaultAgent();
    const conversation = createConversation("restart recovery");
    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "long run",
    });
    const task = store.createTask({
      agentId: agent.id,
      conversationId: conversation.id,
      title: "Detached work",
      prompt: "Keep working",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      taskKind: "detached",
    });
    store.transitionTask({
      taskId: task.id,
      status: "running",
      eventType: "running",
      runId: run.id,
      payload: { started: true },
    });
    const heartbeat = store.createHeartbeatLog({
      agentId: agent.id,
      conversationId: conversation.id,
      triggerSource: "manual",
      summary: "Heartbeat queued",
    });
    store.transitionHeartbeatLog({
      id: heartbeat.id,
      taskId: task.id,
      status: "running",
      summary: "Heartbeat running",
    });

    const flow = store.createTaskFlow({
      agentId: agent.id,
      conversationId: conversation.id,
      title: "Recovery flow",
    });
    const step = store.createTaskFlowStep({
      flowId: flow.id,
      stepKey: "step-1",
      title: "Step one",
      prompt: "Do step one",
    });
    const flowTask = store.createTask({
      agentId: agent.id,
      conversationId: conversation.id,
      title: step.title,
      prompt: step.prompt,
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
      taskKind: "flow_step",
      taskFlowId: flow.id,
      flowStepKey: step.stepKey,
    });
    store.transitionTaskFlow({ flowId: flow.id, status: "running" });
    store.transitionTaskFlowStep({ stepId: step.id, taskId: flowTask.id, status: "running" });
    store.transitionTask({
      taskId: flowTask.id,
      status: "running",
      eventType: "running",
      payload: { flowStep: true },
    });

    const completedTask = store.createTask({
      agentId: agent.id,
      conversationId: conversation.id,
      title: "Already done",
      prompt: "Done",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    store.transitionTask({
      taskId: completedTask.id,
      status: "completed",
      eventType: "completed",
      resultText: "complete",
    });

    const recovery = store.recoverStaleRunningWork();

    expect(recovery).toEqual({
      tasks: 2,
      workspaceRuns: 1,
      taskFlowSteps: 1,
      taskFlows: 1,
    });
    expect(store.getTask(task.id)).toEqual(
      expect.objectContaining({
        status: "cancelled",
        resultText: expect.stringContaining("server restarted"),
      }),
    );
    expect(store.getTask(flowTask.id)).toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(store.getTask(completedTask.id)).toEqual(expect.objectContaining({ status: "completed" }));
    expect(store.getWorkspaceRun(run.id)).toEqual(
      expect.objectContaining({
        status: "cancelled",
        phase: "cancelled",
      }),
    );
    expect(store.getTaskFlow(flow.id)).toEqual(
      expect.objectContaining({
        status: "cancelled",
        errorText: expect.stringContaining("server restarted"),
      }),
    );
    expect(store.getTaskFlowStep(step.id)).toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(store.listHeartbeatLogs(agent.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: heartbeat.id,
          status: "cancelled",
          errorText: expect.stringContaining("server restarted"),
        }),
      ]),
    );
    expect(store.listTaskEvents(agent.id, task.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "cancelled",
          payload: expect.objectContaining({ reason: "server_restart_recovery" }),
        }),
      ]),
    );
    expect(store.listWorkspaceRunEvents(conversation.id, run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "run_cancelled",
          payload: expect.objectContaining({ reason: "server_restart_recovery" }),
        }),
      ]),
    );
  });

  it("persists research projects, evidence ledgers, and flow-linked loop extraction", () => {
    const conversation = createConversation("research autonomy");
    const project = store.createResearchProject({
      agentId: conversation.agentId,
      conversationId: conversation.id,
      title: "Aircraft research automation",
      objective: "Investigate bounded aircraft research loops.",
      domain: "aerospace",
      autonomyBudget: { maxLoopsPerDay: 2 },
      safetyPolicy: { notes: "External work requires approval." },
    });
    const question = store.createResearchQuestion({
      projectId: project.id,
      question: "Which evidence is required before CFD automation?",
      priority: 5,
    });
    const hypothesis = store.createResearchHypothesis({
      projectId: project.id,
      questionId: question.id,
      hypothesis: "Approval gates reduce unsafe autonomous actions.",
      confidence: 0.4,
    });
    const manualEvidence = store.createResearchEvidence({
      projectId: project.id,
      questionId: question.id,
      hypothesisId: hypothesis.id,
      sourceType: "human_note",
      claim: "Manual approval is required before external research.",
      summary: "The default research safety policy requires approval for external work.",
      confidence: 0.75,
      uncertainty: "Policy still needs live workflow validation.",
    });
    const flow = store.createTaskFlow({
      agentId: conversation.agentId,
      conversationId: conversation.id,
      title: "Research loop flow",
      triggerSource: "manual",
    });
    store.createTaskFlowStep({
      flowId: flow.id,
      stepKey: "research-plan",
      title: "Research plan",
      prompt: "Prepare a bounded research plan.",
    });
    const loop = store.createResearchLoop({
      projectId: project.id,
      selectedQuestionId: question.id,
      proposedFlowId: flow.id,
      goal: "Clarify CFD prerequisites.",
      status: "running",
    });

    expect(store.listResearchProjects(conversation.agentId)).toEqual([
      expect.objectContaining({
        id: project.id,
        autonomyBudget: expect.objectContaining({ maxLoopsPerDay: 2 }),
        safetyPolicy: expect.objectContaining({ notes: "External work requires approval." }),
      }),
    ]);
    expect(store.listResearchQuestions(project.id)).toEqual([
      expect.objectContaining({ id: question.id, priority: 5 }),
    ]);
    expect(store.listResearchHypotheses(project.id)).toEqual([
      expect.objectContaining({ id: hypothesis.id, questionId: question.id }),
    ]);
    expect(store.listResearchEvidence(project.id)).toEqual([
      expect.objectContaining({ id: manualEvidence.id, sourceType: "human_note" }),
    ]);
    expect(store.listResearchLoops(project.id)).toEqual([
      expect.objectContaining({ id: loop.id, proposedFlowId: flow.id, status: "running" }),
    ]);
    const linkedConversation = store.saveConversation({
      agentId: conversation.agentId,
      title: "linked research notes",
      providerKind: conversation.providerKind,
      model: conversation.model,
      reasoningLevel: conversation.reasoningLevel,
    });
    const linkedSession = store.linkResearchProjectSession({
      projectId: project.id,
      conversationId: linkedConversation.id,
      role: "literature-review",
      includeInContext: true,
    });
    expect(store.listResearchProjectSessions(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conversationId: conversation.id, role: "primary" }),
        expect.objectContaining({ conversationId: linkedConversation.id, role: "literature-review" }),
      ]),
    );
    expect(linkedSession.includeInContext).toBe(true);
    expect(store.findResearchProjectForConversation(linkedConversation.id)).toEqual(
      expect.objectContaining({ id: project.id }),
    );

    store.transitionTaskFlow({
      flowId: flow.id,
      status: "completed",
      resultSummary:
        "Hypotheses\nA staged hypothesis-plan step improves autonomous research reliability.\n\nClaims\nApproval gates reduce unsafe autonomous actions.\n\nEvidence\nFlow completed with human checkpoint guidance.\n\nUncertainty\nExternal MCP validation still needs review.",
      completedAt: Date.now(),
    });

    expect(store.getResearchLoop(loop.id)).toEqual(
      expect.objectContaining({
        status: "completed",
        resultSummary: expect.stringContaining("Claims"),
      }),
    );
    expect(store.getResearchQuestion(question.id)).toEqual(
      expect.objectContaining({ status: "answered" }),
    );
    expect(store.listResearchEvidence(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "report",
          sourceRef: flow.id,
          confidence: 0.65,
          metadata: expect.objectContaining({ researchLoopId: loop.id }),
        }),
      ]),
    );
    expect(store.listResearchHypotheses(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hypothesis: "A staged hypothesis-plan step improves autonomous research reliability.",
          status: "proposed",
          confidence: 0.4,
        }),
      ]),
    );
  });

  it("applies configurable retention limits to run and task events without deleting messages", () => {
    store.rawDb.close();
    process.env.AETHEROPS_MAX_RUN_EVENTS_PER_RUN = "3";
    process.env.AETHEROPS_MAX_TASK_EVENTS_PER_TASK = "2";
    store = createStore(dataDir);

    const agent = store.getDefaultAgent();
    const conversation = createConversation("retention");
    store.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "keep this message",
    });
    const run = store.createWorkspaceRun({
      conversationId: conversation.id,
      providerKind: "openai",
      model: "gpt-5.4",
      userMessage: "retention run",
    });
    for (let index = 0; index < 5; index += 1) {
      const timestamp = Date.now();
      while (Date.now() === timestamp) {
        // Keep retention ordering deterministic for this millisecond-resolution store.
      }
      store.appendWorkspaceRunEvent({
        runId: run.id,
        eventType: "status",
        payload: { index },
      });
    }

    const task = store.createTask({
      agentId: agent.id,
      conversationId: conversation.id,
      title: "Retention task",
      prompt: "Prune task events",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });
    for (let index = 0; index < 4; index += 1) {
      const timestamp = Date.now();
      while (Date.now() === timestamp) {
        // Keep retention ordering deterministic for this millisecond-resolution store.
      }
      store.appendTaskEvent({
        taskId: task.id,
        eventType: "status",
        payload: { index },
      });
    }

    const runEvents = store.listWorkspaceRunEvents(conversation.id, run.id);
    const taskEvents = store.listTaskEvents(agent.id, task.id);

    expect(runEvents).toHaveLength(3);
    expect(runEvents.map((event) => event.payload.index)).toEqual([2, 3, 4]);
    expect(taskEvents).toHaveLength(2);
    expect(taskEvents.map((event) => event.payload.index)).toEqual([2, 3]);
    expect(store.listMessages(conversation.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: "keep this message",
        }),
      ]),
    );
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
