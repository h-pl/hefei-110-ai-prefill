# 合肥 110 · AI 接警预填单

基于 Moss 设计基线的接警辅助工作台演示，使用 React、TypeScript、Vite 和 shadcn/ui。

## 本地运行

```sh
cd form-demo
npm ci
npm run dev
```

## 验证

```sh
cd form-demo
npm run build
npm test
```

## Vercel 部署

导入本仓库，将 Root Directory 设置为 `form-demo`，框架选择 Vite。构建配置位于 `form-demo/vercel.json`，使用 `npm ci` 安装依赖、`npm run build` 构建，输出目录为 `dist`。无需环境变量。

## 仓库内容

- `form-demo/`：网页演示与规则测试。
- `form-demo/DESIGN.md`：网页设计与交互约定。

本仓库仅发布网页工程；本地 PRD、Figma 迁移和飞书同步资料未纳入。

演示采用虚构对话与本地规则，不接入真实音频、AI、地点库或调度接口；浏览器本地暂存演示进度。
