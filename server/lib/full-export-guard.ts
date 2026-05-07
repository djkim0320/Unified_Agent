import type express from "express";
import { isTokenMatch } from "./local-api-token.js";
import {
  isAllowedLocalHostHeader,
  isAllowedLocalOrigin,
  isLoopbackRemoteAddress,
  TOKEN_HEADER,
} from "../middleware/local-api-auth.js";

export type ExportMode = "redacted" | "full";

export function exportModeFromRequest(request: express.Request): ExportMode {
  return request.query.mode === "full" ? "full" : "redacted";
}

export function canUseFullLocalExport(params: {
  request: express.Request;
  token: string;
  allowedPorts: number[];
}) {
  const headerToken = params.request.header(TOKEN_HEADER);
  if (isTokenMatch(headerToken, params.token)) {
    return true;
  }

  if (process.env.AETHEROPS_ENABLE_FULL_REPORT_EXPORT !== "true") {
    return false;
  }

  return (
    isLoopbackRemoteAddress(params.request.socket.remoteAddress) &&
    isAllowedLocalHostHeader(params.request.header("host"), params.allowedPorts) &&
    isAllowedLocalOrigin(params.request.header("origin"), params.allowedPorts)
  );
}

export function requireFullExportAllowed(
  response: express.Response,
  params: {
    request: express.Request;
    token: string;
    allowedPorts: number[];
  },
) {
  if (canUseFullLocalExport(params)) {
    return true;
  }
  response.status(403).json({
    error:
      "Full local export is protected. Use redacted mode, provide X-Local-API-Token, or enable AETHEROPS_ENABLE_FULL_REPORT_EXPORT=true for loopback-only development.",
  });
  return false;
}
