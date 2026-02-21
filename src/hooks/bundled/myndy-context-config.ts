/**
 * Myndy Context Configuration Schema
 */

import { z } from "zod";

export const myndyContextConfigSchema = z
  .object({
    enabled: z.boolean().default(false).describe("Enable myndy-agent context enrichment"),
    apiUrl: z.string().url().default("http://localhost:8888").describe("myndy-agent API URL"),
    timeout: z
      .number()
      .min(100)
      .max(30000)
      .default(5000)
      .describe("Request timeout in milliseconds"),
  })
  .optional();

export type MyndyContextConfig = z.infer<typeof myndyContextConfigSchema>;
