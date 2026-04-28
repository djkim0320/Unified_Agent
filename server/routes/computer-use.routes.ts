import type express from "express";
import { z } from "zod";
import {
  ComputerUseActionSchemas,
  ComputerUseSessionCreateSchema,
  ComputerUseSettingsWriteSchema,
} from "../lib/computer-use/actions.js";
import type { createComputerUseSessionManager } from "../lib/computer-use/session-manager.js";

type ComputerUseManager = ReturnType<typeof createComputerUseSessionManager>;

type ComputerUseRouteStore = {
  listComputerUseEvents: (sessionId: string) => unknown[];
  listComputerUseApprovals: (sessionId: string) => unknown[];
};

const ComputerUseApprovalSchema = z.object({
  actionEventId: z.string().min(1).optional().nullable(),
  reason: z.string().max(1000).optional().nullable(),
});

export function registerComputerUseRoutes(
  app: express.Express,
  params: {
    computerUse: ComputerUseManager;
    store: ComputerUseRouteStore;
  },
) {
  const { computerUse, store } = params;

  app.get("/api/computer-use/settings", (_request, response) => {
    response.json({ settings: computerUse.getSettings() });
  });

  app.put("/api/computer-use/settings", (request, response) => {
    const body = ComputerUseSettingsWriteSchema.parse(request.body);
    response.json({ settings: computerUse.saveSettings(body) });
  });

  app.post("/api/computer-use/sessions", async (request, response) => {
    const body = ComputerUseSessionCreateSchema.parse(request.body);
    const session = await computerUse.createSession(body);
    response.status(201).json({
      session,
      events: store.listComputerUseEvents(session.id),
      approvals: store.listComputerUseApprovals(session.id),
    });
  });

  app.get("/api/computer-use/sessions/:id", (request, response) => {
    response.json(computerUse.getSessionDetail(request.params.id));
  });

  app.post("/api/computer-use/sessions/:id/approve", (request, response) => {
    const body = ComputerUseApprovalSchema.parse(request.body ?? {});
    const approval = computerUse.approve(request.params.id, body.actionEventId, body.reason);
    response.json({
      approval,
      detail: computerUse.getSessionDetail(request.params.id),
    });
  });

  app.post("/api/computer-use/sessions/:id/deny", (request, response) => {
    const body = ComputerUseApprovalSchema.parse(request.body ?? {});
    const approval = computerUse.deny(request.params.id, body.actionEventId, body.reason);
    response.json({
      approval,
      detail: computerUse.getSessionDetail(request.params.id),
    });
  });

  app.post("/api/computer-use/sessions/:id/close", async (request, response) => {
    const session = await computerUse.closeSession(request.params.id);
    response.json({ session });
  });

  app.post("/api/computer-use/sessions/:id/navigate", async (request, response) => {
    const body = ComputerUseActionSchemas.navigate.parse({
      ...request.body,
      sessionId: request.params.id,
    });
    response.json(await computerUse.navigate(body.sessionId, body.url));
  });

  app.post("/api/computer-use/sessions/:id/screenshot", async (request, response) => {
    const body = ComputerUseActionSchemas.screenshot.parse({
      ...request.body,
      sessionId: request.params.id,
    });
    response.json(await computerUse.screenshot(body.sessionId, body.fullPage));
  });

  app.post("/api/computer-use/sessions/:id/click", async (request, response) => {
    const body = ComputerUseActionSchemas.click.parse({
      ...request.body,
      sessionId: request.params.id,
    });
    response.json(
      await computerUse.click({
        sessionId: body.sessionId,
        selector: body.selector,
        visibleText: body.visibleText,
        maySubmit: body.maySubmit,
        mayChangeState: body.mayChangeState,
        mayDelete: body.mayDelete,
        mayUpload: body.mayUpload,
        mayDownload: body.mayDownload,
        mayPurchase: body.mayPurchase,
      }),
    );
  });

  app.post("/api/computer-use/sessions/:id/type", async (request, response) => {
    const body = ComputerUseActionSchemas.type.parse({
      ...request.body,
      sessionId: request.params.id,
    });
    response.json(
      await computerUse.type({
        sessionId: body.sessionId,
        selector: body.selector,
        text: body.text,
        typedTextKind: body.typedTextKind,
        submit: body.submit,
      }),
    );
  });
}
