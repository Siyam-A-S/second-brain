import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod";
import type {
  ExportBoardPlaintextInput,
  FetchFileSegmentsInput,
  IngestAndRouteFragmentInput,
  McpServerStatus,
  SearchBoardTopologyInput
} from "../../shared/brain";
import { GraphRagService } from "./GraphRagService";

type LocalMcpServerOptions = {
  graphRag: GraphRagService;
  port?: number;
  host?: string;
};

const searchBoardTopologySchema = {
  keywords: z.array(z.string()).default([])
};
const searchBoardTopologyInputSchema = z.object(searchBoardTopologySchema);

const fetchFileSegmentsSchema = {
  uuid: z.string().min(1),
  sections: z.array(z.string()).optional()
};
const fetchFileSegmentsInputSchema = z.object(fetchFileSegmentsSchema);

const ingestAndRouteFragmentSchema = {
  raw_content: z.string().min(1),
  inferred_title: z.string().min(1),
  generated_summary: z.string(),
  target_parent_uuid: z.string().optional()
};
const ingestAndRouteFragmentInputSchema = z.object(ingestAndRouteFragmentSchema);

const exportBoardPlaintextSchema = {
  root_uuid: z.string().optional(),
  include_body: z.boolean().optional()
};
const exportBoardPlaintextInputSchema = z.object(exportBoardPlaintextSchema);

function toolText(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : undefined;
}

export class LocalMcpServer {
  private server: Server | null = null;
  private actualPort: number;
  private readonly host: string;

  constructor(private readonly options: LocalMcpServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.actualPort = options.port ?? 4127;
  }

  async start(): Promise<McpServerStatus> {
    if (this.server) {
      return this.getStatus();
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        this.server?.once("error", reject);
        this.server?.listen(this.actualPort, this.host, () => {
          const address = this.server?.address();

          if (address && typeof address === "object") {
            this.actualPort = address.port;
          }

          this.server?.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      this.server?.close();
      this.server = null;
      throw error;
    }

    return this.getStatus();
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const closingServer = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      closingServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  getStatus(): McpServerStatus {
    return {
      running: Boolean(this.server),
      url: `http://${this.host}:${this.actualPort}/mcp`,
      port: this.actualPort
    };
  }

  async callLocalTool(name: "search_board_topology", input: SearchBoardTopologyInput): Promise<unknown>;
  async callLocalTool(name: "fetch_file_segments", input: FetchFileSegmentsInput): Promise<unknown>;
  async callLocalTool(name: "ingest_and_route_fragment", input: IngestAndRouteFragmentInput): Promise<unknown>;
  async callLocalTool(name: "export_board_plaintext", input: ExportBoardPlaintextInput): Promise<unknown>;
  async callLocalTool(name: string, input: unknown): Promise<unknown> {
    switch (name) {
      case "search_board_topology":
        return this.options.graphRag.searchBoardTopology(searchBoardTopologyInputSchema.parse(input));
      case "fetch_file_segments":
        return this.options.graphRag.fetchFileSegments(fetchFileSegmentsInputSchema.parse(input));
      case "ingest_and_route_fragment":
        return this.options.graphRag.ingestAndRouteFragment(ingestAndRouteFragmentInputSchema.parse(input));
      case "export_board_plaintext":
        return this.options.graphRag.exportBoardPlaintext(exportBoardPlaintextInputSchema.parse(input));
      default:
        throw new Error(`Unknown local MCP tool "${name}".`);
    }
  }

  private createMcpServer(): McpServer {
    const server = new McpServer(
      {
        name: "second-brain-local",
        version: "0.1.0"
      },
      {
        capabilities: {
          logging: {}
        }
      }
    );

    server.registerTool(
      "search_board_topology",
      {
        title: "Search board topology",
        description: "Scan graph topology by keywords without returning markdown body text.",
        inputSchema: searchBoardTopologySchema
      },
      async (input) => toolText(await this.options.graphRag.searchBoardTopology(input))
    );

    server.registerTool(
      "fetch_file_segments",
      {
        title: "Fetch file segments",
        description: "Fetch the full markdown body or selected text beneath specific ## headers.",
        inputSchema: fetchFileSegmentsSchema
      },
      async (input) => toolText(await this.options.graphRag.fetchFileSegments(input))
    );

    server.registerTool(
      "ingest_and_route_fragment",
      {
        title: "Ingest and route fragment",
        description: "Create a new fragment markdown file and optionally link it from a parent node.",
        inputSchema: ingestAndRouteFragmentSchema
      },
      async (input) => toolText(await this.options.graphRag.ingestAndRouteFragment(input))
    );

    server.registerTool(
      "export_board_plaintext",
      {
        title: "Export board plaintext",
        description: "Export a whole board or topic subtree as plaintext context for other AI services.",
        inputSchema: exportBoardPlaintextSchema
      },
      async (input) => toolText(await this.options.graphRag.exportBoardPlaintext(input))
    );

    return server;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url !== "/mcp") {
      response.writeHead(404).end("Not found");
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405, { "content-type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Method not allowed."
          },
          id: null
        })
      );
      return;
    }

    const server = this.createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);

    try {
      const parsedBody = await readJsonBody(request);
      await server.connect(transport as unknown as Parameters<McpServer["connect"]>[0]);
      await transport.handleRequest(request, response, parsedBody);
    } catch (error) {
      console.error("Error handling MCP request", error);

      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error"
            },
            id: null
          })
        );
      }
    } finally {
      await transport.close();
      await server.close();
    }
  }
}
