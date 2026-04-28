import {
  evaluateComputerUsePolicy,
  type ComputerUsePolicyInput,
  type TypedTextKind,
} from "./policy.js";
import { createComputerUseBrowserHarness } from "./browser-harness.js";
import {
  readPrivateComputerUseScreenshot,
  writePrivateComputerUseScreenshot,
} from "./screenshots.js";
import type {
  ComputerUseActionEventRecord,
  ComputerUseActionType,
  ComputerUseApprovalRecord,
  ComputerUseSessionRecord,
  ComputerUseSettingsRecord,
} from "../../types.js";

type Store = {
  getComputerUseSettings: () => ComputerUseSettingsRecord;
  saveComputerUseSettings: (
    input: Partial<Omit<ComputerUseSettingsRecord, "updatedAt">>,
  ) => ComputerUseSettingsRecord;
  createComputerUseSession: (input: {
    agentId?: string | null;
    conversationId?: string | null;
    runId?: string | null;
    taskId?: string | null;
    allowedDomains?: string[];
  }) => ComputerUseSessionRecord;
  getComputerUseSession: (id: string) => ComputerUseSessionRecord | null;
  updateComputerUseSession: (input: {
    sessionId: string;
    status?: ComputerUseSessionRecord["status"];
    currentUrl?: string | null;
    actionCount?: number;
    latestScreenshotPath?: string | null;
    closedAt?: number | null;
  }) => ComputerUseSessionRecord | null;
  appendComputerUseEvent: (input: {
    sessionId: string;
    actionType: ComputerUseActionType;
    status: ComputerUseActionEventRecord["status"];
    currentUrl?: string | null;
    targetUrl?: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
    screenshotPath?: string | null;
  }) => ComputerUseActionEventRecord;
  listComputerUseEvents: (sessionId: string) => ComputerUseActionEventRecord[];
  recordComputerUseApproval: (input: {
    sessionId: string;
    actionEventId?: string | null;
    decision: ComputerUseApprovalRecord["decision"];
    reason?: string | null;
  }) => ComputerUseApprovalRecord;
  listComputerUseApprovals: (sessionId: string) => ComputerUseApprovalRecord[];
};

type Harness = ReturnType<typeof createComputerUseBrowserHarness>;

class ComputerUseBlockedError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "ComputerUseBlockedError";
    this.status = status;
  }
}

function sanitizeDomains(domains: string[]) {
  return [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))];
}

function redactTextMetadata(text: string) {
  return {
    length: text.length,
    empty: text.length === 0,
  };
}

function summarizeAction(actionType: ComputerUseActionType, target?: string | null) {
  return target ? `${actionType}: ${target}` : actionType;
}

export function createComputerUseSessionManager(params: {
  projectRoot: string;
  store: Store;
  harness?: Harness;
}) {
  const harness = params.harness ?? createComputerUseBrowserHarness();

  function getSettings() {
    return params.store.getComputerUseSettings();
  }

  function saveSettings(input: Partial<Omit<ComputerUseSettingsRecord, "updatedAt">>) {
    return params.store.saveComputerUseSettings({
      ...input,
      allowExternalDomains: input.allowExternalDomains
        ? sanitizeDomains(input.allowExternalDomains)
        : undefined,
    });
  }

  function requireOpenSession(sessionId: string) {
    const session = params.store.getComputerUseSession(sessionId);
    if (!session) {
      throw new ComputerUseBlockedError("Computer Use session not found.", 404);
    }
    if (session.status !== "open") {
      throw new ComputerUseBlockedError("Computer Use session is closed.", 400);
    }
    return session;
  }

  function policySettings(session: ComputerUseSessionRecord) {
    const settings = getSettings();
    return {
      enabled: settings.enabled && settings.customBrowserHarnessEnabled,
      allowFileUrls: settings.allowFileUrls,
      allowExternalDomains: sanitizeDomains([
        ...settings.allowExternalDomains,
        ...session.allowedDomains,
      ]),
    };
  }

  function evaluateAndRecord(input: {
    session: ComputerUseSessionRecord;
    actionType: ComputerUseActionType;
    targetUrl?: string | null;
    selector?: string | null;
    visibleText?: string | null;
    typedTextKind?: TypedTextKind;
    submit?: boolean;
    maySubmit?: boolean;
    mayChangeState?: boolean;
    mayDelete?: boolean;
    mayUpload?: boolean;
    mayDownload?: boolean;
    mayPurchase?: boolean;
    metadata?: Record<string, unknown>;
  }) {
    const verdict = evaluateComputerUsePolicy({
      actionType: input.actionType,
      currentUrl: input.session.currentUrl,
      targetUrl: input.targetUrl,
      selector: input.selector,
      visibleText: input.visibleText,
      typedTextKind: input.typedTextKind,
      submit: input.submit,
      maySubmit: input.maySubmit,
      mayChangeState: input.mayChangeState,
      mayDelete: input.mayDelete,
      mayUpload: input.mayUpload,
      mayDownload: input.mayDownload,
      mayPurchase: input.mayPurchase,
      settings: policySettings(input.session),
    } satisfies ComputerUsePolicyInput);
    const event = params.store.appendComputerUseEvent({
      sessionId: input.session.id,
      actionType: input.actionType,
      status: verdict.decision,
      currentUrl: input.session.currentUrl,
      targetUrl: input.targetUrl ?? null,
      summary: verdict.reasons.join(" "),
      metadata: {
        risk: verdict.risk,
        reasons: verdict.reasons,
        ...input.metadata,
      },
    });
    if (verdict.decision === "blocked") {
      throw new ComputerUseBlockedError(verdict.reasons.join(" "));
    }
    if (verdict.decision === "requires_approval") {
      return {
        approved: false,
        pendingApproval: event,
      };
    }
    return {
      approved: true,
      pendingApproval: null,
    };
  }

  async function withAllowedAction<T>(
    session: ComputerUseSessionRecord,
    actionType: ComputerUseActionType,
    policyInput: Omit<Parameters<typeof evaluateAndRecord>[0], "session" | "actionType">,
    operation: () => Promise<{ output: T; currentUrl?: string | null; screenshotPath?: string | null }>,
  ) {
    const settings = getSettings();
    if (session.actionCount >= settings.maxActionsPerSession) {
      throw new ComputerUseBlockedError("Computer Use session reached its max action count.", 429);
    }
    const verdict = evaluateAndRecord({ session, actionType, ...policyInput });
    if (!verdict.approved) {
      return {
        status: "requires_approval" as const,
        pendingApproval: verdict.pendingApproval,
        output: null,
      };
    }
    params.store.appendComputerUseEvent({
      sessionId: session.id,
      actionType,
      status: "started",
      currentUrl: session.currentUrl,
      targetUrl: policyInput.targetUrl ?? null,
      summary: "Computer Use action started.",
      metadata: policyInput.metadata,
    });
    try {
      const result = await operation();
      const nextUrl = result.currentUrl ?? session.currentUrl;
      const updated = params.store.updateComputerUseSession({
        sessionId: session.id,
        currentUrl: nextUrl,
        actionCount: session.actionCount + 1,
        latestScreenshotPath: result.screenshotPath ?? null,
      });
      params.store.appendComputerUseEvent({
        sessionId: session.id,
        actionType,
        status: "completed",
        currentUrl: nextUrl,
        targetUrl: policyInput.targetUrl ?? null,
        summary: "Computer Use action completed.",
        metadata: { output: result.output },
        screenshotPath: result.screenshotPath ?? null,
      });
      return {
        status: "completed" as const,
        pendingApproval: null,
        output: {
          ...(typeof result.output === "object" && result.output !== null ? result.output : { value: result.output }),
          session: updated,
        },
      };
    } catch (error) {
      params.store.appendComputerUseEvent({
        sessionId: session.id,
        actionType,
        status: "failed",
        currentUrl: session.currentUrl,
        targetUrl: policyInput.targetUrl ?? null,
        summary: error instanceof Error ? error.message : "Computer Use action failed.",
        metadata: {},
      });
      throw error;
    }
  }

  async function createSession(input: {
    agentId?: string | null;
    conversationId?: string | null;
    runId?: string | null;
    taskId?: string | null;
    allowedDomains?: string[];
  }) {
    const settings = getSettings();
    if (!settings.enabled || !settings.customBrowserHarnessEnabled) {
      throw new ComputerUseBlockedError("Computer Use is disabled. Enable it in settings first.");
    }
    const allowedDomains = sanitizeDomains(input.allowedDomains ?? []);
    const session = params.store.createComputerUseSession({
      ...input,
      allowedDomains,
    });
    try {
      await harness.createSession({
        sessionId: session.id,
        allowedDomains,
        settings,
      });
    } catch (error) {
      params.store.updateComputerUseSession({
        sessionId: session.id,
        status: "closed",
        closedAt: Date.now(),
      });
      params.store.appendComputerUseEvent({
        sessionId: session.id,
        actionType: "create_session",
        status: "failed",
        currentUrl: "about:blank",
        summary: error instanceof Error ? error.message : "Computer Use browser launch failed.",
        metadata: {
          hint: 'Install Chromium with "npm exec -- playwright install chromium" if it is missing.',
        },
      });
      throw new Error(
        error instanceof Error
          ? `${error.message}. Install Chromium with "npm exec -- playwright install chromium" if needed.`
          : 'Computer Use browser launch failed. Install Chromium with "npm exec -- playwright install chromium" if needed.',
      );
    }
    params.store.appendComputerUseEvent({
      sessionId: session.id,
      actionType: "create_session",
      status: "completed",
      currentUrl: "about:blank",
      summary: "Computer Use browser session created.",
      metadata: { allowedDomains },
    });
    return params.store.getComputerUseSession(session.id)!;
  }

  async function navigate(sessionId: string, url: string) {
    const session = requireOpenSession(sessionId);
    return withAllowedAction(
      session,
      "navigate",
      { targetUrl: url, metadata: { url } },
      async () => {
        const output = await harness.navigate({ sessionId, url });
        return { output, currentUrl: output.url };
      },
    );
  }

  async function screenshot(sessionId: string, fullPage?: boolean) {
    const session = requireOpenSession(sessionId);
    return withAllowedAction(
      session,
      "screenshot",
      { metadata: { fullPage: Boolean(fullPage) } },
      async () => {
        const capture = await harness.screenshot({ sessionId, fullPage });
        const screenshotPath = writePrivateComputerUseScreenshot({
          projectRoot: params.projectRoot,
          sessionId,
          buffer: capture.buffer,
        });
        return {
          output: {
            url: capture.url,
            title: capture.title,
            mimeType: capture.mimeType,
            screenshotPath,
            screenshotBase64: capture.buffer.toString("base64"),
          },
          currentUrl: capture.url,
          screenshotPath,
        };
      },
    );
  }

  async function click(input: {
    sessionId: string;
    selector: string;
    visibleText?: string;
    double?: boolean;
    maySubmit?: boolean;
    mayChangeState?: boolean;
    mayDelete?: boolean;
    mayUpload?: boolean;
    mayDownload?: boolean;
    mayPurchase?: boolean;
  }) {
    const session = requireOpenSession(input.sessionId);
    const actionType = input.double ? "double_click" : "click";
    return withAllowedAction(
      session,
      actionType,
      {
        selector: input.selector,
        visibleText: input.visibleText,
        maySubmit: input.maySubmit,
        mayChangeState: input.mayChangeState,
        mayDelete: input.mayDelete,
        mayUpload: input.mayUpload,
        mayDownload: input.mayDownload,
        mayPurchase: input.mayPurchase,
        metadata: { selector: input.selector },
      },
      async () => {
        const output = input.double
          ? await harness.doubleClick({ sessionId: input.sessionId, selector: input.selector })
          : await harness.click({ sessionId: input.sessionId, selector: input.selector });
        return { output, currentUrl: output.url };
      },
    );
  }

  async function type(input: {
    sessionId: string;
    selector: string;
    text: string;
    typedTextKind?: TypedTextKind;
    submit?: boolean;
  }) {
    const session = requireOpenSession(input.sessionId);
    return withAllowedAction(
      session,
      "type",
      {
        selector: input.selector,
        typedTextKind: input.typedTextKind ?? "plain",
        submit: input.submit,
        maySubmit: input.submit,
        metadata: {
          selector: input.selector,
          typedTextKind: input.typedTextKind ?? "plain",
          text: redactTextMetadata(input.text),
        },
      },
      async () => {
        const output = await harness.type({
          sessionId: input.sessionId,
          selector: input.selector,
          text: input.text,
          submit: input.submit,
        });
        return { output, currentUrl: output.url };
      },
    );
  }

  async function keypress(input: {
    sessionId: string;
    key: string;
    selector?: string;
    visibleText?: string;
    maySubmit?: boolean;
  }) {
    const session = requireOpenSession(input.sessionId);
    return withAllowedAction(
      session,
      "keypress",
      {
        selector: input.selector,
        visibleText: input.visibleText,
        maySubmit: input.maySubmit,
        metadata: { key: input.key, selector: input.selector ?? null },
      },
      async () => {
        const output = await harness.keypress({
          sessionId: input.sessionId,
          key: input.key,
          selector: input.selector,
        });
        return { output, currentUrl: output.url };
      },
    );
  }

  async function scroll(input: { sessionId: string; deltaX: number; deltaY: number }) {
    const session = requireOpenSession(input.sessionId);
    return withAllowedAction(
      session,
      "scroll",
      { metadata: { deltaX: input.deltaX, deltaY: input.deltaY } },
      async () => {
        const output = await harness.scroll(input);
        return { output, currentUrl: output.url };
      },
    );
  }

  async function wait(input: { sessionId: string; timeoutMs: number }) {
    const session = requireOpenSession(input.sessionId);
    return withAllowedAction(
      session,
      "wait",
      { metadata: { timeoutMs: input.timeoutMs } },
      async () => {
        const output = await harness.wait(input);
        return { output, currentUrl: output.url };
      },
    );
  }

  async function extractText(input: { sessionId: string; selector?: string }) {
    const session = requireOpenSession(input.sessionId);
    return withAllowedAction(
      session,
      "extract_text",
      { metadata: { selector: input.selector ?? null } },
      async () => {
        const output = await harness.extractText(input);
        return { output, currentUrl: output.url };
      },
    );
  }

  async function closeSession(sessionId: string) {
    const session = params.store.getComputerUseSession(sessionId);
    if (!session) {
      throw new ComputerUseBlockedError("Computer Use session not found.", 404);
    }
    await harness.closeSession(sessionId);
    const closed = params.store.updateComputerUseSession({
      sessionId,
      status: "closed",
      closedAt: Date.now(),
    });
    params.store.appendComputerUseEvent({
      sessionId,
      actionType: "close_session",
      status: "completed",
      currentUrl: session.currentUrl,
      summary: "Computer Use browser session closed.",
      metadata: {},
    });
    return closed;
  }

  function getSessionDetail(sessionId: string) {
    const session = params.store.getComputerUseSession(sessionId);
    if (!session) {
      throw new ComputerUseBlockedError("Computer Use session not found.", 404);
    }
    const screenshot = readPrivateComputerUseScreenshot({
      projectRoot: params.projectRoot,
      relativePath: session.latestScreenshotPath,
    });
    return {
      session,
      events: params.store.listComputerUseEvents(sessionId),
      approvals: params.store.listComputerUseApprovals(sessionId),
      latestScreenshotBase64: screenshot?.base64 ?? null,
      latestScreenshotMimeType: screenshot?.mimeType ?? null,
    };
  }

  function approve(sessionId: string, actionEventId?: string | null, reason?: string | null) {
    requireOpenSession(sessionId);
    const approval = params.store.recordComputerUseApproval({
      sessionId,
      actionEventId,
      decision: "approved",
      reason,
    });
    params.store.appendComputerUseEvent({
      sessionId,
      actionType: "wait",
      status: "approved",
      summary: "Computer Use action was approved by the user.",
      metadata: { actionEventId: actionEventId ?? null },
    });
    return approval;
  }

  function deny(sessionId: string, actionEventId?: string | null, reason?: string | null) {
    requireOpenSession(sessionId);
    const approval = params.store.recordComputerUseApproval({
      sessionId,
      actionEventId,
      decision: "denied",
      reason,
    });
    params.store.appendComputerUseEvent({
      sessionId,
      actionType: "wait",
      status: "denied",
      summary: "Computer Use action was denied by the user.",
      metadata: { actionEventId: actionEventId ?? null },
    });
    return approval;
  }

  return {
    getSettings,
    saveSettings,
    createSession,
    navigate,
    screenshot,
    click,
    type,
    keypress,
    scroll,
    wait,
    extractText,
    closeSession,
    getSessionDetail,
    approve,
    deny,
    harness,
    ComputerUseBlockedError,
    summarizeAction,
  };
}
