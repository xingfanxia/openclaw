import { google, gmail_v1 } from "googleapis";
import type { OAuthConfig } from "./oauth2.js";
import { createOAuth2Client } from "./oauth2.js";
import { refreshAccessToken } from "./oauth2.js";
import { getToken, isTokenExpired, setToken } from "./token-store.js";

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  labels: string[];
  listUnsubscribe?: string;
  body?: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyToMessageId?: string;
}

function getAuthenticatedClient(
  oauthConfig: OAuthConfig,
  accountId: string,
): { gmail: gmail_v1.Gmail; token: ReturnType<typeof getToken> } {
  const token = getToken(accountId);
  if (!token) {
    throw new Error(
      `Account "${accountId}" is not authenticated. Use /gmail_auth ${accountId} to connect.`,
    );
  }

  const oauth2Client = createOAuth2Client(oauthConfig);
  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiryDate,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  return { gmail, token };
}

async function ensureFreshToken(oauthConfig: OAuthConfig, accountId: string): Promise<void> {
  const token = getToken(accountId);
  if (!token) return;

  if (isTokenExpired(token)) {
    const refreshed = await refreshAccessToken(oauthConfig, token.refreshToken);
    setToken({
      ...token,
      accessToken: refreshed.accessToken,
      expiryDate: refreshed.expiryDate,
    });
  }
}

function parseEmailHeaders(headers: gmail_v1.Schema$MessagePartHeader[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers) {
    if (header.name && header.value) {
      result[header.name.toLowerCase()] = header.value;
    }
  }
  return result;
}

function messageToEmail(msg: gmail_v1.Schema$Message): EmailMessage {
  const headers = parseEmailHeaders(msg.payload?.headers ?? []);
  return {
    id: msg.id ?? "",
    threadId: msg.threadId ?? "",
    from: headers["from"] ?? "",
    to: headers["to"] ?? "",
    subject: headers["subject"] ?? "(no subject)",
    snippet: msg.snippet ?? "",
    date: headers["date"] ?? "",
    labels: msg.labelIds ?? [],
    listUnsubscribe: headers["list-unsubscribe"],
  };
}

export async function listUnread(
  oauthConfig: OAuthConfig,
  accountId: string,
  maxResults: number = 20,
): Promise<EmailMessage[]> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread",
    maxResults,
  });

  const messages = listRes.data.messages ?? [];
  const emails: EmailMessage[] = [];

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date", "List-Unsubscribe"],
    });
    emails.push(messageToEmail(full.data));
  }

  return emails;
}

export async function searchEmails(
  oauthConfig: OAuthConfig,
  accountId: string,
  query: string,
  maxResults: number = 20,
): Promise<EmailMessage[]> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = listRes.data.messages ?? [];
  const emails: EmailMessage[] = [];

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date", "List-Unsubscribe"],
    });
    emails.push(messageToEmail(full.data));
  }

  return emails;
}

export async function sendEmail(
  oauthConfig: OAuthConfig,
  accountId: string,
  params: SendEmailParams,
): Promise<{ messageId: string; threadId: string }> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail, token } = getAuthenticatedClient(oauthConfig, accountId);

  const lines: string[] = [];
  lines.push(`From: ${token!.email}`);
  lines.push(`To: ${params.to}`);
  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  lines.push(`Subject: ${params.subject}`);
  if (params.replyToMessageId) {
    lines.push(`In-Reply-To: ${params.replyToMessageId}`);
    lines.push(`References: ${params.replyToMessageId}`);
  }
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("");
  lines.push(params.body);

  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId: params.replyToMessageId ? undefined : undefined },
  });

  return {
    messageId: res.data.id ?? "",
    threadId: res.data.threadId ?? "",
  };
}

export async function unsubscribe(
  oauthConfig: OAuthConfig,
  accountId: string,
  messageId: string,
): Promise<{ success: boolean; method: string; detail: string }> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["List-Unsubscribe", "From"],
  });

  const headers = parseEmailHeaders(msg.data.payload?.headers ?? []);
  const unsubHeader = headers["list-unsubscribe"];
  const from = headers["from"] ?? "";

  if (!unsubHeader) {
    return {
      success: false,
      method: "none",
      detail: `No List-Unsubscribe header found on message from ${from}`,
    };
  }

  // Try mailto: unsubscribe
  const mailtoMatch = unsubHeader.match(/<mailto:([^>]+)>/);
  if (mailtoMatch) {
    const unsubEmail = mailtoMatch[1];
    const raw = Buffer.from(
      [
        `From: me`,
        `To: ${unsubEmail}`,
        `Subject: Unsubscribe`,
        `Content-Type: text/plain; charset=utf-8`,
        "",
        "Unsubscribe",
      ].join("\r\n"),
    ).toString("base64url");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    return {
      success: true,
      method: "mailto",
      detail: `Sent unsubscribe email to ${unsubEmail}`,
    };
  }

  // URL-based unsubscribe
  const urlMatch = unsubHeader.match(/<(https?:\/\/[^>]+)>/);
  if (urlMatch) {
    return {
      success: true,
      method: "url",
      detail: `Unsubscribe URL: ${urlMatch[1]} — open this link to complete unsubscription`,
    };
  }

  return {
    success: false,
    method: "unknown",
    detail: `Unrecognized List-Unsubscribe format: ${unsubHeader}`,
  };
}

export async function blockSender(
  oauthConfig: OAuthConfig,
  accountId: string,
  senderEmail: string,
): Promise<{ filterId: string }> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  const res = await gmail.users.settings.filters.create({
    userId: "me",
    requestBody: {
      criteria: { from: senderEmail },
      action: { removeLabelIds: ["INBOX"], addLabelIds: ["TRASH"] },
    },
  });

  return { filterId: res.data.id ?? "" };
}

export async function getProfile(
  oauthConfig: OAuthConfig,
  accountId: string,
): Promise<{ email: string; messagesTotal: number; threadsTotal: number }> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  const res = await gmail.users.getProfile({ userId: "me" });
  return {
    email: res.data.emailAddress ?? "",
    messagesTotal: res.data.messagesTotal ?? 0,
    threadsTotal: res.data.threadsTotal ?? 0,
  };
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
}

export interface FilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
}

export interface FilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
}

export interface GmailFilter {
  id: string;
  criteria: FilterCriteria;
  action: FilterAction;
}

export async function listLabels(
  oauthConfig: OAuthConfig,
  accountId: string,
): Promise<GmailLabel[]> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  const res = await gmail.users.labels.list({ userId: "me" });
  const labels = res.data.labels ?? [];
  return labels.map((l) => ({
    id: l.id ?? "",
    name: l.name ?? "",
    type: l.type ?? "",
    messageListVisibility: l.messageListVisibility ?? undefined,
    labelListVisibility: l.labelListVisibility ?? undefined,
  }));
}

export async function createLabel(
  oauthConfig: OAuthConfig,
  accountId: string,
  labelName: string,
): Promise<GmailLabel> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  const res = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      messageListVisibility: "show",
      labelListVisibility: "labelShow",
    },
  });

  return {
    id: res.data.id ?? "",
    name: res.data.name ?? "",
    type: res.data.type ?? "",
  };
}

export async function findOrCreateLabel(
  oauthConfig: OAuthConfig,
  accountId: string,
  labelName: string,
): Promise<GmailLabel> {
  const labels = await listLabels(oauthConfig, accountId);
  const existing = labels.find((l) => l.name.toLowerCase() === labelName.toLowerCase());
  if (existing) {
    return existing;
  }

  // For nested labels like "GitHub/CI", ensure parent exists first
  const parts = labelName.split("/");
  if (parts.length > 1) {
    const parentName = parts.slice(0, -1).join("/");
    const parentExists = labels.find((l) => l.name.toLowerCase() === parentName.toLowerCase());
    if (!parentExists) {
      await createLabel(oauthConfig, accountId, parentName);
    }
  }

  return await createLabel(oauthConfig, accountId, labelName);
}

export async function createFilter(
  oauthConfig: OAuthConfig,
  accountId: string,
  criteria: FilterCriteria,
  action: FilterAction,
): Promise<{ filterId: string }> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  const requestBody: gmail_v1.Schema$Filter = {
    criteria: {
      from: criteria.from,
      to: criteria.to,
      subject: criteria.subject,
      query: criteria.query,
      negatedQuery: criteria.negatedQuery,
      hasAttachment: criteria.hasAttachment,
    },
    action: {
      addLabelIds: action.addLabelIds,
      removeLabelIds: action.removeLabelIds,
      forward: action.forward,
    },
  };

  const res = await gmail.users.settings.filters.create({
    userId: "me",
    requestBody,
  });

  return { filterId: res.data.id ?? "" };
}

export async function listFilters(
  oauthConfig: OAuthConfig,
  accountId: string,
): Promise<GmailFilter[]> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  const res = await gmail.users.settings.filters.list({ userId: "me" });
  const filters = res.data.filter ?? [];
  return filters.map((f) => ({
    id: f.id ?? "",
    criteria: {
      from: f.criteria?.from ?? undefined,
      to: f.criteria?.to ?? undefined,
      subject: f.criteria?.subject ?? undefined,
      query: f.criteria?.query ?? undefined,
      negatedQuery: f.criteria?.negatedQuery ?? undefined,
      hasAttachment: f.criteria?.hasAttachment ?? undefined,
    },
    action: {
      addLabelIds: f.action?.addLabelIds ?? undefined,
      removeLabelIds: f.action?.removeLabelIds ?? undefined,
      forward: f.action?.forward ?? undefined,
    },
  }));
}

export async function deleteFilter(
  oauthConfig: OAuthConfig,
  accountId: string,
  filterId: string,
): Promise<void> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  await gmail.users.settings.filters.delete({
    userId: "me",
    id: filterId,
  });
}

export async function deleteLabel(
  oauthConfig: OAuthConfig,
  accountId: string,
  labelId: string,
): Promise<void> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  await gmail.users.labels.delete({
    userId: "me",
    id: labelId,
  });
}

export async function readEmail(
  oauthConfig: OAuthConfig,
  accountId: string,
  messageId: string,
): Promise<{
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  labels: string[];
  body: string;
  bodyHtml: string;
  attachments: Array<{ filename: string; mimeType: string; size: number }>;
}> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = parseEmailHeaders(msg.data.payload?.headers ?? []);

  function extractBody(payload: gmail_v1.Schema$MessagePart | undefined, mimeType: string): string {
    if (!payload) return "";
    if (payload.mimeType === mimeType && payload.body?.data) {
      return Buffer.from(payload.body.data, "base64url").toString("utf-8");
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        const found = extractBody(part, mimeType);
        if (found) return found;
      }
    }
    return "";
  }

  function extractAttachments(
    payload: gmail_v1.Schema$MessagePart | undefined,
  ): Array<{ filename: string; mimeType: string; size: number }> {
    const result: Array<{ filename: string; mimeType: string; size: number }> = [];
    if (!payload) return result;
    if (payload.filename && payload.body?.size) {
      result.push({
        filename: payload.filename,
        mimeType: payload.mimeType ?? "application/octet-stream",
        size: payload.body.size,
      });
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        result.push(...extractAttachments(part));
      }
    }
    return result;
  }

  const body = extractBody(msg.data.payload, "text/plain");
  const bodyHtml = extractBody(msg.data.payload, "text/html");
  const attachments = extractAttachments(msg.data.payload);

  return {
    id: msg.data.id ?? "",
    threadId: msg.data.threadId ?? "",
    from: headers["from"] ?? "",
    to: headers["to"] ?? "",
    cc: headers["cc"] ?? "",
    subject: headers["subject"] ?? "(no subject)",
    date: headers["date"] ?? "",
    labels: msg.data.labelIds ?? [],
    body,
    bodyHtml: bodyHtml ? "(html content available)" : "",
    attachments,
  };
}

export async function modifyMessage(
  oauthConfig: OAuthConfig,
  accountId: string,
  messageId: string,
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<void> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: addLabelIds ?? [],
      removeLabelIds: removeLabelIds ?? [],
    },
  });
}

export async function batchModifyMessages(
  oauthConfig: OAuthConfig,
  accountId: string,
  messageIds: string[],
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<void> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: {
      ids: messageIds,
      addLabelIds: addLabelIds ?? [],
      removeLabelIds: removeLabelIds ?? [],
    },
  });
}

export async function trashMessage(
  oauthConfig: OAuthConfig,
  accountId: string,
  messageId: string,
): Promise<void> {
  await ensureFreshToken(oauthConfig, accountId);
  const { gmail } = getAuthenticatedClient(oauthConfig, accountId);

  await gmail.users.messages.trash({
    userId: "me",
    id: messageId,
  });
}
