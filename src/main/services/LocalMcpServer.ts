import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServerStatus } from "../../shared/brain";
import { GraphRagService } from "./GraphRagService";
import { createGraphRagToolRegistry, filterLocalToolSpecs, type LocalToolDefinition, type LocalToolName, type LocalToolSpec } from "./LocalToolRegistry";

type LocalMcpServerOptions = {
  graphRag: GraphRagService;
  port?: number;
  host?: string;
  tools?: LocalToolDefinition[] | undefined;
};

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
  private readonly tools: LocalToolDefinition[];

  constructor(private readonly options: LocalMcpServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.actualPort = options.port ?? 4127;
    this.tools = options.tools ?? createGraphRagToolRegistry(options.graphRag);
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

  listToolSpecs(names?: LocalToolName[]): LocalToolSpec[] {
    return filterLocalToolSpecs(this.tools, names);
  }

  async callLocalTool(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.find((candidate) => candidate.name === name);

    if (!tool) {
      throw new Error(`Unknown local MCP tool "${name}".`);
    }

    return tool.execute(input);
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

    for (const tool of this.tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema
        },
        async (input) => toolText(await tool.execute(input))
      );
    }

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
