import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerMockCadTool } from "./src/mock-cad-tool.js";

export default definePluginEntry({
  id: "mock-cad",
  name: "Mock CAD",
  description: "Stage 1 CAD-style geometry tool for aerospace research workflows.",
  register(api) {
    api.registerTool((ctx) => registerMockCadTool(ctx), { optional: true });
  },
});
