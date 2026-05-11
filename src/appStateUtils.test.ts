import { describe, expect, it } from "vitest";
import { displayConversationTitle } from "./appStateUtils";

describe("displayConversationTitle", () => {
  it("hides path-like stored titles and keeps a readable session name", () => {
    expect(displayConversationTitle("D:\\AI\\통합 에이전트\\workspace\\opencode\\agents\\agent-1\\sessions\\session-name")).toBe(
      "session-name",
    );
    expect(displayConversationTitle("workspace/opencode/agents/default-agent/sessions/11111111-1111-4111-8111-111111111111")).toBe(
      "새 채팅",
    );
  });
});
