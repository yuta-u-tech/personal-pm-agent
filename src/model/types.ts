export type ModelRequest = {
  date: string;
  ledgerDir: string;
  contextPackPath: string;
  schemaPath: string;
  outputPath: string;
  prompt: string;
  timeoutMs?: number;
};

export type ModelResponse = {
  text: string;
  json?: unknown;
  raw: unknown;
  outputPath?: string;
};

export interface ModelAdapter {
  name: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

