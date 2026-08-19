interface Env {
  GLM_MODEL_EFFICIENT?: string;
  GLM_MODEL_FREE?: string;
  CF_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_ID?: string;
  MCP_PUBLIC_URL?: string;
  APIFY_TOKEN?: string;
  APIFY_WIDE?: string;
  LANE_HUB: DurableObjectNamespace<import("./do/lane-hub").LaneHub>;
}
