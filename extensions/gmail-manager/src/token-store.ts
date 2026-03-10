import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TOKEN_FILE = path.join(os.homedir(), ".openclaw", "gmail-tokens.json");

export interface StoredToken {
  accountId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  updatedAt: string;
}

export interface TokenStore {
  [accountId: string]: StoredToken;
}

function ensureDir(): void {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadTokens(): TokenStore {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, "utf-8");
      return JSON.parse(data) as TokenStore;
    }
  } catch {
    // Return empty store on parse error
  }
  return {};
}

export function saveTokens(store: TokenStore): void {
  ensureDir();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), "utf-8");
  fs.chmodSync(TOKEN_FILE, 0o600);
}

export function getToken(accountId: string): StoredToken | undefined {
  const store = loadTokens();
  return store[accountId];
}

export function setToken(token: StoredToken): void {
  const store = loadTokens();
  const updated: TokenStore = {
    ...store,
    [token.accountId]: { ...token, updatedAt: new Date().toISOString() },
  };
  saveTokens(updated);
}

export function removeToken(accountId: string): void {
  const store = loadTokens();
  const { [accountId]: _, ...rest } = store;
  saveTokens(rest);
}

export function isTokenExpired(token: StoredToken): boolean {
  return Date.now() >= token.expiryDate - 5 * 60 * 1000;
}
