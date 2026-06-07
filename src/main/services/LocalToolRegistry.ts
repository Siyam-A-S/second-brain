import * as z from "zod";
import type {
  ExportBoardPlaintextInput,
  FetchFileSegmentsInput,
  IngestAndRouteFragmentInput,
  SearchBoardTopologyInput
} from "../../shared/brain";
import type { GraphRagService } from "./GraphRagService";

export type LocalToolName =
  | "search_board_topology"
  | "fetch_file_segments"
  | "ingest_and_route_fragment"
  | "export_board_plaintext";

export type LocalToolSpec = {
  name: LocalToolName;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  inputSchemaJson: Record<string, unknown>;
};

export type LocalToolDefinition = LocalToolSpec & {
  execute: (input: unknown) => Promise<unknown>;
};

const searchBoardTopologySchema = {
  keywords: z.array(z.string()).default([])
};

const fetchFileSegmentsSchema = {
  uuid: z.string().min(1),
  sections: z.array(z.string()).optional()
};

const ingestAndRouteFragmentSchema = {
  raw_content: z.string().min(1),
  inferred_title: z.string().min(1),
  generated_summary: z.string(),
  target_parent_uuid: z.string().optional(),
  importance: z.number().min(0).max(1).optional(),
  context_hints: z.array(z.string()).optional()
};

const exportBoardPlaintextSchema = {
  root_uuid: z.string().optional(),
  include_body: z.boolean().optional()
};

export function createGraphRagToolRegistry(graphRag: GraphRagService): LocalToolDefinition[] {
  return [
    {
      name: "search_board_topology",
      title: "Search board topology",
      description: "Scan graph topology by keywords without returning markdown body text.",
      inputSchema: searchBoardTopologySchema,
      inputSchemaJson: {
        type: "object",
        properties: {
          keywords: { type: "array", items: { type: "string" } }
        },
        required: ["keywords"]
      },
      execute: async (input) => graphRag.searchBoardTopology(z.object(searchBoardTopologySchema).parse(input) as SearchBoardTopologyInput)
    },
    {
      name: "fetch_file_segments",
      title: "Fetch file segments",
      description: "Fetch the full markdown body or selected text beneath specific ## headers.",
      inputSchema: fetchFileSegmentsSchema,
      inputSchemaJson: {
        type: "object",
        properties: {
          uuid: { type: "string" },
          sections: { type: "array", items: { type: "string" } }
        },
        required: ["uuid"]
      },
      execute: async (input) => graphRag.fetchFileSegments(z.object(fetchFileSegmentsSchema).parse(input) as FetchFileSegmentsInput)
    },
    {
      name: "ingest_and_route_fragment",
      title: "Ingest and route fragment",
      description: "Create a new fragment markdown file and optionally link it from a parent node.",
      inputSchema: ingestAndRouteFragmentSchema,
      inputSchemaJson: {
        type: "object",
        properties: {
          raw_content: { type: "string" },
          inferred_title: { type: "string" },
          generated_summary: { type: "string" },
          target_parent_uuid: { type: "string" },
          importance: { type: "number", minimum: 0, maximum: 1 },
          context_hints: { type: "array", items: { type: "string" } }
        },
        required: ["raw_content", "inferred_title", "generated_summary"]
      },
      execute: async (input) => graphRag.ingestAndRouteFragment(z.object(ingestAndRouteFragmentSchema).parse(input) as IngestAndRouteFragmentInput)
    },
    {
      name: "export_board_plaintext",
      title: "Export board plaintext",
      description: "Export a whole board or topic subtree as plaintext context for other AI services.",
      inputSchema: exportBoardPlaintextSchema,
      inputSchemaJson: {
        type: "object",
        properties: {
          root_uuid: { type: "string" },
          include_body: { type: "boolean" }
        }
      },
      execute: async (input) => graphRag.exportBoardPlaintext(z.object(exportBoardPlaintextSchema).parse(input) as ExportBoardPlaintextInput)
    }
  ];
}

export function filterLocalToolSpecs(tools: LocalToolDefinition[], names?: LocalToolName[]): LocalToolSpec[] {
  const allowed = names ? new Set<LocalToolName>(names) : null;
  return tools
    .filter((tool) => !allowed || allowed.has(tool.name))
    .map(({ name, title, description, inputSchema, inputSchemaJson }) => ({
      name,
      title,
      description,
      inputSchema,
      inputSchemaJson
    }));
}
