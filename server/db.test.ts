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
});
