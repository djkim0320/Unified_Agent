import type { ToolDescriptor } from "./tool-registry.js";
import type { ToolRiskLevel } from "../types.js";

export interface ToolPermissionPolicyDecision {
  risk: ToolRiskLevel;
  approvalRequired: boolean;
  approvalRecommended: boolean;
  reasons: string[];
}

const HIGH_RISK_TOOL_NAMES = new Set([
  "delete_path",
  "exec_command",
  "browser_click",
  "browser_type",
  "browser_press",
]);

const MEDIUM_RISK_TOOL_NAMES = new Set([
  "write_file",
  "edit_file",
  "make_dir",
  "move_path",
  "memory_write",
  "spawn_subagent_session",
  "spawn_task",
  "create_task_flow",
  "schedule_task",
  "browser_open",
  "browser_screenshot",
]);

function maxRisk(left: ToolRiskLevel, right: ToolRiskLevel): ToolRiskLevel {
  const order: Record<ToolRiskLevel, number> = {
    low: 0,
    medium: 1,
    high: 2,
  };
  return order[left] >= order[right] ? left : right;
}

function defaultRisk(descriptor: ToolDescriptor): ToolRiskLevel {
  if (descriptor.risk) {
    return descriptor.risk;
  }

  if (HIGH_RISK_TOOL_NAMES.has(descriptor.name) || descriptor.permission === "exec") {
    return "high";
  }

  if (
    MEDIUM_RISK_TOOL_NAMES.has(descriptor.name) ||
    descriptor.permission === "browser" ||
    descriptor.permission === "tasks"
  ) {
    return "medium";
  }

  if (descriptor.permission === "network") {
    return "medium";
  }

  return "low";
}

function hasDestructiveArgument(args: Record<string, unknown>) {
  const action = [args.action, args.operation, args.mode]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return /\b(delete|remove|overwrite|replace|write|exec|shell|submit|click|type)\b/.test(action);
}

export function evaluateToolPermissionPolicy(params: {
  descriptor: ToolDescriptor;
  arguments: Record<string, unknown>;
}): ToolPermissionPolicyDecision {
  const reasons: string[] = [];
  let risk = defaultRisk(params.descriptor);

  if (params.descriptor.audit?.safeByDefault === false) {
    risk = maxRisk(risk, "medium");
    reasons.push("Tool is marked unsafe by default.");
  }

  if (hasDestructiveArgument(params.arguments)) {
    risk = maxRisk(risk, "medium");
    reasons.push("Arguments appear to request a state-changing action.");
  }

  if (params.descriptor.permission === "exec") {
    risk = maxRisk(risk, "high");
    reasons.push("Command execution can modify local state.");
  }

  if (params.descriptor.name === "delete_path") {
    risk = maxRisk(risk, "high");
    reasons.push("Tool can delete workspace files.");
  }

  if (params.descriptor.name.startsWith("browser_") && risk === "high") {
    reasons.push("Browser interaction can perform external side effects.");
  }

  if (!reasons.length) {
    reasons.push("Tool metadata indicates normal local execution risk.");
  }

  return {
    risk,
    approvalRequired: risk === "high",
    approvalRecommended: risk === "medium" || risk === "high",
    reasons,
  };
}
