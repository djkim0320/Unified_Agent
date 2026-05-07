import { apiRequest } from "../../apiClient";
import type { ChannelSummary, PlatformMetadata, PluginManifest } from "../../types";

export async function listPlugins(signal?: AbortSignal) {
  return apiRequest<{ plugins: PluginManifest[] }>("/api/plugins", { signal });
}

export async function listChannels(signal?: AbortSignal) {
  return apiRequest<{ channels: ChannelSummary[] }>("/api/channels", { signal });
}

export async function listPlatformMetadata(
  agentId?: string | null,
  signal?: AbortSignal,
): Promise<PlatformMetadata> {
  const [pluginsResponse, channelsResponse] = await Promise.all([
    listPlugins(signal),
    listChannels(signal),
  ]);

  return {
    plugins: pluginsResponse.plugins,
    tools: [],
    channels: channelsResponse.channels,
    agentSkills: [],
  };
}
