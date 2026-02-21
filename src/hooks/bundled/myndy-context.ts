/**
 * Myndy Agent Context Enrichment Hook
 *
 * Enriches incoming messages with contact context from myndy-agent:
 * - Contact name and relationship from Neo4j
 * - Relevant memories from MIRIX
 * - Trust level for filtering
 *
 * Configuration:
 * ```yaml
 * myndyContext:
 *   enabled: true
 *   apiUrl: "http://localhost:8888"
 *   timeout: 5000
 * ```
 */

import type { MsgContext } from "../../auto-reply/templating.js";

export interface MyndyContextConfig {
  enabled: boolean;
  apiUrl: string;
  timeout: number;
}

export interface ContactContext {
  phone: string;
  name?: string | null;
  relationship?: string | null;
  trust_level?: number | null;
  groups: string[];
  memories: Array<{ content: string; type?: string }>;
}

export interface EnrichedContext {
  context_block: string;
  suggested_tone?: string | null;
}

const DEFAULT_CONFIG: MyndyContextConfig = {
  enabled: false,
  apiUrl: "http://localhost:8888",
  timeout: 5000,
};

let config: MyndyContextConfig = { ...DEFAULT_CONFIG };

export function configureMyndyContext(cfg: Partial<MyndyContextConfig>): void {
  config = { ...DEFAULT_CONFIG, ...cfg };
}

export function getMyndyContextConfig(): MyndyContextConfig {
  return { ...config };
}

/**
 * Fetch contact context from myndy-agent
 */
export async function fetchContactContext(phone: string): Promise<ContactContext | null> {
  if (!config.enabled || !phone) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    const response = await fetch(
      `${config.apiUrl}/api/v1/context/contact/${encodeURIComponent(phone)}`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[myndy-context] Failed to fetch context for ${phone}: ${response.status}`);
      return null;
    }

    return (await response.json()) as ContactContext;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`[myndy-context] Timeout fetching context for ${phone}`);
    } else {
      console.warn(`[myndy-context] Error fetching context: ${err}`);
    }
    return null;
  }
}

/**
 * Fetch enriched context for a message
 */
export async function fetchEnrichedContext(
  phone: string,
  message: string,
): Promise<EnrichedContext | null> {
  if (!config.enabled || !phone) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    const response = await fetch(`${config.apiUrl}/api/v1/context/enrich`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone, message }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as EnrichedContext;
  } catch {
    return null;
  }
}

/**
 * Enrich MsgContext with contact information
 *
 * @param ctx - The message context to enrich
 * @returns The enriched context (modified in place)
 */
export async function enrichMsgContext(ctx: MsgContext): Promise<MsgContext> {
  if (!config.enabled) {
    return ctx;
  }

  const phone = ctx.SenderE164 || ctx.SenderId || ctx.From;
  if (!phone) {
    return ctx;
  }

  const contact = await fetchContactContext(phone);
  if (!contact) {
    return ctx;
  }

  // Enrich sender name if not already set
  if (!ctx.SenderName && contact.name) {
    ctx.SenderName = contact.name;
  }

  // Add contact context to body for agent
  if (contact.name || contact.relationship || contact.memories.length > 0) {
    const contextLines: string[] = [];

    if (contact.name) {
      contextLines.push(`[Contact: ${contact.name}]`);
    }
    if (contact.relationship) {
      contextLines.push(`[Relationship: ${contact.relationship}]`);
    }
    if (contact.groups.length > 0) {
      contextLines.push(`[Groups: ${contact.groups.join(", ")}]`);
    }
    if (contact.memories.length > 0) {
      contextLines.push(`[Recent context: ${contact.memories.map((m) => m.content).join("; ")}]`);
    }

    // Prepend context to BodyForAgent if set
    if (ctx.BodyForAgent && contextLines.length > 0) {
      ctx.BodyForAgent = `${contextLines.join(" ")}\n\n${ctx.BodyForAgent}`;
    }
  }

  return ctx;
}

/**
 * Check if a contact should be filtered (low trust / spam)
 */
export async function shouldFilterMessage(phone: string): Promise<{
  filter: boolean;
  reason?: string;
  priority?: string;
}> {
  if (!config.enabled || !phone) {
    return { filter: false };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    const response = await fetch(`${config.apiUrl}/api/v1/context/filter`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone, message: "" }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { filter: false };
    }

    const result = (await response.json()) as {
      priority: string;
      should_notify: boolean;
      context_summary?: string;
    };

    return {
      filter: result.priority === "spam",
      reason: result.context_summary,
      priority: result.priority,
    };
  } catch {
    return { filter: false };
  }
}
