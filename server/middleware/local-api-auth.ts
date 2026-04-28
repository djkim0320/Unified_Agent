import type express from "express";
import { isTokenMatch } from "../lib/local-api-token.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const TOKEN_HEADER = "x-local-api-token";

function normalizeHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLocalHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  );
}

function originPort(origin: URL) {
  if (origin.port) {
    return Number(origin.port);
  }
  return origin.protocol === "https:" ? 443 : 80;
}

export function isAllowedLocalOrigin(originHeader: string | undefined, allowedPorts: number[]) {
  if (!originHeader) {
    return true;
  }

  try {
    const origin = new URL(originHeader);
    return isLocalHostname(origin.hostname) && allowedPorts.includes(originPort(origin));
  } catch {
    return false;
  }
}

export function createLocalApiAuthMiddleware(params: {
  token: string;
  allowedPorts: number[];
}): express.RequestHandler {
  const allowedPorts = Array.from(new Set(params.allowedPorts.filter(Number.isFinite)));

  return (request, response, next) => {
    if (!isAllowedLocalOrigin(request.header("origin"), allowedPorts)) {
      response.status(403).json({
        error: "Blocked non-local Origin for local API request.",
      });
      return;
    }

    if (
      request.method === "OPTIONS" ||
      !UNSAFE_METHODS.has(request.method.toUpperCase()) ||
      request.path === "/api/local-api-token"
    ) {
      next();
      return;
    }

    if (!isTokenMatch(request.header(TOKEN_HEADER), params.token)) {
      response.status(401).json({
        error: "Missing or invalid local API token.",
      });
      return;
    }

    next();
  };
}

export { TOKEN_HEADER };
