import { useRef, useState } from "react";
import { abortRef, beginRequest } from "../appStateUtils";
import {
  createCustomSkillTemplate,
  deleteCustomSkillTemplate,
  listSkillTemplates,
  updateCustomSkillTemplate,
} from "../api";
import type { SkillTemplateRecord } from "../types";

export type CustomSkillTemplateCreatePayload = Parameters<typeof createCustomSkillTemplate>[1];
export type CustomSkillTemplateUpdatePayload = Parameters<typeof updateCustomSkillTemplate>[2];

interface UseSkillTemplatesOptions {
  onNotice?: (message: string) => void;
}

/**
 * Owns Skill template catalog state.
 *
 * Skills are reusable prompt/flow/standing-order templates only. This hook
 * intentionally does not create any executable plugin/runtime behavior.
 */
export function useSkillTemplates({ onNotice }: UseSkillTemplatesOptions = {}) {
  const [skillTemplates, setSkillTemplates] = useState<SkillTemplateRecord[]>([]);
  const [skillTemplatesLoading, setSkillTemplatesLoading] = useState(false);

  const skillTemplatesSeqRef = useRef(0);
  const skillTemplatesControllerRef = useRef<AbortController | null>(null);

  async function refreshSkillTemplates(agentId?: string | null) {
    const request = beginRequest(skillTemplatesSeqRef, skillTemplatesControllerRef);
    setSkillTemplatesLoading(true);

    try {
      const response = await listSkillTemplates(agentId, request.controller.signal);
      if (request.controller.signal.aborted || skillTemplatesSeqRef.current !== request.seq) {
        return;
      }
      setSkillTemplates(response.templates);
    } catch (error) {
      if (request.controller.signal.aborted || skillTemplatesSeqRef.current !== request.seq) {
        return;
      }
      onNotice?.(error instanceof Error ? error.message : "Skill 템플릿을 불러오지 못했습니다.");
    } finally {
      if (skillTemplatesSeqRef.current === request.seq) {
        setSkillTemplatesLoading(false);
        abortRef(skillTemplatesControllerRef);
      }
    }
  }

  async function createTemplate(agentId: string, payload: CustomSkillTemplateCreatePayload) {
    setSkillTemplatesLoading(true);
    try {
      const response = await createCustomSkillTemplate(agentId, payload);
      setSkillTemplates((current) => [
        response.template,
        ...current.filter((template) => template.id !== response.template.id),
      ]);
      onNotice?.(`${response.template.name} Skill을 저장했습니다.`);
      return response.template;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "Skill 저장에 실패했습니다.");
      return null;
    } finally {
      setSkillTemplatesLoading(false);
    }
  }

  async function updateTemplate(
    agentId: string,
    templateId: string,
    payload: CustomSkillTemplateUpdatePayload,
  ) {
    setSkillTemplatesLoading(true);
    try {
      const response = await updateCustomSkillTemplate(agentId, templateId, payload);
      setSkillTemplates((current) =>
        current.map((item) => (item.id === response.template.id ? response.template : item)),
      );
      onNotice?.(`${response.template.name} Skill을 업데이트했습니다.`);
      return response.template;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "Skill 업데이트에 실패했습니다.");
      return null;
    } finally {
      setSkillTemplatesLoading(false);
    }
  }

  async function deleteTemplate(agentId: string, template: SkillTemplateRecord) {
    try {
      await deleteCustomSkillTemplate(agentId, template.id);
      setSkillTemplates((current) => current.filter((item) => item.id !== template.id));
      onNotice?.(`${template.name} Skill을 삭제했습니다.`);
      return true;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "Skill 삭제에 실패했습니다.");
      return false;
    }
  }

  function abortSkillTemplateRequests() {
    abortRef(skillTemplatesControllerRef);
  }

  return {
    abortSkillTemplateRequests,
    createTemplate,
    deleteTemplate,
    refreshSkillTemplates,
    skillTemplates,
    skillTemplatesLoading,
    updateTemplate,
  };
}
