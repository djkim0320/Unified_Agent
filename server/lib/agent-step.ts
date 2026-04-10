import { z } from "zod";
import type { AgentStep } from "../types.js";

const ToolStepSchema = z.object({
  type: z.literal("tool_call"),
  tool: z.object({
    name: z.enum([
      "list_tree",
      "read_file",
      "write_file",
      "edit_file",
      "make_dir",
      "move_path",
      "delete_path",
      "exec_command",
      "provider_web_search",
      "duckduckgo_search",
      "web_fetch",
      "browser_search",
      "browser_open",
      "browser_snapshot",
      "browser_extract",
      "browser_click",
      "browser_type",
      "browser_back",
      "browser_close",
    ]),
    arguments: z.record(z.unknown()).default({}),
  }),
});

const FinalStepSchema = z.object({
  type: z.literal("final_answer"),
});

const AgentStepSchema = z.union([ToolStepSchema, FinalStepSchema]);

export function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1];
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export function parseAgentStep(text: string): AgentStep {
  const payloadText = extractJsonObject(text);
  let payload: unknown;

  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error("The planner response was not valid JSON.");
  }

  const parsed = AgentStepSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`The planner response did not match the tool schema: ${parsed.error.message}`);
  }

  return parsed.data;
}
