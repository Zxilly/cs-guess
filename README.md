# CS Guess

## 技术栈

- React 19 + TypeScript 7
- React Router 8
- Vite 8
- Tailwind CSS 4
- shadcn/ui（Radix UI）
- Phosphor Icons
- Geist + IBM Plex Mono
- Oxlint
- pnpm 11
- Rust 1.88+、Axum 0.8、Tokio 1.53

## 本地开发

```bash
corepack enable
pnpm install
pnpm dev:server
pnpm dev
```

```bash
pnpm data:sync
pnpm data:quality
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:server
pnpm lint:server
pnpm preview
```

## 项目结构

```text
src/
├── components/       # 游戏组件与 shadcn/ui 源码
├── data/             # 自动生成、前后端共用的选手目录
├── lib/utils.ts      # shadcn 工具函数
├── pages/            # 模式大厅与游戏页面
├── App.tsx           # React Router 路由配置
└── index.css         # Tailwind 入口与设计令牌
scraper/              # Python 采集、规范化、审计与导出模块
server/               # Axum/Tokio 实时对战服务
```

## 页面路由

```text
/             模式大厅
/play/daily   今日挑战
/quick        实时 1v1 / 4 人乱斗规则设置
/matching     独立匹配等待页（按人数和赛制显示实时排队人数）
/play/quick   实时 1v1 / 4 人乱斗
/room         输入房间号或创建房间
/play/room    好友房间对局
/stats        匿名战绩与最近 50 局回放
```

## 文档

- [数据管线](scraper/README.md)
- [后端协议与配置](server/README.md)

## 容器发布

Docker Hub 的正式镜像使用不可变日期标签 `YYYYMMDD-N`，其中 `N` 是当天从
`1` 开始递增的发布序号，例如 `20260730-2`。生产环境应部署日期标签；
`latest` 仅用于指向最近一次构建，不作为部署版本依据。
