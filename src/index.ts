import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

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
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    
    if (url.pathname === "/sse" && request.method === "POST") {
      return handleMCP(request, env);
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

async function handleMCP(request: Request, env: Env): Promise<Response> {
  try {
    const bibleClient = new BibleAPIClient(env);
    
    const server = new Server(
      {
        name: "bible-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "search_verses",
            description: "Search for Bible verses containing specific text",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Text to search for in Bible verses",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of results to return (1-200)",
                  default: 10,
                },
              },
              required: ["query"],
            },
          },
          {
            name: "get_verse",
            description: "Get a specific Bible verse",
            inputSchema: {
              type: "object",
              properties: {
                verse_id: {
                  type: "string",
                  description: "Verse ID in format BOOK.CHAPTER.VERSE (e.g., GEN.1.1)",
                },
                include_verse_numbers: {
                  type: "boolean",
                  description: "Include verse numbers in the output",
                  default: true,
                },
              },
              required: ["verse_id"],
            },
          },
          {
            name: "get_passage",
            description: "Get a passage of Bible verses",
            inputSchema: {
              type: "object",
              properties: {
                passage_id: {
                  type: "string",
                  description: "Passage ID in format BOOK.CHAPTER.START_VERSE-BOOK.CHAPTER.END_VERSE (e.g., GEN.1.1-GEN.1.5)",
                },
                include_verse_numbers: {
                  type: "boolean",
                  description: "Include verse numbers in the output",
                  default: true,
                },
              },
              required: ["passage_id"],
            },
          },
          {
            name: "get_chapter",
            description: "Get all verses from a specific chapter",
            inputSchema: {
              type: "object",
              properties: {
                book_id: {
                  type: "string",
                  description: "Book ID (e.g., GEN, EXO, MAT, JHN)",
                },
                chapter: {
                  type: "number",
                  description: "Chapter number",
                },
              },
              required: ["book_id", "chapter"],
            },
          },
          {
            name: "list_books",
            description: "Get a list of all books in the Bible",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "list_chapters",
            description: "Get a list of chapters for a specific book",
            inputSchema: {
              type: "object",
              properties: {
                book_id: {
                  type: "string",
                  description: "Book ID (e.g., GEN, EXO, MAT, JHN)",
                },
              },
              required: ["book_id"],
            },
          },
        ] as Tool[],
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "search_verses":
            return await searchVerses(args as any, bibleClient);
          case "get_verse":
            return await getVerse(args as any, bibleClient);
          case "get_passage":
            return await getPassage(args as any, bibleClient);
          case "get_chapter":
            return await getChapter(args as any, bibleClient);
          case "list_books":
            return await listBooks(bibleClient);
          case "list_chapters":
            return await listChapters(args as any, bibleClient);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });

    return new Response(JSON.stringify({ status: "MCP Server initialized" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}

async function searchVerses(
  args: { query: string; limit?: number },
  client: BibleAPIClient
): Promise<CallToolResult> {
  const limit = args.limit || 10;
  
  if (limit < 1 || limit > 200) {
    return {
      content: [
        {
          type: "text",
          text: "Error: limit must be between 1 and 200",
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await client.searchVerses(args.query, limit);
    
    if (!result.data?.verses) {
      return {
        content: [
          {
            type: "text",
            text: `No verses found for query: '${args.query}'`,
          },
        ],
      };
    }

    const verses = result.data.verses;
    const total = result.data.total;
    
    let response = `Found ${total} verses for '${args.query}' (showing ${verses.length}):\n\n`;
    
    for (const verse of verses) {
      response += `**${verse.reference}**\n${verse.text}\n\n`;
    }
    
    return {
      content: [
        {
          type: "text",
          text: response.trim(),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error searching verses: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function getVerse(
  args: { verse_id: string; include_verse_numbers?: boolean },
  client: BibleAPIClient
): Promise<CallToolResult> {
  try {
    const params = {
      "include-verse-numbers": (args.include_verse_numbers ?? true).toString(),
    };
    
    const result = await client.getVerse(args.verse_id, params);
    
    if (!result.data) {
      return {
        content: [
          {
            type: "text",
            text: `Verse not found: ${args.verse_id}`,
          },
        ],
      };
    }

    const verseData = result.data;
    const response = `**${verseData.reference}**\n${verseData.content.trim()}`;
    
    return {
      content: [
        {
          type: "text",
          text: response,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error getting verse: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function getPassage(
  args: { passage_id: string; include_verse_numbers?: boolean },
  client: BibleAPIClient
): Promise<CallToolResult> {
  try {
    const includeVerseNumbers = args.include_verse_numbers ?? true;
    const params = {
      "include-verse-numbers": includeVerseNumbers.toString(),
      "content-type": includeVerseNumbers ? "json" : "text",
    };
    
    const result = await client.getPassage(args.passage_id, params);
    
    if (!result.data) {
      return {
        content: [
          {
            type: "text",
            text: `Passage not found: ${args.passage_id}`,
          },
        ],
      };
    }

    const passageData = result.data;
    let content: string;
    
    if (params["content-type"] === "text") {
      content = passageData.content.trim();
    } else {
      const contentItems = passageData.content || [];
      content = extractTextFromContent(contentItems);
    }
    
    const response = `**${passageData.reference}**\n${content}`;
    
    return {
      content: [
        {
          type: "text",
          text: response,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error getting passage: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function getChapter(
  args: { book_id: string; chapter: number },
  client: BibleAPIClient
): Promise<CallToolResult> {
  try {
    const bookId = args.book_id.toUpperCase();
    
    // Get chapter info to determine verse range
    const chaptersResult = await client.getChapters(bookId);
    let chapterFound: any = null;
    
    for (const ch of chaptersResult.data || []) {
      if (ch.number === args.chapter.toString()) {
        chapterFound = ch;
        break;
      }
    }
    
    if (!chapterFound) {
      return {
        content: [
          {
            type: "text",
            text: `Chapter ${args.chapter} not found in book ${bookId}`,
          },
        ],
      };
    }
    
    // Get the full chapter using the chapter ID
    const chapterId = chapterFound.id;
    const result = await client.getPassage(chapterId);
    
    if (!result.data) {
      return {
        content: [
          {
            type: "text",
            text: `Chapter content not found: ${bookId} ${args.chapter}`,
          },
        ],
      };
    }
    
    const passageData = result.data;
    const contentItems = passageData.content || [];
    const content = extractTextFromContent(contentItems);
    
    const response = `**${passageData.reference}**\n${content}`;
    
    return {
      content: [
        {
          type: "text",
          text: response,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error retrieving chapter ${args.book_id} ${args.chapter}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function listBooks(client: BibleAPIClient): Promise<CallToolResult> {
  try {
    const result = await client.getBooks();
    
    if (!result.data) {
      return {
        content: [
          {
            type: "text",
            text: "No books found",
          },
        ],
      };
    }

    const books = result.data;
    let response = "**Bible Books:**\n\n";
    
    for (const book of books) {
      response += `• **${book.name}** (${book.abbreviation}) - ID: ${book.id}\n`;
    }
    
    return {
      content: [
        {
          type: "text",
          text: response.trim(),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error listing books: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function listChapters(
  args: { book_id: string },
  client: BibleAPIClient
): Promise<CallToolResult> {
  try {
    const bookId = args.book_id.toUpperCase();
    
    const result = await client.getChapters(bookId);
    
    if (!result.data) {
      return {
        content: [
          {
            type: "text",
            text: `No chapters found for book: ${bookId}`,
          },
        ],
      };
    }

    const chapters = result.data;
    let response = `**Chapters in ${bookId}:**\n\n`;
    
    for (const chapter of chapters) {
      if (chapter.number !== "intro") {
        response += `• Chapter ${chapter.number} - ${chapter.reference}\n`;
      }
    }
    
    return {
      content: [
        {
          type: "text",
          text: response.trim(),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error listing chapters: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}