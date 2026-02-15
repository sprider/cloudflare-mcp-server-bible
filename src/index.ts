import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface Env {
  BIBLE_API_KEY?: string;
  BIBLE_ID?: string;
  BASE_URL?: string;
}

interface BibleAPIResponse {
  data?: any;
  meta?: any;
}

interface ContentItem {
  type?: string;
  text?: string;
  items?: ContentItem[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Cache-Control, X-Requested-With",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    
    if (url.pathname === "/health") {
      return new Response("OK", { 
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        }
      });
    }
    
    // Handle MCP requests on /sse endpoint
    if (url.pathname === "/sse") {
      if (request.method === "GET") {
        return handleSSE(request, env);
      }
      if (request.method === "POST") {
        return handleMCP(request, env);
      }
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          "Access-Control-Allow-Origin": "*",
          Allow: "GET, POST, OPTIONS",
        },
      });
    }
    
    return new Response("Bible MCP Server - Cloudflare Worker", { 
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
      }
    });
  },
};

class BibleAPIClient {
  private apiKey: string;
  private bibleId: string;
  private baseUrl: string;

  constructor(env: Env) {
    this.apiKey = env.BIBLE_API_KEY || "";
    this.bibleId = env.BIBLE_ID || "de4e12af7f28f599-02";
    this.baseUrl = env.BASE_URL || "https://api.scripture.api.bible/v1";
    
    if (!this.apiKey) {
      throw new Error("BIBLE_API_KEY environment variable is required");
    }
  }

  private async makeRequest(endpoint: string, params?: Record<string, string>): Promise<BibleAPIResponse> {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      headers: {
        "api-key": this.apiKey,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Bible API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getBooks(): Promise<BibleAPIResponse> {
    return this.makeRequest(`bibles/${this.bibleId}/books`);
  }

  async getChapters(bookId: string): Promise<BibleAPIResponse> {
    return this.makeRequest(`bibles/${this.bibleId}/books/${bookId}/chapters`);
  }

  async getVerse(verseId: string, params?: Record<string, string>): Promise<BibleAPIResponse> {
    const defaultParams = {
      "content-type": "text",
      "include-notes": "false",
      "include-titles": "false",
      "include-chapter-numbers": "false",
      "include-verse-numbers": "false",
      "include-verse-spans": "false",
      "use-org-id": "false",
    };
    
    return this.makeRequest(`bibles/${this.bibleId}/verses/${verseId}`, {
      ...defaultParams,
      ...params,
    });
  }

  async getPassage(passageId: string, params?: Record<string, string>): Promise<BibleAPIResponse> {
    const defaultParams = {
      "content-type": "json",
      "include-notes": "false",
      "include-titles": "false",
      "include-chapter-numbers": "false",
      "include-verse-numbers": "false",
      "include-verse-spans": "false",
      "use-org-id": "false",
    };
    
    return this.makeRequest(`bibles/${this.bibleId}/passages/${passageId}`, {
      ...defaultParams,
      ...params,
    });
  }

  async searchVerses(query: string, limit: number = 10, params?: Record<string, string>): Promise<BibleAPIResponse> {
    const defaultParams = {
      query,
      limit: limit.toString(),
      sort: "relevance",
      fuzziness: "AUTO",
    };
    
    return this.makeRequest(`bibles/${this.bibleId}/search`, {
      ...defaultParams,
      ...params,
    });
  }
}

function extractTextFromContent(contentItems: ContentItem[]): string {
  const textParts: string[] = [];

  function extractText(item: ContentItem): string {
    if (typeof item === 'object' && item !== null) {
      if (item.type === "text") {
        return item.text || "";
      } else if (item.items) {
        return item.items.map(extractText).join("");
      }
    } else if (Array.isArray(item)) {
      return item.map(extractText).join("");
    }
    return "";
  }

  for (const item of contentItems) {
    textParts.push(extractText(item));
  }

  return textParts.join("").trim();
}

async function handleSSE(request: Request, env: Env): Promise<Response> {
  // Create a proper SSE stream for MCP over SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  
  // Handle the SSE connection
  const handleConnection = async () => {
    const closeWriter = () => writer.close().catch(() => {});
    let keepAlive: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
      closeWriter();
    };

    try {
      // According to MCP spec, SSE should establish connection and wait for messages
      // Don't send anything initially - the client will send requests via a separate channel

      // Keep the connection alive with periodic comments (SSE spec)
      keepAlive = setInterval(async () => {
        try {
          await writer.write(encoder.encode(": keepalive\n\n"));
        } catch (e) {
          cleanup();
        }
      }, 30000);

      // Clean up on abort
      request.signal?.addEventListener("abort", cleanup);

      // Clean up when stream/writer closes
      writer.closed.then(cleanup).catch(() => cleanup());
    } catch (error) {
      console.error("SSE connection error:", error);
      cleanup();
    }
  };
  
  handleConnection();
  
  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Cache-Control, X-Requested-With",
    },
  });
}

async function handleMCP(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as any;
    
    // Handle empty body or invalid JSON
    if (!body) {
      return createErrorResponse(null, -32700, "Parse error: empty request body");
    }

    // Validate JSON-RPC format - but be more lenient for testing
    if (body.jsonrpc && body.jsonrpc !== "2.0") {
      return createErrorResponse(body.id, -32600, "Invalid Request: invalid jsonrpc version");
    }

    // Set default jsonrpc if missing
    if (!body.jsonrpc) {
      body.jsonrpc = "2.0";
    }

    if (!body.method) {
      return createErrorResponse(body.id, -32600, "Invalid Request: missing method");
    }

    const bibleClient = new BibleAPIClient(env);
    
    // Handle different MCP methods
    switch (body.method) {
      case "initialize":
        return createSuccessResponse(body.id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "bible-server",
            version: "1.0.0",
          },
        });

      case "tools/list":
        return createSuccessResponse(body.id, {
          tools: [
            {
              name: "bible_content",
              title: "Bible Content",
              description: "Read and search Bible verses. Actions: search - Find verses by text (requires query); verse - Single verse e.g. GEN.1.1 (requires verse_id); passage - Verse range e.g. GEN.1.1-GEN.1.5 (requires passage_id); chapter - Full chapter (requires book_id, chapter). Use concise (default) for summaries; use detailed for verse numbers and full context.",
              inputSchema: {
                type: "object",
                properties: {
                  action: {
                    type: "string",
                    enum: ["search", "verse", "passage", "chapter"],
                    description: "Action to perform",
                  },
                  query: {
                    type: "string",
                    description: "Search query (required for search action)",
                  },
                  verse_id: {
                    type: "string",
                    description: "Verse ID in format BOOK.CHAPTER.VERSE (e.g., GEN.1.1, JHN.3.16)",
                  },
                  passage_id: {
                    type: "string",
                    description: "Passage ID e.g. GEN.1.1-GEN.1.5",
                  },
                  book_id: {
                    type: "string",
                    description: "Book ID (e.g., GEN, EXO, MAT, JHN)",
                  },
                  chapter: {
                    type: "number",
                    description: "Chapter number (required for chapter action)",
                  },
                  limit: {
                    type: "number",
                    description: "Max search results (1-200)",
                    default: 10,
                  },
                  response_format: {
                    type: "string",
                    enum: ["concise", "detailed"],
                    default: "concise",
                    description: "concise = essential info only; detailed = full text with verse numbers",
                  },
                },
                required: ["action"],
              },
            },
            {
              name: "bible_reference",
              title: "Bible Reference",
              description: "Navigate Bible structure. Actions: list_books - All books with names and abbreviations; list_chapters - Chapters for a book (requires book_id). Use concise for quick lookups; use detailed when you need book IDs for follow-up tool calls.",
              inputSchema: {
                type: "object",
                properties: {
                  action: {
                    type: "string",
                    enum: ["list_books", "list_chapters"],
                    description: "Action to perform",
                  },
                  book_id: {
                    type: "string",
                    description: "Book ID (required for list_chapters, e.g., GEN, JHN)",
                  },
                  response_format: {
                    type: "string",
                    enum: ["concise", "detailed"],
                    default: "concise",
                    description: "concise = names/numbers only; detailed = includes IDs for follow-up calls",
                  },
                },
                required: ["action"],
              },
            },
          ],
        });

      case "tools/call":
        if (!body.params || typeof body.params.name !== "string" || !body.params.name.trim()) {
          return createErrorResponse(body.id, -32602, "Invalid params: missing tool name");
        }
        const toolName = body.params.name;
        const toolArgs = body.params.arguments || {};

        try {
          let result;
          if (toolName === "bible_content") {
            result = await handleBibleContent(toolArgs, bibleClient);
          } else if (toolName === "bible_reference") {
            result = await handleBibleReference(toolArgs, bibleClient);
          } else {
            return createErrorResponse(body.id, -32601, `Unknown tool: ${toolName}`);
          }
          return createSuccessResponse(body.id, result);
        } catch (error) {
          return createErrorResponse(body.id, -32603, `Tool execution error: ${error instanceof Error ? error.message : String(error)}`);
        }

      default:
        return createErrorResponse(body.id, -32601, `Unknown method: ${body.method}`);
    }
    
  } catch (error) {
    return createErrorResponse(null, -32700, `Parse error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createSuccessResponse(id: any, result: any): Response {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: id,
    result: result,
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Cache-Control, X-Requested-With",
    },
  });
}

function createErrorResponse(id: any, code: number, message: string): Response {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: id,
    error: {
      code: code,
      message: message,
    },
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Cache-Control, X-Requested-With",
    },
  });
}

const MAX_VERSE_LENGTH_CONCISE = 100;

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim() + "...";
}

async function handleBibleContent(
  args: {
    action: string;
    query?: string;
    verse_id?: string;
    passage_id?: string;
    book_id?: string;
    chapter?: number;
    limit?: number;
    response_format?: string;
  },
  client: BibleAPIClient
): Promise<CallToolResult> {
  const action = args.action;
  const responseFormat = args.response_format || "concise";
  const isDetailed = responseFormat === "detailed";

  try {
    switch (action) {
      case "search": {
        if (!args.query) {
          return toolError("search action requires query");
        }
        const limit = Math.min(Math.max(args.limit ?? 10, 1), 200);
        const result = await client.searchVerses(args.query, limit);
        if (!result.data?.verses) {
          return toolResult(`No verses found for query: '${args.query}'`);
        }
        const verses = result.data.verses;
        const total = result.data.total;
        const maxResults = isDetailed ? verses.length : Math.min(5, verses.length);
        let response = isDetailed
          ? `Found ${total} verses for '${args.query}' (showing ${verses.length}):\n\n`
          : `Found ${total} verses for '${args.query}' (top ${maxResults}):\n\n`;
        for (let i = 0; i < maxResults; i++) {
          const verse = verses[i];
          const text = isDetailed ? verse.text : truncateText(verse.text, MAX_VERSE_LENGTH_CONCISE);
          response += `**${verse.reference}**\n${text}\n\n`;
        }
        return toolResult(response.trim());
      }

      case "verse": {
        if (!args.verse_id) {
          return toolError("verse action requires verse_id");
        }
        const params = {
          "include-verse-numbers": isDetailed.toString(),
        };
        const result = await client.getVerse(args.verse_id, params);
        if (!result.data) {
          return toolResult(`Verse not found: ${args.verse_id}`);
        }
        const verseData = result.data;
        return toolResult(`**${verseData.reference}**\n${verseData.content.trim()}`);
      }

      case "passage":
      case "chapter": {
        if (action === "passage") {
          if (!args.passage_id) {
            return toolError("passage action requires passage_id");
          }
          const params = {
            "include-verse-numbers": isDetailed.toString(),
            "content-type": isDetailed ? "json" : "text",
          };
          const result = await client.getPassage(args.passage_id, params);
          if (!result.data) {
            return toolResult(`Passage not found: ${args.passage_id}`);
          }
          const passageData = result.data;
          let content: string;
          if (params["content-type"] === "text") {
            content = passageData.content.trim();
          } else {
            const contentItems = passageData.content || [];
            content = extractTextFromContent(contentItems);
          }
          return toolResult(`**${passageData.reference}**\n${content}`);
        } else {
          if (!args.book_id || args.chapter == null) {
            return toolError("chapter action requires book_id and chapter");
          }
          const bookId = args.book_id.toUpperCase();
          const chaptersResult = await client.getChapters(bookId);
          let chapterFound: any = null;
          for (const ch of chaptersResult.data || []) {
            if (ch.number === args.chapter.toString()) {
              chapterFound = ch;
              break;
            }
          }
          if (!chapterFound) {
            return toolResult(`Chapter ${args.chapter} not found in book ${bookId}`);
          }
          const chapterParams = {
            "include-verse-numbers": isDetailed.toString(),
            "content-type": isDetailed ? "json" : "text",
          };
          const result = await client.getPassage(chapterFound.id, chapterParams);
          if (!result.data) {
            return toolResult(`Chapter content not found: ${bookId} ${args.chapter}`);
          }
          const passageData = result.data;
          let content: string;
          if (chapterParams["content-type"] === "text") {
            content = typeof passageData.content === "string" ? passageData.content.trim() : "";
          } else {
            const contentItems = passageData.content || [];
            content = extractTextFromContent(Array.isArray(contentItems) ? contentItems : [contentItems]);
          }
          return toolResult(`**${passageData.reference}**\n${content}`);
        }
      }

      default:
        return toolError(`Unknown action: ${action}. Use search, verse, passage, or chapter.`);
    }
  } catch (error) {
    return toolError(`Error: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

async function handleBibleReference(
  args: {
    action: string;
    book_id?: string;
    response_format?: string;
  },
  client: BibleAPIClient
): Promise<CallToolResult> {
  const action = args.action;
  const responseFormat = args.response_format || "concise";
  const isDetailed = responseFormat === "detailed";

  try {
    switch (action) {
      case "list_books": {
        const result = await client.getBooks();
        if (!result.data) {
          return toolResult("No books found");
        }
        const books = result.data;
        let response = "**Bible Books:**\n\n";
        for (const book of books) {
          if (isDetailed) {
            response += `• **${book.name}** (${book.abbreviation}) - ID: ${book.id}\n`;
          } else {
            response += `• **${book.name}** (${book.abbreviation})\n`;
          }
        }
        return toolResult(response.trim());
      }

      case "list_chapters": {
        if (!args.book_id) {
          return toolError("list_chapters action requires book_id");
        }
        const bookId = args.book_id.toUpperCase();
        const result = await client.getChapters(bookId);
        if (!result.data) {
          return toolResult(`No chapters found for book: ${bookId}`);
        }
        const chapters = result.data;
        let response = `**Chapters in ${bookId}:**\n\n`;
        for (const chapter of chapters) {
          if (chapter.number !== "intro") {
            if (isDetailed) {
              response += `• Chapter ${chapter.number} - ${chapter.reference}\n`;
            } else {
              response += `• Chapter ${chapter.number}\n`;
            }
          }
        }
        return toolResult(response.trim());
      }

      default:
        return toolError(`Unknown action: ${action}. Use list_books or list_chapters.`);
    }
  } catch (error) {
    return toolError(`Error: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

function toolResult(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

function toolError(text: string, isError = true): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError,
  };
}