import type express from "express";
import { sendLegacyGone } from "./legacy-gone.js";

type PlatformRouteGateway = {
  agentEngine: {
    kind: "opencode";
  };
};

type PlatformRouteChannelRegistry = {
  listChannels: () => unknown[];
};

export function registerPlatformRoutes(
  app: express.Express,
  params: {
    localApiToken: string;
    gateway: PlatformRouteGateway;
    channelRegistry: PlatformRouteChannelRegistry;
  },
) {
  const { localApiToken, gateway, channelRegistry } = params;

  app.get("/api/local-api-token", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ token: localApiToken });
  });

  app.get("/api/plugins", (_request, response) => {
    response.json({
      plugins: [],
      engineKind: gateway.agentEngine.kind,
    });
  });

  app.post("/api/mcp/servers", (_request, response) => {
    sendLegacyGone(response, "MCP/profile registration");
  });

  app.get("/api/tools", (_request, response) => {
    sendLegacyGone(response, "AetherOps internal tool runtime");
  });

  app.get("/api/channels", (_request, response) => {
    response.json({
      channels: channelRegistry.listChannels(),
    });
  });
}
