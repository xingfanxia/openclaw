import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { google, drive_v3 } from "googleapis";
import type { OAuthConfig, DriveFile, DrivePermission } from "./types.js";

const TOKEN_FILE = path.join(os.homedir(), ".openclaw", "gmail-tokens.json");

interface StoredToken {
  accountId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  updatedAt: string;
}

interface TokenStore {
  [accountId: string]: StoredToken;
}

function loadTokens(): TokenStore {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, "utf-8");
      return JSON.parse(data) as TokenStore;
    }
  } catch {
    // Return empty on parse error
  }
  return {};
}

function getToken(accountId: string): StoredToken | undefined {
  const store = loadTokens();
  return store[accountId];
}

function isTokenExpired(token: StoredToken): boolean {
  return Date.now() >= token.expiryDate - 5 * 60 * 1000;
}

function saveTokenUpdate(token: StoredToken): void {
  const store = loadTokens();
  store[token.accountId] = { ...token, updatedAt: new Date().toISOString() };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function createOAuth2Client(config: OAuthConfig) {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

async function ensureFreshToken(config: OAuthConfig, accountId: string): Promise<void> {
  const token = getToken(accountId);
  if (!token) return;
  if (isTokenExpired(token)) {
    const client = createOAuth2Client(config);
    client.setCredentials({ refresh_token: token.refreshToken });
    const { credentials } = await client.refreshAccessToken();
    saveTokenUpdate({
      ...token,
      accessToken: credentials.access_token ?? "",
      expiryDate: credentials.expiry_date ?? Date.now() + 3600 * 1000,
    });
  }
}

function getDriveClient(config: OAuthConfig, accountId: string): drive_v3.Drive {
  const token = getToken(accountId);
  if (!token) {
    throw new Error(
      `Account "${accountId}" is not authenticated. Use /gmail_auth ${accountId} to connect (Drive scopes required).`,
    );
  }
  const oauth2Client = createOAuth2Client(config);
  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiryDate,
  });
  return google.drive({ version: "v3", auth: oauth2Client });
}

function parseFile(file: drive_v3.Schema$File): DriveFile {
  return {
    id: file.id ?? "",
    name: file.name ?? "",
    mimeType: file.mimeType ?? "",
    size: file.size ?? undefined,
    createdTime: file.createdTime ?? undefined,
    modifiedTime: file.modifiedTime ?? undefined,
    parents: file.parents ?? undefined,
    webViewLink: file.webViewLink ?? undefined,
    webContentLink: file.webContentLink ?? undefined,
    owners: file.owners?.map((o) => ({
      displayName: o.displayName ?? "",
      emailAddress: o.emailAddress ?? "",
    })),
    shared: file.shared ?? undefined,
    trashed: file.trashed ?? undefined,
  };
}

const FILE_FIELDS =
  "id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,webContentLink,owners,shared,trashed";

export async function searchFiles(
  config: OAuthConfig,
  accountId: string,
  query: string,
  typeFilter?: string,
  maxResults: number = 20,
): Promise<DriveFile[]> {
  await ensureFreshToken(config, accountId);
  const drive = getDriveClient(config, accountId);

  let q = `fullText contains '${query.replace(/'/g, "\\'")}'`;
  q += " and trashed = false";

  if (typeFilter) {
    const mimeMap: Record<string, string> = {
      doc: "application/vnd.google-apps.document",
      sheet: "application/vnd.google-apps.spreadsheet",
      slide: "application/vnd.google-apps.presentation",
      folder: "application/vnd.google-apps.folder",
      pdf: "application/pdf",
      image: "image/",
    };
    const mime = mimeMap[typeFilter.toLowerCase()];
    if (mime) {
      if (mime.endsWith("/")) {
        q += ` and mimeType contains '${mime}'`;
      } else {
        q += ` and mimeType = '${mime}'`;
      }
    }
  }

  const res = await drive.files.list({
    q,
    pageSize: maxResults,
    fields: `files(${FILE_FIELDS})`,
    orderBy: "modifiedTime desc",
  });

  return (res.data.files ?? []).map(parseFile);
}

export async function listFiles(
  config: OAuthConfig,
  accountId: string,
  folderId?: string,
  maxResults: number = 50,
): Promise<DriveFile[]> {
  await ensureFreshToken(config, accountId);
  const drive = getDriveClient(config, accountId);

  let q = "trashed = false";
  if (folderId) {
    q += ` and '${folderId.replace(/'/g, "\\'")}' in parents`;
  }

  const res = await drive.files.list({
    q,
    pageSize: maxResults,
    fields: `files(${FILE_FIELDS})`,
    orderBy: "modifiedTime desc",
  });

  return (res.data.files ?? []).map(parseFile);
}

export async function readFileContent(
  config: OAuthConfig,
  accountId: string,
  fileId: string,
): Promise<{ content: string; mimeType: string; name: string }> {
  await ensureFreshToken(config, accountId);
  const drive = getDriveClient(config, accountId);

  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType",
  });

  const mimeType = meta.data.mimeType ?? "";
  const name = meta.data.name ?? "";

  // Google Workspace files need export
  const exportMap: Record<string, { exportMime: string; label: string }> = {
    "application/vnd.google-apps.document": {
      exportMime: "text/plain",
      label: "Google Doc",
    },
    "application/vnd.google-apps.spreadsheet": {
      exportMime: "text/csv",
      label: "Google Sheet",
    },
    "application/vnd.google-apps.presentation": {
      exportMime: "text/plain",
      label: "Google Slides",
    },
    "application/vnd.google-apps.drawing": {
      exportMime: "image/svg+xml",
      label: "Google Drawing",
    },
  };

  const exportInfo = exportMap[mimeType];
  if (exportInfo) {
    const res = await drive.files.export(
      { fileId, mimeType: exportInfo.exportMime },
      { responseType: "text" },
    );
    return {
      content: String(res.data),
      mimeType: exportInfo.exportMime,
      name,
    };
  }

  // Binary/text files - download directly
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
  return { content: String(res.data), mimeType, name };
}

export async function createFile(
  config: OAuthConfig,
  accountId: string,
  name: string,
  type: string,
  content?: string,
  folderId?: string,
): Promise<DriveFile> {
  await ensureFreshToken(config, accountId);
  const drive = getDriveClient(config, accountId);

  const typeMap: Record<string, string> = {
    doc: "application/vnd.google-apps.document",
    sheet: "application/vnd.google-apps.spreadsheet",
    slide: "application/vnd.google-apps.presentation",
    folder: "application/vnd.google-apps.folder",
  };

  const mimeType = typeMap[type.toLowerCase()] ?? type;

  const fileMetadata: drive_v3.Schema$File = {
    name,
    mimeType,
    parents: folderId ? [folderId] : undefined,
  };

  if (content && mimeType === "application/vnd.google-apps.document") {
    // Create doc with content by uploading as text and converting
    const res = await drive.files.create({
      requestBody: { ...fileMetadata, mimeType: "application/vnd.google-apps.document" },
      media: { mimeType: "text/plain", body: content },
      fields: FILE_FIELDS,
    });
    return parseFile(res.data);
  }

  if (content && mimeType === "application/vnd.google-apps.spreadsheet") {
    const res = await drive.files.create({
      requestBody: { ...fileMetadata, mimeType: "application/vnd.google-apps.spreadsheet" },
      media: { mimeType: "text/csv", body: content },
      fields: FILE_FIELDS,
    });
    return parseFile(res.data);
  }

  // Empty file or folder
  const res = await drive.files.create({
    requestBody: fileMetadata,
    fields: FILE_FIELDS,
  });
  return parseFile(res.data);
}

export async function uploadFile(
  config: OAuthConfig,
  accountId: string,
  name: string,
  content: string,
  mimeType?: string,
  folderId?: string,
): Promise<DriveFile> {
  await ensureFreshToken(config, accountId);
  const drive = getDriveClient(config, accountId);

  const res = await drive.files.create({
    requestBody: {
      name,
      parents: folderId ? [folderId] : undefined,
    },
    media: {
      mimeType: mimeType ?? "text/plain",
      body: content,
    },
    fields: FILE_FIELDS,
  });

  return parseFile(res.data);
}

export async function uploadFileFromPath(
  config: OAuthConfig,
  accountId: string,
  localPath: string,
  name: string,
  mimeType: string,
  folderId?: string,
): Promise<DriveFile> {
  await ensureFreshToken(config, accountId);
  const drive = getDriveClient(config, accountId);

  const res = await drive.files.create({
    requestBody: {
      name,
      parents: folderId ? [folderId] : undefined,
    },
    media: {
      mimeType,
      body: fs.createReadStream(localPath),
    },
    fields: FILE_FIELDS,
  });

  return parseFile(res.data);
}

export async function updateFile(
  config: OAuthConfig,
  accountId: string,
  fileId: string,
  content?: string,
  newName?: string,
): Promise<DriveFile> {
  await ensureFreshToken(config, accountId);
  const drive = getDriveClient(config, accountId);

  const meta = await drive.files.get({
    fileId,
    fields: "mimeType",
  });

  const mimeType = meta.data.mimeType ?? "";
  const requestBody: drive_v3.Schema$File = {};
  if (newName) requestBody.name = newName;

  if (content) {
    // For Google Docs, upload as plain text
    const uploadMime =
      mimeType === "application/vnd.google-apps.document"
        ? "text/plain"
        : mimeType === "application/vnd.google-apps.spreadsheet"
          ? "text/csv"
          : mimeType;

    const res = await drive.files.update({
      fileId,
      requestBody,
      media: { mimeType: uploadMime, body: content },
      fields: FILE_FIELDS,
    });
    return parseFile(res.data);
  }

  const res = await drive.files.update({
    fileId,
    requestBody,
    fields: FILE_FIELDS,
  });
  return parseFile(res.data);
}

export async function shareFile(
  config: OAuthConfig,
  accountId: string,
  fileId: string,
  email: string,
  role: string,
): Promise<DrivePermission> {
  await ensureFreshToken(config, accountId);
  const drive = getDriveClient(config, accountId);

  const res = await drive.permissions.create({
    fileId,
    requestBody: {
      type: "user",
      role,
      emailAddress: email,
    },
    fields: "id,type,role,emailAddress,displayName",
  });

  return {
    id: res.data.id ?? "",
    type: res.data.type ?? "",
    role: res.data.role ?? "",
    emailAddress: res.data.emailAddress ?? undefined,
    displayName: res.data.displayName ?? undefined,
  };
}

export async function getFileInfo(
  config: OAuthConfig,
  accountId: string,
  fileId: string,
): Promise<{
  file: DriveFile;
  permissions: DrivePermission[];
  revisionCount: number;
}> {
  await ensureFreshToken(config, accountId);
  const drive = getDriveClient(config, accountId);

  const fileMeta = await drive.files.get({
    fileId,
    fields: FILE_FIELDS,
  });

  let permissions: DrivePermission[] = [];
  try {
    const permRes = await drive.permissions.list({
      fileId,
      fields: "permissions(id,type,role,emailAddress,displayName)",
    });
    permissions = (permRes.data.permissions ?? []).map((p) => ({
      id: p.id ?? "",
      type: p.type ?? "",
      role: p.role ?? "",
      emailAddress: p.emailAddress ?? undefined,
      displayName: p.displayName ?? undefined,
    }));
  } catch {
    // Permissions may not be accessible
  }

  let revisionCount = 0;
  try {
    const revRes = await drive.revisions.list({
      fileId,
      fields: "revisions(id)",
    });
    revisionCount = (revRes.data.revisions ?? []).length;
  } catch {
    // Revisions may not be accessible for all file types
  }

  return {
    file: parseFile(fileMeta.data),
    permissions,
    revisionCount,
  };
}

export async function getStorageQuota(
  config: OAuthConfig,
  accountId: string,
): Promise<{
  limit: string;
  usage: string;
  usageInDrive: string;
  usageInTrash: string;
}> {
  await ensureFreshToken(config, accountId);
  const drive = getDriveClient(config, accountId);

  const res = await drive.about.get({
    fields: "storageQuota",
  });

  const quota = res.data.storageQuota ?? {};
  return {
    limit: quota.limit ?? "unlimited",
    usage: quota.usage ?? "0",
    usageInDrive: quota.usageInDrive ?? "0",
    usageInTrash: quota.usageInTrash ?? "0",
  };
}
