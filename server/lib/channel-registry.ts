import type { ChannelKind, ChannelSummary } from "../types.js";

const CHANNELS: ChannelSummary[] = [
  {
    kind: "webchat",
    label: "Web Chat",
    description: "Browser-based local chat channel.",
    enabled: true,
    note: "Primary channel for local conversations.",
  },
];

export function createChannelRegistry() {
  function listChannels() {
    return [...CHANNELS];
  }

  function getChannel(kind: ChannelKind) {
    return CHANNELS.find((channel) => channel.kind === kind) ?? null;
  }

  function getDefaultChannel() {
    return CHANNELS[0];
  }

  return {
    listChannels,
    getChannel,
    getDefaultChannel,
  };
}
