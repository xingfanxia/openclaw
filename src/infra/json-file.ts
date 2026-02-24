import fs from "node:fs";
import path from "node:path";

export function loadJsonFile(pathname: string): unknown {
  try {
    if (!fs.existsSync(pathname)) {
      return undefined;
    }
    const raw = fs.readFileSync(pathname, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function saveJsonFile(pathname: string, data: unknown) {
  const dir = path.dirname(pathname);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(pathname, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  // chmod is best-effort: in shared host/container setups the file may be owned
  // by a different uid; ACL entries already control access in that case.
  try {
    fs.chmodSync(pathname, 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") {
      throw e;
    }
  }
}
