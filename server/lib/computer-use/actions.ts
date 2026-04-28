import { z } from "zod";

export const ComputerUseSessionCreateSchema = z.object({
  agentId: z.string().min(1).max(120).optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
  runId: z.string().min(1).max(120).optional().nullable(),
  taskId: z.string().min(1).max(120).optional().nullable(),
  allowedDomains: z.array(z.string().min(1).max(255)).max(25).optional().default([]),
});

export const ComputerUseSettingsWriteSchema = z.object({
  enabled: z.boolean(),
  customBrowserHarnessEnabled: z.boolean().optional().default(true),
  allowExternalDomains: z.array(z.string().min(1).max(255)).max(50).optional().default([]),
  allowFileUrls: z.boolean().optional().default(false),
  maxActionsPerSession: z.number().int().min(1).max(200).optional().default(60),
  sessionTimeoutMs: z.number().int().min(30_000).max(60 * 60_000).optional().default(15 * 60_000),
});

export const ComputerUseActionSchemas = {
  createSession: ComputerUseSessionCreateSchema,
  navigate: z.object({
    sessionId: z.string().min(1),
    url: z.string().min(1),
  }),
  screenshot: z.object({
    sessionId: z.string().min(1),
    fullPage: z.boolean().optional().default(false),
  }),
  click: z.object({
    sessionId: z.string().min(1),
    selector: z.string().min(1),
    visibleText: z.string().optional(),
    maySubmit: z.boolean().optional(),
    mayChangeState: z.boolean().optional(),
    mayDelete: z.boolean().optional(),
    mayUpload: z.boolean().optional(),
    mayDownload: z.boolean().optional(),
    mayPurchase: z.boolean().optional(),
  }),
  doubleClick: z.object({
    sessionId: z.string().min(1),
    selector: z.string().min(1),
    visibleText: z.string().optional(),
    mayChangeState: z.boolean().optional(),
    mayDelete: z.boolean().optional(),
  }),
  type: z.object({
    sessionId: z.string().min(1),
    selector: z.string().min(1),
    text: z.string(),
    typedTextKind: z
      .enum(["plain", "password", "token", "api_key", "payment", "email", "personal"])
      .optional()
      .default("plain"),
    submit: z.boolean().optional().default(false),
  }),
  keypress: z.object({
    sessionId: z.string().min(1),
    key: z.string().min(1).max(48),
    selector: z.string().min(1).optional(),
    visibleText: z.string().optional(),
    maySubmit: z.boolean().optional(),
  }),
  scroll: z.object({
    sessionId: z.string().min(1),
    deltaX: z.number().int().min(-5000).max(5000).optional().default(0),
    deltaY: z.number().int().min(-5000).max(5000).optional().default(700),
  }),
  wait: z.object({
    sessionId: z.string().min(1),
    timeoutMs: z.number().int().min(250).max(30_000).optional().default(1000),
  }),
  extractText: z.object({
    sessionId: z.string().min(1),
    selector: z.string().min(1).optional(),
  }),
  closeSession: z.object({
    sessionId: z.string().min(1),
  }),
};
