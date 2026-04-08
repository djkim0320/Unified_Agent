import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { getResearchProject } from "../research/projects.js";
import { resolveArtifactFile } from "../research/artifacts.js";
import { sendJson, sendMethodNotAllowed } from "./http-common.js";
import {
  authorizeGatewayHttpRequestOrReply,
  resolveTrustedHttpOperatorScopes,
} from "./http-utils.js";
import { authorizeOperatorScopesForMethod } from "./method-scopes.js";

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".step": "application/step",
  ".stp": "application/step",
  ".txt": "text/plain; charset=utf-8",
};

function resolveRequestMatch(req: IncomingMessage): { projectId: string; artifactId: string } | null {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const match = url.pathname.match(/^\/research\/projects\/([^/]+)\/artifacts\/([^/]+)$/);
  if (!match) {
    return null;
  }
  try {
    return {
      projectId: decodeURIComponent(match[1] ?? ""),
      artifactId: decodeURIComponent(match[2] ?? ""),
    };
  } catch {
    return { projectId: "", artifactId: "" };
  }
}

function resolveContentType(filePath: string): string {
  return CONTENT_TYPE_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export async function handleResearchArtifactHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const match = resolveRequestMatch(req);
  if (!match) {
    return false;
  }
  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return true;
  }
  if (!match.projectId || !match.artifactId) {
    sendJson(res, 400, { ok: false, error: { type: "invalid_request", message: "invalid artifact path" } });
    return true;
  }

  const cfg = loadConfig();
  const requestAuth = await authorizeGatewayHttpRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback ?? cfg.gateway?.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!requestAuth) {
    return true;
  }
  const requestedScopes = resolveTrustedHttpOperatorScopes(req, requestAuth);
  const scopeAuth = authorizeOperatorScopesForMethod("research.artifacts.get", requestedScopes);
  if (!scopeAuth.allowed) {
    sendJson(res, 403, {
      ok: false,
      error: { type: "forbidden", message: `missing scope: ${scopeAuth.missingScope}` },
    });
    return true;
  }

  const project = await getResearchProject(match.projectId);
  if (!project) {
    sendJson(res, 404, { ok: false, error: { type: "not_found", message: "project not found" } });
    return true;
  }
  const artifact = await resolveArtifactFile({ project, artifactId: match.artifactId });
  if (!artifact) {
    sendJson(res, 404, { ok: false, error: { type: "not_found", message: "artifact not found" } });
    return true;
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(artifact.path);
  } catch {
    sendJson(res, 404, { ok: false, error: { type: "not_found", message: "artifact file missing" } });
    return true;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const download = url.searchParams.get("download") === "1";
  res.statusCode = 200;
  res.setHeader("Content-Type", resolveContentType(artifact.path));
  res.setHeader(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename="${path.basename(artifact.path)}"`,
  );
  res.end(fileBuffer);
  return true;
}
