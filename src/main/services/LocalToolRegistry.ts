import * as z from "zod";
import type {
  ExportBoardPlaintextInput,
  FetchFileSegmentsInput,
  GraphifyContextResult,
  IngestAndRouteFragmentInput,
  SearchBoardTopologyInput
} from "../../shared/brain";
import type { GraphRagService } from "./GraphRagService";
import type { GraphifyContextService } from "./GraphifyContextService";
import type { ArtifactToolService, CreateToolArtifactInput } from "./ArtifactToolService";

export type LocalToolName =
  | "search_board_topology"
  | "fetch_file_segments"
  | "ingest_and_route_fragment"
  | "export_board_plaintext"
  | "query_graphify_context"
  | "explain_graph_node"
  | "trace_graph_path"
  | "create_markdown_artifact"
  | "create_pdf_artifact"
  | "create_docx_artifact"
  | "create_xlsx_artifact"
  | "create_image_artifact";

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

const queryGraphifyContextSchema = {
  question: z.string().min(1),
  budget: z.number().min(250).max(4000).optional()
};

const explainGraphNodeSchema = {
  nodeIdOrLabel: z.string().min(1)
};

const traceGraphPathSchema = {
  from: z.string().min(1),
  to: z.string().min(1)
};

const createArtifactSchema = {
  filename: z.string().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  astPayload: z.unknown().optional(),
  ast_payload: z.unknown().optional(),
  contentBase64: z.string().optional(),
  mimeType: z.string().optional(),
  documentType: z.string().optional()
};

export function createGraphRagToolRegistry(graphRag: GraphRagService): LocalToolDefinition[] {
  return createLocalToolRegistry({ graphRag });
}

export function createLocalToolRegistry(options: {
  graphRag: GraphRagService;
  graphifyContext?: GraphifyContextService | undefined;
  artifactTools?: ArtifactToolService | undefined;
}): LocalToolDefinition[] {
  const { graphRag } = options;
  const tools: LocalToolDefinition[] = [
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

  if (options.graphifyContext) {
    tools.push(
      {
        name: "query_graphify_context",
        title: "Query Graphify context",
        description: "Run a bounded Graphify query against the active project's local graph.",
        inputSchema: queryGraphifyContextSchema,
        inputSchemaJson: {
          type: "object",
          properties: {
            question: { type: "string" },
            budget: { type: "number", minimum: 250, maximum: 4000 }
          },
          required: ["question"]
        },
        execute: async (input): Promise<GraphifyContextResult> => {
          const parsed = z.object(queryGraphifyContextSchema).parse(input);
          return options.graphifyContext?.query(parsed.question, parsed.budget) as Promise<GraphifyContextResult>;
        }
      },
      {
        name: "explain_graph_node",
        title: "Explain graph node",
        description: "Run Graphify explain for one local graph node or label.",
        inputSchema: explainGraphNodeSchema,
        inputSchemaJson: {
          type: "object",
          properties: {
            nodeIdOrLabel: { type: "string" }
          },
          required: ["nodeIdOrLabel"]
        },
        execute: async (input): Promise<GraphifyContextResult> => {
          const parsed = z.object(explainGraphNodeSchema).parse(input);
          return options.graphifyContext?.explain(parsed.nodeIdOrLabel) as Promise<GraphifyContextResult>;
        }
      },
      {
        name: "trace_graph_path",
        title: "Trace graph path",
        description: "Run Graphify path between two local graph nodes or labels.",
        inputSchema: traceGraphPathSchema,
        inputSchemaJson: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" }
          },
          required: ["from", "to"]
        },
        execute: async (input): Promise<GraphifyContextResult> => {
          const parsed = z.object(traceGraphPathSchema).parse(input);
          return options.graphifyContext?.tracePath(parsed.from, parsed.to) as Promise<GraphifyContextResult>;
        }
      }
    );
  }

  if (options.artifactTools) {
    const artifactTools = options.artifactTools;
    const artifactTool = (
      name: LocalToolName,
      title: string,
      description: string,
      extension: string,
      mimeType: string
    ): LocalToolDefinition => ({
      name,
      title,
      description,
      inputSchema: createArtifactSchema,
      inputSchemaJson: {
        type: "object",
        properties: {
          filename: { type: "string" },
          title: { type: "string" },
          text: { type: "string" },
          astPayload: {
            type: "object",
            description:
              "Structured artifact AST for PDFs and presentation decks: {meta:{filename,title,layout_mode,primary_color},nodes:[{type,text,spans,bold_prefix}]}"
          },
          ast_payload: {
            type: "object",
            description: "Snake_case alias for astPayload."
          },
          contentBase64: { type: "string" },
          mimeType: { type: "string" },
          documentType: {
            type: "string",
            description: "Document layout hint such as letter, summary, resume, report, proposal, invoice, spreadsheet, or diagram."
          }
        }
      },
      execute: async (input) =>
        artifactTools.createArtifact(
          z.object(createArtifactSchema).parse(input) as CreateToolArtifactInput,
          {
            extension,
            mimeType,
            fallbackText:
              "This artifact was created by a local MCP tool. Provide contentBase64 for binary-specific output."
          }
        )
    });

    tools.push(
      artifactTool(
        "create_markdown_artifact",
        "Create Markdown artifact",
        "Create a Markdown chat artifact from structured Markdown text. Use documentType to request letter, summary, resume, report, proposal, or similar layout.",
        ".md",
        "text/markdown"
      ),
      artifactTool(
        "create_pdf_artifact",
        "Create PDF artifact",
        "Create a formatted PDF artifact from a structured AST payload, or from contentBase64 containing PDF bytes. Use PORTRAIT for reports/letters and LANDSCAPE for presentation decks.",
        ".pdf",
        "application/pdf"
      ),
      artifactTool(
        "create_docx_artifact",
        "Create DOCX artifact",
        "Create a formatted DOCX artifact from structured Markdown text, or from contentBase64 containing DOCX bytes. Use documentType for letter, summary, resume, report, proposal, or similar layout.",
        ".docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ),
      artifactTool(
        "create_xlsx_artifact",
        "Create XLSX artifact",
        "Create an XLSX artifact from a Markdown table or structured rows in text, or from contentBase64 containing XLSX bytes.",
        ".xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ),
      artifactTool(
        "create_image_artifact",
        "Create image artifact",
        "Create an SVG image artifact. Prefer contentBase64 containing image bytes when a different image format is required.",
        ".svg",
        "image/svg+xml"
      )
    );
  }

  return tools;
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
