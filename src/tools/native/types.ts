import { z } from "zod";
import type { Env } from "../../types";

export interface NativeToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  read_only: boolean;
  consumes_ai: boolean;
  requires_confirmation: boolean;
  handler: (env: Env, args: any) => unknown | Promise<unknown>;
}

export interface NativeToolInvocation {
  action_name: string;
  input: Record<string, unknown>;
  dry_run: boolean;
  confirmed: boolean;
}
