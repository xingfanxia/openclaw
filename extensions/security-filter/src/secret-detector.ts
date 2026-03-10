export interface SecretPattern {
  name: string;
  regex: RegExp;
}

export interface DetectionResult {
  patternName: string;
  match: string;
  startIndex: number;
  endIndex: number;
}

const DEFAULT_PATTERNS: ReadonlyArray<SecretPattern> = [
  {
    name: "Anthropic API Key",
    regex: /sk-ant-[a-zA-Z0-9_-]{95,}/g,
  },
  {
    name: "OpenAI API Key",
    regex: /sk-[a-zA-Z0-9]{48}/g,
  },
  {
    name: "GitHub Token",
    regex: /ghp_[a-zA-Z0-9]{36}/g,
  },
  {
    name: "Google API Key",
    regex: /AIza[0-9A-Za-z_-]{35}/g,
  },
  {
    name: "AWS Access Key",
    regex: /AKIA[0-9A-Z]{16}/g,
  },
  {
    name: "Slack Token",
    regex: /xox[baprs]-[0-9a-zA-Z-]{10,}/g,
  },
  {
    name: "Private Key",
    regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----/g,
  },
  {
    name: "Password-like",
    regex: /(?:password|secret|token|key)[\s:=]+["']?([^\s"']{16,})/gi,
  },
  {
    name: "Generic JWT",
    regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  },
  {
    name: "Discord Token",
    regex: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/g,
  },
];

export class SecretDetector {
  private patterns: SecretPattern[];
  private allowlist: Set<string>;

  constructor(
    allowlist: string[] = [],
    customPatterns: Array<{ name: string; regex: string; flags?: string }> = [],
  ) {
    this.allowlist = new Set(allowlist);

    const basePatterns = DEFAULT_PATTERNS.filter((p) => !this.allowlist.has(p.name));

    const userPatterns: SecretPattern[] = customPatterns
      .filter((p) => !this.allowlist.has(p.name))
      .map((p) => ({
        name: p.name,
        regex: new RegExp(p.regex, p.flags ?? "g"),
      }));

    this.patterns = [...basePatterns, ...userPatterns];
  }

  detect(text: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    for (const pattern of this.patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        results.push({
          patternName: pattern.name,
          match: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      }
    }

    return results.sort((a, b) => a.startIndex - b.startIndex);
  }

  hasSecrets(text: string): boolean {
    for (const pattern of this.patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      if (regex.test(text)) {
        return true;
      }
    }
    return false;
  }

  getPatternNames(): string[] {
    return this.patterns.map((p) => p.name);
  }
}
