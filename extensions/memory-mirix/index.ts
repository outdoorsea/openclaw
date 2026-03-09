/**
 * OpenClaw Memory (MIRIX) Plugin
 *
 * Replaces the default file-based memory with MIRIX deep memory system.
 * Provides memory_search, memory_get, and memory_store tools.
 * Supports 6 memory types: episodic, semantic, procedural, resource, knowledge, core.
 * Optionally writes markdown backup files.
 */

import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ============================================================================
// Config
// ============================================================================

type MirixConfig = {
  apiUrl: string;
  apiKey: string;
  configPath?: string;
  autoStore?: boolean;
  markdownBackup?: boolean;
};

type MirixMemoryType =
  | "episodic"
  | "semantic"
  | "procedural"
  | "resource"
  | "knowledge"
  | "core";

const MEMORY_TYPE_MAP: Record<string, MirixMemoryType> = {
  fact: "semantic",
  preference: "knowledge",
  goal: "episodic",
  commitment: "episodic",
  context: "episodic",
  event: "episodic",
  howto: "procedural",
  reference: "resource",
  identity: "core",
  other: "episodic",
};

// ============================================================================
// MIRIX API Client
// ============================================================================

class MirixClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private async request(
    endpoint: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<unknown> {
    const url = `${this.apiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
    };

    const resp = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`MIRIX API error ${resp.status}: ${text}`);
    }

    return resp.json();
  }

  async search(
    query: string,
    options?: { limit?: number; memoryType?: string },
  ): Promise<MirixSearchResult[]> {
    const params = new URLSearchParams({ query });
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.memoryType) params.set("memory_type", options.memoryType);

    const data = (await this.request(`/memory/search?${params}`)) as {
      results?: MirixSearchResult[];
    };
    return data.results ?? [];
  }

  async getByTopic(topic: string): Promise<MirixTopicResult> {
    const params = new URLSearchParams({ topic });
    return (await this.request(`/memory/retrieve/topic?${params}`)) as MirixTopicResult;
  }

  async addMemory(content: string, memoryType: MirixMemoryType): Promise<unknown> {
    return this.request("/memory/add", {
      method: "POST",
      body: { content, memory_type: memoryType },
    });
  }

  async health(): Promise<boolean> {
    try {
      const data = (await this.request("/health")) as { status?: string };
      return data.status === "healthy";
    } catch {
      return false;
    }
  }
}

type MirixSearchResult = {
  memory_type: string;
  id: string;
  timestamp?: string;
  summary?: string;
  details?: string;
  content?: string;
  event_type?: string;
  actor?: string;
};

type MirixTopicResult = {
  success: boolean;
  topic: string;
  memories: Record<
    string,
    {
      total_count: number;
      recent: Array<{
        id: string;
        timestamp?: string;
        summary?: string;
        details?: string;
      }>;
    }
  >;
};

// ============================================================================
// Helpers
// ============================================================================

function loadMirixConfig(pluginCfg: Record<string, unknown>): MirixConfig {
  let apiUrl = (pluginCfg.apiUrl as string) || process.env.MIRIX_API_URL || "";
  let apiKey = (pluginCfg.apiKey as string) || process.env.MIRIX_API_KEY || "";

  // Fallback: read from ~/.mirix/config.json
  if (!apiKey || !apiUrl) {
    const configPath =
      (pluginCfg.configPath as string) ||
      path.join(process.env.HOME ?? "/root", ".mirix", "config.json");
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (!apiUrl) apiUrl = raw.api_url ?? "http://localhost:8531";
      if (!apiKey) apiKey = raw.api_key ?? "";
    } catch {
      // config not found, will use defaults
    }
  }

  if (!apiUrl) apiUrl = "http://localhost:8531";

  return {
    apiUrl,
    apiKey,
    autoStore: pluginCfg.autoStore === true,
    markdownBackup: pluginCfg.markdownBackup !== false, // default true
  };
}

function autoCategorizeMirixType(text: string): MirixMemoryType {
  const lower = text.toLowerCase();

  // Procedural: instructions, how-tos
  if (/\b(how to|steps?|instructions?|procedure|recipe|workflow|setup|install|configure)\b/.test(lower)) {
    return "procedural";
  }

  // Knowledge: contacts, credentials, identifiers
  if (/\b(phone|email|address|password|api.?key|token|id|number|account)\b/.test(lower)) {
    return "knowledge";
  }

  // Core: identity, fundamental preferences
  if (/\b(i am|my name|i prefer|i always|i never|my favorite|my personality)\b/.test(lower)) {
    return "core";
  }

  // Semantic: facts, definitions, general knowledge
  if (/\b(is a|means|defined as|refers to|fact:|note:)\b/.test(lower)) {
    return "semantic";
  }

  // Resource: files, URLs, references
  if (/\b(https?:\/\/|file:|path:|located at|saved at|repo:|github\.com)\b/.test(lower)) {
    return "resource";
  }

  // Default: episodic (time-based events)
  return "episodic";
}

function formatSearchResults(results: MirixSearchResult[]): string {
  if (results.length === 0) {
    return "No relevant memories found in MIRIX.";
  }

  return results
    .map((r, i) => {
      const type = r.memory_type ?? "unknown";
      const date = r.timestamp ? r.timestamp.slice(0, 10) : "";
      const summary = r.summary ?? r.content ?? "";
      const details = r.details ?? "";
      const dateStr = date ? ` (${date})` : "";
      const detailStr = details && details !== summary ? `\n   ${details.slice(0, 300)}` : "";
      return `${i + 1}. [${type}]${dateStr} ${summary}${detailStr}`;
    })
    .join("\n");
}

function writeMarkdownBackup(text: string, workspaceDir: string): void {
  try {
    const memDir = path.join(workspaceDir, "memory");
    if (!fs.existsSync(memDir)) {
      fs.mkdirSync(memDir, { recursive: true });
    }
    const dateStr = new Date().toISOString().slice(0, 10);
    const filePath = path.join(memDir, `${dateStr}.md`);
    const header = fs.existsSync(filePath) ? "" : `# Memory - ${dateStr}\n\n`;
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    });
    fs.appendFileSync(filePath, `${header}## ${timestamp}\n${text}\n\n`);
  } catch {
    // non-fatal
  }
}

// ============================================================================
// Plugin
// ============================================================================

const memoryMirixPlugin = {
  id: "memory-mirix",
  name: "Memory (MIRIX)",
  description:
    "Long-term memory powered by MIRIX with 6 memory types: episodic, semantic, procedural, resource, knowledge, core",
  kind: "memory" as const,

  register(api: OpenClawPluginApi) {
    const cfg = loadMirixConfig((api.pluginConfig ?? {}) as Record<string, unknown>);
    const client = new MirixClient(cfg.apiUrl, cfg.apiKey);
    const workspaceDir = api.resolvePath("~/.openclaw/workspace");

    api.logger.info(
      `memory-mirix: registered (api: ${cfg.apiUrl}, backup: ${cfg.markdownBackup})`,
    );

    // ========================================================================
    // memory_search → MIRIX semantic search
    // ========================================================================

    api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search (MIRIX)",
        description:
          "Mandatory recall step: semantically search MIRIX long-term memory before answering questions about prior work, decisions, dates, people, preferences, or todos. Returns results across 6 memory types (episodic, semantic, procedural, resource, knowledge, core). If response has disabled=true, memory retrieval is unavailable.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          maxResults: Type.Optional(
            Type.Number({ description: "Max results (default: 10)" }),
          ),
          minScore: Type.Optional(Type.Number({ description: "Minimum relevance score" })),
        }),
        async execute(_toolCallId, params) {
          const query = (params as { query: string }).query;
          const maxResults = (params as { maxResults?: number }).maxResults ?? 10;

          try {
            const results = await client.search(query, { limit: maxResults });
            const text = formatSearchResults(results);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    results: results.map((r) => ({
                      path: `mirix://${r.memory_type}/${r.id}`,
                      startLine: 1,
                      endLine: 1,
                      score: 0.8,
                      snippet: `[${r.memory_type}] ${r.summary ?? r.content ?? ""}\n${r.details ?? ""}`.trim(),
                      source: "mirix",
                      citation: `mirix://${r.memory_type}/${r.id}`,
                    })),
                    provider: "mirix",
                    model: "mirix-search",
                    citations: "auto",
                    mode: "semantic",
                  }),
                },
              ],
              details: { count: results.length },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    disabled: true,
                    reason: `MIRIX unavailable: ${message}`,
                  }),
                },
              ],
            };
          }
        },
      },
      { name: "memory_search" },
    );

    // ========================================================================
    // memory_get → MIRIX topic retrieval
    // ========================================================================

    api.registerTool(
      {
        name: "memory_get",
        label: "Memory Get (MIRIX)",
        description:
          "Retrieve memories by topic from MIRIX. Use after memory_search to get more details on a specific topic or memory type.",
        parameters: Type.Object({
          path: Type.String({
            description:
              'Topic to retrieve, or a mirix:// URI from search results (e.g. "family", "cooking", "mirix://episodic/ep-abc123")',
          }),
          from: Type.Optional(Type.Number({ description: "Unused (compatibility)" })),
          lines: Type.Optional(Type.Number({ description: "Max entries to return" })),
        }),
        async execute(_toolCallId, params) {
          const rawPath = (params as { path: string }).path;
          const limit = (params as { lines?: number }).lines ?? 10;

          try {
            // If it's a mirix:// URI, search for that specific memory
            const topic = rawPath.replace(/^mirix:\/\/[^/]+\//, "").replace(/^memory\//, "");

            const result = await client.getByTopic(topic);

            if (!result.success) {
              return {
                content: [
                  { type: "text" as const, text: `No memories found for topic: ${topic}` },
                ],
              };
            }

            const lines: string[] = [`# Memories: ${topic}\n`];
            for (const [mtype, data] of Object.entries(result.memories)) {
              if (data.total_count === 0) continue;
              lines.push(`## ${mtype} (${data.total_count} total)\n`);
              for (const m of data.recent.slice(0, limit)) {
                const date = m.timestamp ? m.timestamp.slice(0, 10) : "";
                lines.push(`- **${date}**: ${m.summary ?? ""}`);
                if (m.details) lines.push(`  ${m.details.slice(0, 200)}`);
              }
              lines.push("");
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ text: lines.join("\n"), path: `mirix://${topic}` }),
                },
              ],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error retrieving MIRIX memories: ${message}`,
                },
              ],
            };
          }
        },
      },
      { name: "memory_get" },
    );

    // ========================================================================
    // memory_store → Write to MIRIX (new tool)
    // ========================================================================

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store (MIRIX)",
        description:
          "Save important information to MIRIX long-term memory. Use for preferences, facts, decisions, events, how-tos. Auto-categorizes into 6 memory types unless specified.",
        parameters: Type.Object({
          text: Type.String({ description: "Information to remember" }),
          category: Type.Optional(
            Type.String({
              description:
                'Memory type: episodic, semantic, procedural, resource, knowledge, core. Or a hint like "fact", "preference", "howto". Auto-detected if omitted.',
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const text = (params as { text: string }).text;
          const categoryHint = (params as { category?: string }).category;

          // Resolve memory type
          let memoryType: MirixMemoryType;
          if (categoryHint && categoryHint in MEMORY_TYPE_MAP) {
            memoryType = MEMORY_TYPE_MAP[categoryHint];
          } else if (
            categoryHint &&
            ["episodic", "semantic", "procedural", "resource", "knowledge", "core"].includes(
              categoryHint,
            )
          ) {
            memoryType = categoryHint as MirixMemoryType;
          } else {
            memoryType = autoCategorizeMirixType(text);
          }

          try {
            await client.addMemory(text, memoryType);

            // Markdown backup
            if (cfg.markdownBackup) {
              writeMarkdownBackup(`- [${memoryType}] ${text}`, workspaceDir);
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: `✅ Stored as ${memoryType} memory in MIRIX${cfg.markdownBackup ? " (+ markdown backup)" : ""}`,
                },
              ],
              details: { memoryType, stored: true },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `❌ Failed to store in MIRIX: ${message}`,
                },
              ],
            };
          }
        },
      },
      { name: "memory_store" },
    );

    // Register CLI
    api.registerCli(
      ({ program }) => {
        const mirix = program.command("memory").description("MIRIX memory commands");

        mirix
          .command("search <query>")
          .description("Search MIRIX memories")
          .option("-n, --limit <n>", "Max results", "10")
          .action(async (query: string, opts: { limit: string }) => {
            const results = await client.search(query, {
              limit: parseInt(opts.limit, 10),
            });
            if (results.length === 0) {
              console.log("No results found.");
              return;
            }
            console.log(formatSearchResults(results));
          });

        mirix
          .command("health")
          .description("Check MIRIX health")
          .action(async () => {
            const ok = await client.health();
            console.log(ok ? "✅ MIRIX is healthy" : "❌ MIRIX is unreachable");
          });

        mirix
          .command("store <text>")
          .description("Store a memory")
          .option("-t, --type <type>", "Memory type", "auto")
          .action(async (text: string, opts: { type: string }) => {
            const memType =
              opts.type === "auto"
                ? autoCategorizeMirixType(text)
                : (opts.type as MirixMemoryType);
            await client.addMemory(text, memType);
            console.log(`✅ Stored as ${memType} memory`);
          });
      },
      { commands: ["memory"] },
    );
  },
};

export default memoryMirixPlugin;
