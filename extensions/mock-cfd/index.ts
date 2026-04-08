import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerMockCfdTool } from "./src/mock-cfd-tool.js";

export default definePluginEntry({
  id: "mock-cfd",
  name: "Mock CFD",
  description: "Stage 1 aerospace CFD research add-on with deterministic demo outputs.",
  register(api) {
    api.registerTool((ctx) => registerMockCfdTool(ctx), { optional: true });
  },
});
