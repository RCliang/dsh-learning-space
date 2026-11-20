# 学习空间设计方案（learning-space）

参考 [amosblomqvist/learn](https://github.com/amosblomqvist/learn)（一套基于 pi 配置的个人 AI 学习系统），适配到本机 DSH（DeepSeek Harness）环境。

## 0. 参考仓库的核心思想

learn 仓库不是一个「笔记仓库」，而是**把教学哲学编码成 AI 配置**：

- `skills/teach/` —— 核心教学法，三条支柱：
  1. **无条件真理优先（Principle i）**：先找到学习者能"照单全收、不带前提"接受的少数硬事实，其余一切都从它们推导出来；
  2. **"我怎么可能自己发现这个？"（Principle ii）**：每一步都要有动机，让知识像被自己推出来而非被告知（3B1B 风格）；
  3. **probe → plan → teach 循环**：先出题定位理解的边界（找 edge），再对照教学法规划课程依赖图（DAG），每个节点走"动机→建立→连接→quiz 确认"四步，确认失败就停下修地基，绝不带病往前建。
- `skills/visualize/` —— 概念能用一张图说清时就配一张 mermaid 图。
- `extensions/` —— quiz（带即时反馈的分级选择题）、ask-user-question（弹窗提问）、md-log（把课程记录链接到会话）、visual-tools。
- `agents/` —— researcher（事实核查，防幻觉）、mermaid-maker、svg-maker 三个子代理。

## 1. 总体架构

DSH 原生有 skill、subagent、ask_user_question、定时任务等机制，可以直接对应，不需要移植 TS 扩展：

| learn 仓库 | 本空间对应物 | 说明 |
|---|---|---|
| skills/teach | `skills/teach/SKILL.md` | 教学法主文件，改写成中文、针对你个人调校 |
| skills/visualize | DSH 自带 `visualize` / `archify` 技能 | 不重复造，教学 skill 里引用即可 |
| extensions/quiz | quiz skill（`skills/quiz/SKILL.md`） | DSH 没有 quiz 弹窗扩展，降级为聊天内固定格式：选项+答题后即时反馈+解析 |
| extensions/ask-user-question | DSH 自带 `ask_user_question` 工具 | 原生支持，直接用 |
| extensions/md-log | 课程记录目录约定 + `lessons/` | 见下文目录结构 |
| agents/researcher | `subagent`（research 分支） | DSH 原生；教学 skill 里写明"拿不准的事实先派 researcher 核查" |
| agents/mermaid-maker / svg-maker | 主会话直接画 / subagent | Mermaid 在聊天里原生渲染，一般不必单独出代理 |

## 2. 目录结构

```
learning-space/
├── DESIGN.md              # 本文件
├── README.md              # 使用说明：怎么开始一节课
├── skills/
│   ├── teach/SKILL.md     # 教学法（核心资产）
│   └── quiz/SKILL.md      # 出题规范：裸选项、干扰项构造法、即时反馈格式
├── curriculum/            # 课程库：每个主题一个目录
│   └── <topic>/
│       ├── plan.md        # 依赖图（mermaid DAG）+ 教学顺序 + 进度勾选
│       ├── notes/         # 每节课产出的笔记（一个节点一篇）
│       └── mistakes.md    # 错题与误解记录（quiz 答错的地方，复习时优先看）
└── journal/               # 学习日志，按日期，一节课一行
```

`curriculum/<topic>/plan.md` 是对应 learn 仓库 Phase 2 的"依赖图"，也是整个空间的骨架：无条件真理画成根节点，目标画成汇点，每个节点教学前先问"这是根还是派生？"。

## 3. 一次学习会话的流程（teach skill 的骨架）

1. **Probe（定位边界）**：用 quiz 类选择题（有对错可判分的）二分定位你"会什么/不会什么"；用 ask_user_question 问学习目标（没有标准答案的）。全对不代表会，继续加难度直到出错。
2. **Plan（规划）**：先派 researcher 子代理扫一遍主题的硬事实，再画出依赖 DAG，在聊天里展示，等你点头才开课。
3. **Teach（逐节点循环）**：每个节点走四步——动机（为什么现在需要它）→ 建立（根节点直陈，派生节点苏格拉底式引导你自己发现）→ 连接（挂到已确认的节点上）→ quiz 确认（没确认就不往上建）。中途任何拿不准的事实，停下来派 researcher 核查。
4. **沉淀**：课后把节点笔记写进 `notes/`，错题记进 `mistakes.md`，journal 加一行。

## 4. 与参考仓库的差异和取舍

- **quiz 降级为聊天格式**：DSH 没有弹窗式 quiz 扩展，改为固定 markdown 格式（选项裸列、答后给 ✅/❌ + 解析）。视觉上不如原版，但"可判分 + 即时反馈"的核心保留。如果后面想升级，可以用 DSH 的 canvas 技能做成可交互答题页。
- **教学 skill 中文化并个人化**：原 skill 是写给作者本人的。搬运时保留两大原则和三阶段流程不动，把措辞改成中文，并留一个"个人偏好"段（比如你喜欢苏格拉底式还是讲授式的默认比例）。
- **不移植 md-log/visual-tools 扩展**：功能被目录约定 + DSH 自带可视化能力覆盖，少维护一份 TS 代码。
- **researcher 保留为硬约束**：原仓库"拿不准就核查，别硬编"这条对 LLM 教学最关键，写进 teach skill 的强制条款。

## 5. 实施步骤

1. 写 `skills/teach/SKILL.md`（翻译+改写原版教学法，中文）；
2. 写 `skills/quiz/SKILL.md`（出题规范：干扰项从正确答案变形而来、选项裸列不写"为什么"）；
3. 建目录骨架 + README；
4. 挑第一个主题试跑一节课，按体感回头调 skill。

## 6. 待你确认的问题

- 第一个学习主题想学什么？
- 默认教学风格：偏苏格拉底式（多提问让你自己推），还是偏讲解式（先讲清再验证）？原版默认前者。
- 笔记语言：中文为主、术语保留英文？
