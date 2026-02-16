import { describe, expect, it } from "vitest";
import { buildInboundMetaSystemPrompt, buildInboundUserContextPrefix } from "./inbound-meta.js";

describe("inbound meta media context", () => {
  it("marks media presence in trusted metadata prompt", () => {
    const out = buildInboundMetaSystemPrompt({
      Provider: "feishu",
      Surface: "feishu",
      OriginatingChannel: "feishu",
      MediaUrl: "/tmp/media/a.png",
      MediaUrls: ["/tmp/media/a.png", "/tmp/media/b.png"],
      MediaTypes: ["image/png", "image/png"],
    });

    expect(out).toContain('"has_media": true');
    expect(out).toContain('"media_count": 2');
  });

  it("includes system-resolved media evidence block in user context", () => {
    const out = buildInboundUserContextPrefix({
      ChatType: "group",
      SenderName: "AX",
      MediaPath: "/tmp/media/a.png",
      MediaType: "image/png",
      MediaUrls: ["/tmp/media/a.png"],
      MediaTypes: ["image/png"],
    });

    expect(out).toContain("Media context (system-resolved, for evidence):");
    expect(out).toContain("/tmp/media/a.png");
    expect(out).toContain("image/png");
  });
});
