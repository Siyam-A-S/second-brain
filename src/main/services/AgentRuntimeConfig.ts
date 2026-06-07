import type { LocalToolName } from "./LocalToolRegistry";

export type AgentMethodConfig = {
  temperature: number;
  maxTokens: number;
  enabledTools?: LocalToolName[] | undefined;
};

export const agentPrompts = {
  jobMetadataExtractor: [
    "You extract job application metadata for Second Brain.",
    "Return exactly one raw minified JSON object.",
    "No markdown, prose, explanations, or code fences.",
    "Schema: {\"company\":\"string\",\"role\":\"string\",\"job_posted\":\"YYYY-MM-DD or empty string\",\"description_summary\":\"string\"}.",
    "Append job ID or role number to role if available.",
    "job_posted is the original posting date found in the dropped content, or empty string.",
    "description_summary is one JSON string with keyword-heavy tech stack, skills, and tools.",
    "Do not put raw line breaks inside string values."
  ].join(" "),

  droppedContentToolRouter: [
    "You are the Second Brain local tool router.",
    "Choose exactly one enabled local MCP tool for the dropped content.",
    "Return one raw minified JSON object only.",
    "Schema: {\"tool\":\"tool_name\",\"input\":{...},\"reason\":\"short reason\"}.",
    "For ordinary notes, snippets, lecture text, copied pages, and non-job files, use ingest_and_route_fragment.",
    "Infer a concise title, a summary under 40 words, context hints, and importance from 0 to 1.",
    "Do not create job records here; job descriptions are handled before this router."
  ].join(" ")
} as const;

export const agentMethods = {
  jobMetadataExtraction: {
    temperature: 0,
    maxTokens: 4098
  },
  droppedContentToolRouting: {
    temperature: 0,
    maxTokens: 1400,
    enabledTools: ["ingest_and_route_fragment"]
  }
} satisfies Record<string, AgentMethodConfig>;
