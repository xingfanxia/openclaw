import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { resetProcessRegistryForTests } from "./bash-process-registry";
import { createExecTool } from "./bash-tools.exec";

afterEach(() => {
  resetProcessRegistryForTests();
});

test("treats grep no-match as completed", async () => {
  if (process.platform === "win32") {
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "exec-grep-no-match-"));
  try {
    await fs.writeFile(path.join(tmpDir, "memory.md"), "alpha\nbeta\n");

    const tool = createExecTool({ allowBackground: false });
    const result = await tool.execute("toolcall", {
      command: 'grep -r "needle-not-present" .',
      workdir: tmpDir,
    });

    expect(result.details.status).toBe("completed");
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("(no output)");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
