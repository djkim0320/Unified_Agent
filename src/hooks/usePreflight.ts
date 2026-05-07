import { useRef, useState } from "react";
import { getPreflightStatus } from "../lib/api";
import type { PreflightResponse } from "../types";
import { abortRef, beginRequest } from "../appStateUtils";

interface UsePreflightOptions {
  getActiveAgentId: () => string | null;
  getActiveConversationId: () => string | null;
}

export function usePreflight({
  getActiveAgentId,
  getActiveConversationId,
}: UsePreflightOptions) {
  const [preflightStatus, setPreflightStatus] = useState<PreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const preflightSeqRef = useRef(0);
  const preflightControllerRef = useRef<AbortController | null>(null);

  const abortPreflightRequests = () => {
    abortRef(preflightControllerRef);
  };

  const clearPreflight = () => {
    setPreflightStatus(null);
  };

  const refreshPreflight = async (
    agentId = getActiveAgentId(),
    conversationId = getActiveConversationId(),
  ) => {
    const request = beginRequest(preflightSeqRef, preflightControllerRef);
    setPreflightLoading(true);
    try {
      const response = await getPreflightStatus({ agentId, conversationId }, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        preflightSeqRef.current !== request.seq ||
        getActiveAgentId() !== agentId ||
        getActiveConversationId() !== conversationId
      ) {
        return;
      }
      setPreflightStatus(response);
    } catch (error) {
      if (request.controller.signal.aborted || preflightSeqRef.current !== request.seq) {
        return;
      }
      setPreflightStatus({
        ok: false,
        checks: [
          {
            id: "preflight-fetch",
            label: "Preflight",
            status: "error",
            message: error instanceof Error ? error.message : "실행 전 점검을 불러오지 못했습니다.",
          },
        ],
      });
    } finally {
      if (preflightSeqRef.current === request.seq) {
        setPreflightLoading(false);
        abortRef(preflightControllerRef);
      }
    }
  };

  return {
    abortPreflightRequests,
    clearPreflight,
    preflightLoading,
    preflightStatus,
    refreshPreflight,
  };
}
