interface Env {
  APP_PUBLIC_URL?: string;
  MCP_PUBLIC_URL?: string;
  GLM_API_KEY?: string;
  GLM_BASE_URL?: string;
  GLM_MODEL?: string;
  GLM_MODEL_EFFICIENT?: string;
  GLM_MODEL_FREE?: string;
  CF_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_ID?: string;
  GITHUB_TOKEN?: string;
  APIFY_TOKEN?: string;
  APIFY_WIDE?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  KEY_ENCRYPTION_KEY?: string;
  CLAUDE_MODEL?: string;
  OPENAI_MODEL?: string;
  GEMINI_MODEL?: string;
  AI?: Ai;
  SCOUT_QUEUE: Queue;
  SCREEN_QUEUE: Queue;
  R2_RESUMES: R2Bucket;
}
