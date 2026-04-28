import { useCallback, useState } from "react";
import type {
  ComputerUseActionEventRecord,
  ComputerUseSessionDetail,
  ComputerUseSettingsRecord,
} from "../types";

type ClickOptions = {
  visibleText?: string;
  maySubmit?: boolean;
  mayChangeState?: boolean;
  mayDelete?: boolean;
  mayUpload?: boolean;
  mayDownload?: boolean;
  mayPurchase?: boolean;
};

export function useComputerUse(_params: {
  activeAgentId: string | null;
  activeConversationId: string | null;
}) {
  const [computerUseAllowlistDraft, setComputerUseAllowlistDraft] = useState("");
  const [computerUseClickSelector, setComputerUseClickSelector] = useState("");
  const [computerUseNavigationUrl, setComputerUseNavigationUrl] = useState("http://127.0.0.1:5173");
  const disabledMessage =
    "Computer Use는 opencode-only 모드에서 AetherOps 직접 기능으로 제공되지 않습니다. 브라우저/컴퓨터 제어는 opencode MCP 또는 opencode 지원 통합으로 연결해 주세요.";
  const disabledSettings: ComputerUseSettingsRecord = {
    enabled: false,
    customBrowserHarnessEnabled: false,
    allowExternalDomains: [],
    allowFileUrls: false,
    maxActionsPerSession: 0,
    sessionTimeoutMs: 0,
    updatedAt: Date.now(),
  };

  const disabled = useCallback(async () => {
    return undefined;
  }, []);

  return {
    computerUseAllowlistDraft,
    computerUseClickSelector,
    computerUseDetail: null as ComputerUseSessionDetail | null,
    computerUseError: disabledMessage,
    computerUseLoading: false,
    computerUseNavigationUrl,
    computerUseSettings: disabledSettings,
    handleApproveComputerUseAction: (_event: ComputerUseActionEventRecord) => disabled(),
    handleClickComputerUseSession: (_options?: ClickOptions) => disabled(),
    handleCloseComputerUseSession: disabled,
    handleCreateComputerUseSession: disabled,
    handleDenyComputerUseAction: (_event: ComputerUseActionEventRecord) => disabled(),
    handleNavigateComputerUseSession: disabled,
    handleSaveComputerUseSettings: disabled,
    handleScreenshotComputerUseSession: disabled,
    handleSensitiveTypeComputerUseSession: disabled,
    handleToggleComputerUseEnabled: disabled,
    loadComputerUseSettings: async () => disabledSettings,
    refreshComputerUseSession: async () => undefined,
    setComputerUseAllowlistDraft,
    setComputerUseClickSelector,
    setComputerUseNavigationUrl,
  };
}
