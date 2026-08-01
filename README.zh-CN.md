# CS Guess

[English](README.md) | 简体中文

一个面向 Counter-Strike 电竞爱好者的开源职业选手竞猜游戏。

[在线体验 CS Guess](https://cs-guess.zxilly.com)

玩法灵感来自 [BLAST Counter-Strikle](https://blast.tv/counter-strikle)。

猜出本轮的神秘职业选手，并根据每次猜测结果逐步缩小答案范围。线索会比较选手的
战队、国籍、年龄、位置、Major 参赛次数和 Major 冠军次数。

## 功能

- 所有人共享的每日新挑战
- 提供多种难度的单人练习
- 实时匹配与好友房间
- 英文和简体中文界面
- 经过整理的 Counter-Strike 职业选手目录

## 本地开发

请先安装带有 Corepack 的 Node.js 和 Rust 工具链。

```bash
corepack enable
pnpm install
```

分别在两个终端中启动服务端和前端：

```bash
pnpm dev:server
```

```bash
pnpm dev
```

## 检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:server
pnpm build
```

## 文档

- [选手数据管线](scraper/README.md)
- [服务端协议与配置](server/README.md)

欢迎提交问题和贡献代码。
