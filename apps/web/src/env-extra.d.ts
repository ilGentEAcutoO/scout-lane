interface Env {
  GLM_MODEL_EFFICIENT?: string;
  GLM_MODEL_FREE?: string;
  CF_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_ID?: string;
  MCP_PUBLIC_URL?: string;
  APP_PUBLIC_URL?: string;
  APIFY_TOKEN?: string;
  APIFY_WIDE?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  KEY_ENCRYPTION_KEY?: string;
  CLAUDE_MODEL?: string;
  OPENAI_MODEL?: string;
  GEMINI_MODEL?: string;
  LANE_HUB: DurableObjectNamespace<import("./do/lane-hub").LaneHub>;
  SCOUT_QUEUE: Queue;
}
