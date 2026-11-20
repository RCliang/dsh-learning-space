# learning-space 学习空间

AI 辅导的个人学习空间：教学在 DSH 聊天里进行，进度沉淀为本地 Markdown 文件，`mockup/` 是配套 UI 面板的原型。

DSH 插件已发布为 [dsh-learn-space](https://www.npmjs.com/package/dsh-learn-space)，在 dsh 插件搜索中即可安装；插件说明见 [plugin/README.md](plugin/README.md)。

> 本仓库只含插件代码、教学法 skill 与设计文档；个人学习数据（curriculum/ journal/ materials/）不入库。

## 怎么开始一节课

直接对 AI 说：**"用 teach 开始学 <主题>"**，然后：

1. AI 会先问你的学习目标（说得越具体，课越准）；
2. 问资料来源：
   - **自带资料** —— 把文件放进 `materials/<主题>/`（PDF / Markdown / 代码 / 任何文本），告诉 AI"资料在 materials 里"；
   - **网上获取** —— 说"没资料，你去查"，AI 会派研究员子代理扫主题、核实事实后再规划；
3. 出几道题定位你现在的水平 → 展示课程依赖图 → 你点头 → 开课。

## 目录

```
skills/teach/      教学法（probe → plan → teach，无条件真理优先）
skills/quiz/       出题规范（裸选项、干扰项构造、即时反馈）
curriculum/<topic>/plan.md      课程依赖图 + 节点状态
curriculum/<topic>/notes/       每个已确认节点一篇笔记
curriculum/<topic>/mistakes.md  错题本
materials/<topic>/              你上传的学习资料
journal/YYYY-MM.md              学习日志
mockup/           UI 面板原型（浏览器直接打开 index.html）
```

## 节点状态标记（plan.md 里的 checkbox）

- `[x]` 已确认（quiz 通过）
- `[~]` 进行中
- `[!]` 有错题待修复
- `[ ]` 未学

## 设计文档

- [DESIGN.md](DESIGN.md) —— 整体架构
- [UI-DESIGN.md](UI-DESIGN.md) —— 前端面板设计

## 插件

面板与 Host 代码在 `plugin/`（npm 包 `dsh-learn-space`），安装与配置见 [plugin/README.md](plugin/README.md)。
