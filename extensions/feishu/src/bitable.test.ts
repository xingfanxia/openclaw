import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { registerFeishuBitableTools } from "./bitable.js";

describe("registerFeishuBitableTools", () => {
  it("registers bitable tools when credentials are present", () => {
    const toolNames: string[] = [];
    const api = {
      config: { channels: { feishu: { appId: "app", appSecret: "secret" } } },
      logger: { debug: vi.fn(), info: vi.fn() },
      registerTool: (tool: { name: string }) => {
        toolNames.push(tool.name);
      },
    } as unknown as OpenClawPluginApi;

    registerFeishuBitableTools(api);

    expect(toolNames).toContain("feishu_bitable_get_meta");
    expect(toolNames).toContain("feishu_bitable_list_fields");
    expect(toolNames).toContain("feishu_bitable_create_field");
    expect(toolNames).toContain("feishu_bitable_update_field");
    expect(toolNames).toContain("feishu_bitable_list_records");
    expect(toolNames).toContain("feishu_bitable_get_record");
    expect(toolNames).toContain("feishu_bitable_create_record");
    expect(toolNames).toContain("feishu_bitable_update_record");
  });
});
