import type { EmailMessage } from "./gmail-client.js";

export type EmailCategory =
  | "important"
  | "actionable"
  | "newsletter"
  | "marketing"
  | "spam"
  | "social"
  | "transactional";

export interface ClassifiedEmail extends EmailMessage {
  category: EmailCategory;
  confidence: number;
  reason: string;
}

export interface DigestSection {
  category: EmailCategory;
  count: number;
  emails: ClassifiedEmail[];
}

export interface Digest {
  generatedAt: string;
  totalEmails: number;
  sections: DigestSection[];
  actionItems: string[];
  followUpSuggestions: string[];
  cleanupSummary: {
    unsubscribed: number;
    blocked: number;
    archived: number;
  };
}

const MARKETING_KEYWORDS = [
  "unsubscribe",
  "opt out",
  "email preferences",
  "manage subscriptions",
  "promotional",
  "limited time",
  "% off",
  "sale ends",
  "deal of the day",
  "free shipping",
  "click here to buy",
];

const SPAM_KEYWORDS = [
  "congratulations you won",
  "claim your prize",
  "act now",
  "nigerian prince",
  "wire transfer",
  "crypto opportunity",
  "double your money",
  "guaranteed income",
];

const NEWSLETTER_KEYWORDS = [
  "newsletter",
  "weekly digest",
  "daily brief",
  "roundup",
  "this week in",
  "edition #",
  "issue #",
];

const SOCIAL_PATTERNS = [
  /.*@(facebook|twitter|linkedin|instagram|tiktok|reddit)\..*/i,
  /notification/i,
  /mentioned you/i,
  /commented on/i,
  /liked your/i,
  /new follower/i,
];

const TRANSACTIONAL_PATTERNS = [
  /order.*confirm/i,
  /receipt/i,
  /invoice/i,
  /payment.*received/i,
  /shipping.*update/i,
  /delivery.*notification/i,
  /password.*reset/i,
  /verification.*code/i,
  /two-factor/i,
];

function matchesKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let matches = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword.toLowerCase())) {
      matches++;
    }
  }
  return matches;
}

function matchesPatterns(text: string, patterns: RegExp[]): number {
  let matches = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      matches++;
    }
  }
  return matches;
}

export function classifyEmail(email: EmailMessage): ClassifiedEmail {
  const text = `${email.from} ${email.subject} ${email.snippet}`;

  const scores: Record<EmailCategory, number> = {
    important: 0,
    actionable: 0,
    newsletter: 0,
    marketing: 0,
    spam: 0,
    social: 0,
    transactional: 0,
  };

  // Spam detection
  scores.spam = matchesKeywords(text, SPAM_KEYWORDS) * 3;

  // Marketing detection
  scores.marketing = matchesKeywords(text, MARKETING_KEYWORDS) * 2;
  if (email.listUnsubscribe) {
    scores.marketing += 2;
    scores.newsletter += 1;
  }

  // Newsletter detection
  scores.newsletter += matchesKeywords(text, NEWSLETTER_KEYWORDS) * 2;

  // Social detection
  scores.social = matchesPatterns(text, SOCIAL_PATTERNS) * 2;

  // Transactional detection
  scores.transactional = matchesPatterns(text, TRANSACTIONAL_PATTERNS) * 2;

  // Actionable heuristics
  const actionableWords = [
    "urgent",
    "asap",
    "deadline",
    "action required",
    "please review",
    "approval needed",
    "respond by",
  ];
  scores.actionable = matchesKeywords(text, actionableWords) * 2;

  // Important heuristics — direct email with no bulk headers
  if (
    !email.listUnsubscribe &&
    scores.marketing === 0 &&
    scores.spam === 0 &&
    scores.social === 0
  ) {
    scores.important += 2;
  }

  // Find top category
  let topCategory: EmailCategory = "important";
  let topScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    if (score > topScore) {
      topScore = score;
      topCategory = category as EmailCategory;
    }
  }

  // Default to important if no clear signal
  if (topScore === 0) {
    topCategory = "important";
    topScore = 1;
  }

  const maxPossible = Math.max(topScore, 1);
  const confidence = Math.min(topScore / (maxPossible + 2), 1);

  const reasons: Record<EmailCategory, string> = {
    important: "Direct email with no bulk indicators",
    actionable: "Contains action-required language",
    newsletter: "Matches newsletter patterns",
    marketing: "Contains marketing/promotional content",
    spam: "Contains spam indicators",
    social: "Social media notification",
    transactional: "Order/receipt/verification email",
  };

  return {
    ...email,
    category: topCategory,
    confidence,
    reason: reasons[topCategory],
  };
}

export function classifyEmails(emails: EmailMessage[]): ClassifiedEmail[] {
  return emails.map(classifyEmail);
}

export function generateDigest(
  classifiedEmails: ClassifiedEmail[],
  cleanupSummary: { unsubscribed: number; blocked: number; archived: number } = {
    unsubscribed: 0,
    blocked: 0,
    archived: 0,
  },
): Digest {
  const categories: EmailCategory[] = [
    "important",
    "actionable",
    "transactional",
    "social",
    "newsletter",
    "marketing",
    "spam",
  ];

  const sections: DigestSection[] = [];
  for (const category of categories) {
    const emails = classifiedEmails.filter((e) => e.category === category);
    if (emails.length > 0) {
      sections.push({ category, count: emails.length, emails });
    }
  }

  const actionItems: string[] = [];
  const actionable = classifiedEmails.filter(
    (e) => e.category === "actionable" || e.category === "important",
  );
  for (const email of actionable) {
    actionItems.push(`[${email.category.toUpperCase()}] "${email.subject}" from ${email.from}`);
  }

  const followUpSuggestions: string[] = [];
  const oldUnread = classifiedEmails.filter((e) => {
    const emailDate = new Date(e.date);
    const daysSince = (Date.now() - emailDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > 3 && (e.category === "important" || e.category === "actionable");
  });
  for (const email of oldUnread) {
    followUpSuggestions.push(`"${email.subject}" from ${email.from} — unread for over 3 days`);
  }

  return {
    generatedAt: new Date().toISOString(),
    totalEmails: classifiedEmails.length,
    sections,
    actionItems,
    followUpSuggestions,
    cleanupSummary,
  };
}

export function formatDigestAsText(digest: Digest): string {
  const lines: string[] = [];
  lines.push("=== Gmail Daily Digest ===");
  lines.push(`Generated: ${digest.generatedAt}`);
  lines.push(`Total unread: ${digest.totalEmails}`);
  lines.push("");

  if (digest.actionItems.length > 0) {
    lines.push("--- Action Items ---");
    for (const item of digest.actionItems) {
      lines.push(`  * ${item}`);
    }
    lines.push("");
  }

  for (const section of digest.sections) {
    lines.push(`--- ${section.category.toUpperCase()} (${section.count}) ---`);
    for (const email of section.emails) {
      lines.push(`  * "${email.subject}" from ${email.from}`);
    }
    lines.push("");
  }

  if (digest.followUpSuggestions.length > 0) {
    lines.push("--- Follow-up Suggestions ---");
    for (const suggestion of digest.followUpSuggestions) {
      lines.push(`  * ${suggestion}`);
    }
    lines.push("");
  }

  lines.push("--- Cleanup Summary ---");
  lines.push(`  Unsubscribed: ${digest.cleanupSummary.unsubscribed}`);
  lines.push(`  Blocked: ${digest.cleanupSummary.blocked}`);
  lines.push(`  Archived: ${digest.cleanupSummary.archived}`);

  return lines.join("\n");
}
