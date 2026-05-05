import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CockpitOpsDrawer } from "./CockpitPanels";
import type { PlatformMetadata } from "../types";

function renderDrawer(platformMetadata: PlatformMetadata | null) {
  return render(
    <CockpitOpsDrawer
      activeConversation={null}
      changedFiles={[]}
      liveEvents={[]}
      onOpenWorkspace={vi.fn()}
      platformMetadata={platformMetadata}
      runEvents={null}
      selectedTaskFlow={null}
      taskFlows={[]}
    />,
  );
}

describe("CockpitOpsDrawer", () => {
  it("does not fake opencode extension connections when no external tools are registered", () => {
    renderDrawer({
      agentSkills: [],
      channels: [],
      plugins: [],
      tools: [],
    });

    expect(screen.getByText("opencode 확장 상태")).toBeInTheDocument();
    expect(
      screen.getByText("AetherOps 내부 MCP/도구 런타임은 비활성화되어 있습니다. 확장 기능은 opencode 설정에서 연결하세요."),
    ).toBeInTheDocument();
    expect(screen.queryByText("filesystem")).not.toBeInTheDocument();
    expect(screen.queryByText("opencode에서 자동 가능")).not.toBeInTheDocument();
  });

  it("shows actual opencode extension metadata when available", () => {
    renderDrawer({
      agentSkills: [],
      channels: [],
      plugins: [],
      tools: [
        {
          batchable: false,
          concurrencyClass: null,
          costHint: null,
          description: "Mock MCP bridge",
          name: "mcp.filesystem.search",
          permission: "network",
          risk: "medium",
          rolePolicy: null,
          audit: {
            category: "mcp",
            safeByDefault: false,
          },
        },
      ],
    });

    expect(screen.getByText("mcp.filesystem.search")).toBeInTheDocument();
    expect(screen.getByText("opencode 정책 확인 필요")).toBeInTheDocument();
  });
});
