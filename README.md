# CS Guess

一个基于浏览器的 Counter-Strike 职业选手竞猜游戏。每轮需要在 3 分钟和
6 次机会内猜出神秘选手，系统会对比战队、国籍、年龄、位置以及 Major
参赛次数。界面提供每日单人、实时 1v1、4 人乱斗和 2–8 人好友房间。
在线匹配支持 BO1、BO3、BO5，默认隐藏对手猜测，仅公开每轮命中的属性；
也可切换为明牌模式查看对手猜过的具体选手。应用打开后先进入独立模式大厅，
经过赛制设置与专用匹配页后再进入对局；猜中会显示局胜或系列赛胜利动画。

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

需要 Node.js 24 或更高版本，并启用 Corepack。

```bash
corepack enable
pnpm install
pnpm dev:server # 终端 1：实时服务，默认 http://127.0.0.1:8080
pnpm dev        # 终端 2：前端，默认 http://127.0.0.1:5173
```

可用命令：

```bash
pnpm dev        # 启动开发服务器
pnpm data:sync  # 全量刷新选手规范库和前后端共用目录
pnpm lint       # 运行 Oxlint
pnpm typecheck  # 运行 TypeScript 检查
pnpm build      # 类型检查并生成生产构建
pnpm test:server # 运行 Rust 后端测试
pnpm lint:server # 运行 Clippy 严格检查
pnpm preview    # 预览生产构建
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

## 数据说明

选手目录由 Liquipedia MediaWiki API 与 PandaScore 全量同步生成。SQLite
规范库保留来源证据、历史队伍任期、多角色和逐届 Major 出场；只有姓名、
完整出生日期、国籍、当前队伍和游戏角色都齐全的记录才进入
`src/data/players.generated.json`。前端和 Rust 服务端共同读取这一个目录，
避免两端选手 ID 或属性不一致。完整刷新命令见
[scraper/README.md](scraper/README.md)。

今日挑战使用浏览器内的本地回合；实时 1v1、4 人乱斗与好友房间通过 `/v1` REST API
创建会话，再使用 WebSocket 接收服务端权威的倒计时、猜测结果、比分和系列
赛胜负。匹配设置与等待页还会通过独立的队列 WebSocket 接收各赛制实时等待
人数。开发环境中的 Vite 会把 `/v1`（包括 WebSocket）代理到
`http://127.0.0.1:8080`。生产环境可通过 `VITE_API_BASE_URL` 指定完整后端
地址。

实时会话凭证保存在 `sessionStorage`，刷新页面可以重连，关闭标签页后自动
失效。WebSocket 使用带抖动的指数退避重连，并按服务端 `seq` 去重；重连
快照会恢复自己已经提交的猜测与经过脱敏的对手进度。服务端不可用时界面会
明确提示并提供重试入口，不会降级成本地模拟对局。

匿名身份会在浏览器中保留胜负、连胜和最近 50 局的答案与猜测顺序，可从大厅
进入战绩页查看并回放。实时回合断线后有独立的 30 秒恢复窗口，超时会自动判定
本轮弃权，避免房间永久卡住。

后端协议、配置和扩容边界见 [server/README.md](server/README.md)。
