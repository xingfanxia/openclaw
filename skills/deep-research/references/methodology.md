# Deep Research Workflow (深度调研工作流)

Platform-agnostic methodology for multi-agent parallel research with cross-validation.

## 4-Phase Workflow

### Phase 1: Scan (摸底扫描)

Goal: Understand the landscape and design research dimensions.

1. Perform 2-3 broad searches on the topic
2. Identify 3-5 research dimensions (维度) based on topic type
3. Ensure ≥50% overlap between adjacent dimensions (for cross-validation)
4. Output: dimension list with brief rationale and overlap mapping

### Phase 2: Split & Parallel Research (拆分并行调研)

Goal: Gather deep, traceable evidence across all dimensions.

1. Spawn one research agent per dimension
2. Each agent must:
   - Search both supportive AND critical/negative perspectives
   - Record every claim with its source URL and original quote
   - Cover its primary dimension plus assigned overlap areas
   - Write structured Markdown output to a designated file
3. Agent output format per finding:
   ```
   ### [Finding Title]
   - **Claim**: [specific claim]
   - **Source**: [URL]
   - **Quote**: "[original text from source]"
   - **Perspective**: [supportive/critical/neutral]
   ```

### Phase 3: Cross-Validate (交叉验证)

Goal: Assess reliability by comparing overlapping findings across agents.

1. Read all raw dimension files
2. For each claim, classify as:
   - **Corroborated** (佐证): 2+ agents found consistent evidence from independent sources
   - **Contradicted** (矛盾): agents found conflicting evidence — flag for deeper analysis
   - **Single-source** (孤证): only one agent found it — mark confidence as low
3. Build a validation matrix: claim × dimension × source count
4. Resolve contradictions by checking source credibility and recency

### Phase 4: Report (撰写报告)

Goal: Synthesize a single, traceable deliverable.

1. Structure report by insight themes (not by dimension)
2. Lead with conclusions and recommendations
3. Every key claim must have inline citation: `[来源](URL)`
4. Include a "Reliability" section summarizing cross-validation results
5. Include a "Limitations & Gaps" section for single-source or unresolved contradictions
6. Write in Chinese by default (unless user specifies otherwise)
7. Output as a standalone file — never paste full report in chat

## Core Principles

- **Cross-validation is mandatory**: dimensions must overlap ≥50% so findings can be independently verified
- **URL traceability**: every factual claim needs a URL + original quote, not a summary
- **Single deliverable**: one polished report file, not scattered notes
- **Critical perspective**: each dimension must include negative/critical search, not just confirmatory
- **File-based output**: agents write to files, main agent reads files — no in-memory passing

## Dimension Design Patterns

| Topic Type                | Suggested Dimensions                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Product comparison**    | Features & pricing, User reviews & sentiment, Technical architecture, Market position, Migration/switching cost |
| **Course/education**      | Curriculum & depth, Instructor credibility, Student outcomes, Price-value ratio, Alternatives comparison        |
| **Company analysis**      | Business model, Financial health, Team & leadership, Market competition, Risk factors                           |
| **Technology evaluation** | Core capabilities, Ecosystem & community, Performance benchmarks, Learning curve, Production readiness          |
| **Opinion/controversy**   | Supporting arguments, Opposing arguments, Expert consensus, Historical context, Stakeholder impact              |

## URL Citation Standards

Every factual claim in the report must include:

1. **Source URL** — the actual page where the information was found
2. **Original quote** — verbatim text from the source (not paraphrased)
3. **Access date** — when the source was accessed (for volatile content)

Format: `[来源标题](URL)` inline, with quotes in the findings file.

Anti-patterns to avoid:

- Citing a search engine results page instead of the actual article
- Summarizing without quoting — makes verification impossible
- Using URLs from memory without actually visiting them in this session

## Pitfalls & Countermeasures

| Pitfall                                     | Countermeasure                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| Echo chamber (all agents find same sources) | Require different search queries per dimension; include negative keywords |
| URL rot / inaccessible pages                | Cache raw content locally; note access failures in report                 |
| Confirmation bias                           | Mandate critical/negative search in every dimension                       |
| Shallow coverage                            | Set minimum finding count per dimension (e.g., ≥5 findings)               |
| Over-reliance on single source              | Cross-validation matrix catches this; flag single-source claims           |
| Report reads as info dump                   | Structure by insight, lead with conclusions, not by dimension             |

## Quality Checklist

Before delivering the report:

- [ ] Every key claim has a URL citation
- [ ] Cross-validation matrix shows ≥2 corroborated sources for major conclusions
- [ ] Critical/negative perspectives are included (not just positive)
- [ ] Single-source claims are explicitly flagged as low-confidence
- [ ] Report is structured by insight themes, not by research dimension
- [ ] Conclusions and recommendations are actionable
- [ ] Report is a standalone file with clear title and date
- [ ] Language matches user preference (default: Chinese)
