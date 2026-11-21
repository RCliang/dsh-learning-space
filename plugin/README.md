# dsh-learn-space

DeepSeek Harness（dsh）的学习空间插件：AI 辅导的个人学习面板。教学在 dsh 聊天里进行，进度沉淀为工作区里的 Markdown 文件。

## 功能

- **两阶段教学**：摸底定位水平 → 生成课程依赖图（mermaid DAG）→ 逐节点教学，quiz 确认后才解锁下一节点
- **学习面板**：侧边栏入口，课程进度、知识节点（点开看教学内容）、错题本、学习记录、答题历史
- **公式渲染**：面板内用内置 KaTeX 渲染 LaTeX（行内 `$…$`、块级 `$$…$$`），资产加载失败时降级显示原始 TeX
- **数据沉淀**：`curriculum/<主题>/`（plan.md 依赖图 + notes/ 教学笔记 + mistakes.md 错题 + study-log.md）、`journal/YYYY-MM.md` 学习日志
- **导出学习报告**：自包含 HTML（内嵌 mermaid 渲染），含每个节点的学习内容/教学笔记、学习记录、答题历史、错题
- **资料支持**：上传资料放 `materials/<主题>/`，或让 AI 上网检索核实后规划

## 安装

在 dsh 插件搜索中搜 `dsh-learn-space` 安装；或手动在 profile 目录：

```bash
pnpm add dsh-learn-space
```

然后把 `dsh-learn-space` 加入 profile `package.json` 的 `dsh.profile.bundles` 列表。

## 配置

插件自带挂载声明，默认数据根目录为进程工作目录。想固定数据目录，在 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: learning-space
  name: dsh-learn-space
  config:
    root: 'D:/my-learning-space'
```

## 开始一节课

对 AI 说：**「用 teach 开始学 <主题>」**。AI 会先问学习目标与资料来源，出题摸底后展示依赖图计划，你点头即开课。教学法（teach/quiz 两个 skill）随包内置，工作区 `skills/` 下有同名文件时优先用工作区的（可定制）。

## 节点状态标记（plan.md checkbox）

- `[x]` 已确认（quiz 通过）
- `[~]` 进行中
- `[!]` 有错题待修复
- `[ ]` 未学

## License

MIT