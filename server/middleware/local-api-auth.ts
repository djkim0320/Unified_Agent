import type express from "express";
import { isTokenMatch } from "../lib/local-api-token.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const TOKEN_HEADER = "x-local-api-token";

function normalizeHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isLocalHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  );
}

export function isLoopbackRemoteAddress(address: string | undefined) {
  if (!address) {
    return false;
  }
  const normalized = normalizeHostname(address.replace(/^::ffff:/i, ""));
  return isLocalHostname(normalized);
}

function originPort(origin: URL) {
  if (origin.port) {
    return Number(origin.port);
  }
  return origin.protocol === "https:" ? 443 : 80;
}

export function isAllowedLocalHostHeader(hostHeader: string | undefined, allowedPorts: number[]) {
  if (!hostHeader || hostHeader.includes(",")) {
    return false;
  }

  try {
    const parsed = new URL(`http://${hostHeader}`);
    return isLocalHostname(parsed.hostname) && allowedPorts.includes(originPort(parsed));
  } catch {
    return false;
  }
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
  exposeTokenEndpoint?: boolean;
}): express.RequestHandler {
  const allowedPorts = Array.from(new Set(params.allowedPorts.filter(Number.isFinite)));
  const exposeTokenEndpoint =
    params.exposeTokenEndpoint ?? process.env.AETHEROPS_EXPOSE_LOCAL_API_TOKEN !== "false";

  return (request, response, next) => {
    if (!isAllowedLocalOrigin(request.header("origin"), allowedPorts)) {
      response.status(403).json({
        error: "Blocked non-local Origin for local API request.",
      });
      return;
    }

    if (request.path === "/api/local-api-token") {
      if (!exposeTokenEndpoint) {
        response.status(404).json({ error: "Not found" });
        return;
      }
      if (!isLoopbackRemoteAddress(request.socket.remoteAddress)) {
        response.status(403).json({
          error: "Local API token bootstrap requires a loopback client address.",
        });
        return;
      }
      if (!isAllowedLocalHostHeader(request.header("host"), allowedPorts)) {
        response.status(403).json({
          error: "Local API token bootstrap requires a local Host header.",
        });
        return;
      }
      next();
      return;
    }

    if (
      request.method === "OPTIONS" ||
      !UNSAFE_METHODS.has(request.method.toUpperCase())
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
