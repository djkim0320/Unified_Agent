import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerMockConceptTool } from "./src/mock-concept-tool.js";

export default definePluginEntry({
  id: "mock-concept",
  name: "Mock Concept",
  description: "Stage 1 concept tradeoff tool for aerospace research workflows.",
  register(api) {
    api.registerTool((ctx) => registerMockConceptTool(ctx), { optional: true });
  },
});
