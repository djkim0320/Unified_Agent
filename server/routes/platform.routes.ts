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

type PlatformRouteStore = {
  getTokenUsageSummary?: () => unknown;
};

export function registerPlatformRoutes(
  app: express.Express,
  params: {
    localApiToken: string;
    gateway: PlatformRouteGateway;
    channelRegistry: PlatformRouteChannelRegistry;
    store?: PlatformRouteStore;
  },
) {
  const { localApiToken, gateway, channelRegistry, store } = params;

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

  app.get("/api/usage/tokens", (_request, response) => {
    response.json({
      usage: store?.getTokenUsageSummary?.() ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        runsWithUsage: 0,
        lastUpdatedAt: null,
        byModel: [],
        source: "opencode-events",
        note: "토큰 사용량 집계 기능을 사용할 수 없습니다.",
      },
    });
  });
}
