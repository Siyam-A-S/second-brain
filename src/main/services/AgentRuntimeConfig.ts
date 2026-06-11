import type { LocalToolName } from "./LocalToolRegistry";

export type AgentMethodConfig = {
  temperature: number;
  maxTokens: number;
  enabledTools?: LocalToolName[] | undefined;
};

export const agentPrompts = {
  droppedContentToolRouter: [
    "You are the Second Brain local tool router.",
    "Choose exactly one enabled local MCP tool for the dropped content.",
    "Return one raw minified JSON object only.",
    "Schema: {\"tool\":\"tool_name\",\"input\":{...},\"reason\":\"short reason\"}.",
    "For notes, snippets, lecture text, copied pages, and documents, use ingest_and_route_fragment.",
    "Infer a concise title, a summary under 40 words, context hints, and importance from 0 to 1.",
    "Use the enabled tool schema literally."
  ].join(" ")
} as const;

export const agentMethods = {
  cardDefinition: {
    temperature: 0.2,
    maxTokens: 8192
  },
  trackerExtraction: {
    temperature: 0,
    maxTokens: 8192
  },
  droppedContentToolRouting: {
    temperature: 0,
    maxTokens: 4096,
    enabledTools: ["ingest_and_route_fragment"]
  }
} satisfies Record<string, AgentMethodConfig>;
