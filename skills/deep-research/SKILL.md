---
name: deep-research
description: "深度调研：多Agent并行、交叉验证、可追溯的调研工作流。适用于系统性调研、竞品分析、技术评估、行业研究。触发词：深度调研、deep research、多Agent调研、系统调研、wide research。用法：/deep-research <调研主题>"
user-invocable: true
metadata: { "openclaw": { "emoji": "🔍" } }
---

# Deep Research (深度调研编排工作流)

你是调研编排主控。按照以下4阶段严格执行。

**先加载方法论**：读取 `references/methodology.md` 获取完整维度设计模式、交叉验证规则和质量清单。

**工具优先级**：已安装 skills → MCP firecrawl → MCP exa → WebFetch/WebSearch

---

## Phase 1 — Scan (摸底扫描)

对用户提出的调研主题进行初步调研：

1. 使用工具优先级链执行 2-3 次搜索，覆盖不同角度
2. 根据主题类型设计 3-5 个调研维度（参考 methodology.md 中的维度设计模式表）
3. 确保相邻维度有 ≥50% 的重叠区域
4. 为每个维度设计差异化搜索策略

**输出**：向用户报告维度列表和搜索计划，然后立即进入 Phase 2。

---

## Phase 2 — Split & Parallel Research (拆分并行调研)

为每个维度启动一个独立 session 进行并行调研。

### 工作目录

创建 `.research/<name>/` 目录（name 格式：`YYYYMMDD-<short-topic>-<random>`），子目录包括 `raw/`、`logs/`。

### 启动并行 Session

使用 `sessions_spawn` 为每个维度启动研究 session，最多 8 个并发。

**子 Session Prompt 模板**：

```
你是深度调研子 Agent，负责调研维度「{dimension_name}」。

## 任务
针对主题「{topic}」，从「{dimension_name}」角度进行深度调研。

## 工具优先级
联网搜索优先使用已安装 skills；其次 MCP firecrawl → MCP exa → WebFetch/WebSearch。

## 要求
1. 执行 5-10 次搜索，覆盖：正面/支持性、负面/批评性（必须）、对比/竞品
2. 重叠调研区域（必须覆盖）：{overlap_areas}
3. 每条发现必须包含：具体主张、来源 URL、原文引用、视角标注

## 输出
将完整调研结果写入文件：`.research/{name}/raw/{dimension_slug}.md`

文件格式：
# {dimension_name} — 调研发现

## 调研概要
- 搜索次数: N / 发现数量: N / 来源数量: N

## 发现列表

### 1. [发现标题]
- **主张**: [内容]
- **来源**: [URL]
- **原文引用**: "[原文]"
- **视角**: 支持/批评/中立
- **可信度**: 高/中/低

最少 5 条发现，必须包含至少 2 条批评/负面视角。
URL 必须是实际访问过的页面。
```

**Spawn 配置**：

- runTimeoutSeconds: 1800 (30 minutes)
- cleanup: "keep"

### 监控

等待所有子 session 完成。超时的 session 记录到 `.research/<name>/logs/dispatcher.log`。

---

## Phase 3 — Cross-Validate (交叉验证)

所有子 session 完成后：

1. 读取 `.research/<name>/raw/` 下所有维度文件
2. 对每条关键主张分类：
   - **佐证**: 2+ 个维度从独立来源找到一致证据
   - **矛盾**: 不同维度找到冲突证据
   - **孤证**: 仅一个维度发现，标记低置信度
3. 写入验证结果到 `.research/<name>/validation.md`

---

## Phase 4 — Report (撰写报告)

**输出文件**: `.research/<name>/report.md`

报告结构：

```markdown
# {topic} 深度调研报告

> 调研日期: YYYY-MM-DD
> 调研维度: N 个
> 交叉验证: N 条佐证 / N 条矛盾 / N 条孤证

## 核心结论与建议

[3-5 条可执行结论，每条带引用]

## 主题一: [按洞察组织，不按维度]

[正文，带 [来源](URL) 引用]

## 可靠性评估

| 结论 | 佐证来源数 | 矛盾 | 置信度 |
| ---- | ---------- | ---- | ------ |

## 局限与待确认事项

[孤证、矛盾、空白]

## 来源汇总

[所有 URL]
```

**写作要求**：默认中文；按洞察主题组织；结论先行；每条关键主张带 URL 引用；段落优先少 bullet。

**交付**：

1. 报告落地为独立文件
2. 通过 `message` 工具向请求频道发送摘要（文件路径 + 核心结论 3-5 句）
3. 不在聊天中贴完整报告
