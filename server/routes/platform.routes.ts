import type express from "express";

type PlatformRouteGateway = {
  agentEngine: {
    kind: "opencode";
  };
};

type PlatformRouteChannelRegistry = {
  listChannels: () => unknown[];
};

function gone(response: express.Response, feature: string) {
  response.status(410).json({
    error: `${feature} was removed from AetherOps opencode-only mode. Configure equivalent capabilities in opencode.`,
    engineKind: "opencode",
  });
}

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
    gone(response, "MCP/profile registration");
  });

  app.get("/api/tools", (_request, response) => {
    gone(response, "AetherOps internal tools");
  });

  app.get("/api/channels", (_request, response) => {
    response.json({
      channels: channelRegistry.listChannels(),
    });
  });
}
