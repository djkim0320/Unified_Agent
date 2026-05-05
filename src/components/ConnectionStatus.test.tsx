import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionStatus } from "./ConnectionStatus";
import type { ProviderSummary } from "../types";

const provider: ProviderSummary = {
  accountId: null,
  configured: true,
  displayName: "Local OpenAI",
  email: null,
  kind: "openai",
  label: "OpenAI",
  metadata: {},
  status: "connected",
};

describe("ConnectionStatus", () => {
  it("shows a checking state before the backend health probe completes", () => {
    render(
      <ConnectionStatus
        backendOnline={null}
        modelCount={0}
        modelsError={null}
        modelsLoading={false}
        provider={provider}
      />,
    );

    expect(screen.getByLabelText("서버 확인 중")).toHaveClass("is-checking");
    expect(screen.getByText("백엔드 연결 상태를 확인하는 중입니다.")).toBeInTheDocument();
  });

  it("shows a normal system status when the backend is reachable", () => {
    render(
      <ConnectionStatus
        backendOnline
        modelCount={3}
        modelsError={null}
        modelsLoading={false}
        provider={provider}
      />,
    );

    expect(screen.getByLabelText("정상")).toBeInTheDocument();
    expect(screen.getByText("3개 모델 사용 가능")).toBeInTheDocument();
  });

  it("shows a red offline state when the backend is unreachable", () => {
    render(
      <ConnectionStatus
        backendOnline={false}
        modelCount={0}
        modelsError={null}
        modelsLoading={false}
        provider={provider}
      />,
    );

    expect(screen.getByLabelText("서버 오프라인")).toHaveClass("is-backend-offline");
    expect(screen.getByText("백엔드 서버 응답이 없습니다.")).toBeInTheDocument();
  });
});
