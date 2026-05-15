import type { AdapterConfig, PmAgentConfig } from "../core/config.js";
import { resolveAdapterConfig } from "../core/config.js";
import { AgentAdapter } from "./agent-adapter.js";
import { MockAdapter } from "./mock-adapter.js";
import type { ModelAdapter } from "./types.js";

export function createAdapter(config: PmAgentConfig, adapterName?: string): ModelAdapter {
  const resolved = resolveAdapterConfig(config, adapterName);
  return adapterFromConfig(resolved.name, resolved.config);
}

function adapterFromConfig(name: string, config: AdapterConfig): ModelAdapter {
  if (config.type === "mock") return new MockAdapter();
  if (config.type === "agent") return new AgentAdapter(name, config);
  throw new Error(`Unsupported adapter: ${name}`);
}

