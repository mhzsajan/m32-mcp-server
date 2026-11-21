import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { M32Error } from "../core/errors.js";

export function textResult(text: string): TextContent {
  return { type: "text", text };
}

/** Tool failures are visible results, not JSON-RPC transport errors. */
export async function wrapM32Tool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof M32Error) {
      return { isError: true, content: [textResult(err.message)] };
    }
    throw err;
  }
}

export function valueOf(args: (number | string)[]): number | string | null {
  return args.length === 0 ? null : args[0];
}
