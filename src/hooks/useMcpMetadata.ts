import { useRef, useState } from "react";
import { abortRef, beginRequest } from "../appStateUtils";
import { getMcpCatalog, getMcpConfigStatus, validateMcpSnippet } from "../api";
import type { McpConfigStatus, McpServerSummary, McpSnippetValidationResult } from "../types";

interface UseMcpMetadataOptions {
  onNotice?: (message: string) => void;
}

/**
 * Owns read-only opencode MCP metadata state for the Extensions tab.
 *
 * AetherOps intentionally does not execute MCP servers. This hook only loads
 * catalog/config metadata and validates snippets before users copy them into
 * opencode configuration.
 */
export function useMcpMetadata({ onNotice }: UseMcpMetadataOptions = {}) {
  const [mcpCatalog, setMcpCatalog] = useState<McpServerSummary[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpConfigStatus | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpSnippetValidation, setMcpSnippetValidation] =
    useState<McpSnippetValidationResult | null>(null);

  const mcpMetadataSeqRef = useRef(0);
  const mcpMetadataControllerRef = useRef<AbortController | null>(null);

  async function refreshMcpMetadata() {
    const request = beginRequest(mcpMetadataSeqRef, mcpMetadataControllerRef);
    setMcpLoading(true);

    try {
      const [catalogResponse, statusResponse] = await Promise.all([
        getMcpCatalog(request.controller.signal),
        getMcpConfigStatus(request.controller.signal),
      ]);
      if (request.controller.signal.aborted || mcpMetadataSeqRef.current !== request.seq) {
        return;
      }
      setMcpCatalog(catalogResponse.servers);
      setMcpStatus(statusResponse.status);
    } catch (error) {
      if (request.controller.signal.aborted || mcpMetadataSeqRef.current !== request.seq) {
        return;
      }
      onNotice?.(error instanceof Error ? error.message : "MCP 설정 정보를 불러오지 못했습니다.");
    } finally {
      if (mcpMetadataSeqRef.current === request.seq) {
        setMcpLoading(false);
        abortRef(mcpMetadataControllerRef);
      }
    }
  }

  async function handleValidateMcpSnippet(snippet: string) {
    try {
      const response = await validateMcpSnippet(snippet);
      setMcpSnippetValidation(response.validation);
      onNotice?.(
        response.validation.ok
          ? "MCP 스니펫 검증을 통과했습니다."
          : "MCP 스니펫에 확인할 항목이 있습니다.",
      );
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "MCP 스니펫 검증에 실패했습니다.");
    }
  }

  function abortMcpMetadataRequests() {
    abortRef(mcpMetadataControllerRef);
  }

  return {
    abortMcpMetadataRequests,
    handleValidateMcpSnippet,
    mcpCatalog,
    mcpLoading,
    mcpSnippetValidation,
    mcpStatus,
    refreshMcpMetadata,
  };
}
