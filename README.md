# CS Guess

English | [简体中文](README.zh-CN.md)

An open-source guessing game for Counter-Strike esports fans.

[Play CS Guess](https://cs-guess.zxilly.com)

Guess the mystery professional player and use the result of each attempt to
narrow down the answer. Clues compare the players' teams, nationalities, ages,
roles, Major appearances, and Major wins.

## Features

- A new Daily Challenge for everyone
- Solo practice with multiple difficulty levels
- Real-time matchmaking and private rooms
- English and Simplified Chinese interfaces
- A curated catalog of professional Counter-Strike players

## Local development

You will need Node.js with Corepack and the Rust toolchain installed.

```bash
corepack enable
pnpm install
```

Start the server and frontend in separate terminals:

```bash
pnpm dev:server
```

```bash
pnpm dev
```

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:server
pnpm build
```

## Documentation

- [Player data pipeline](scraper/README.md)
- [Server protocol and configuration](server/README.md)

Bug reports and contributions are welcome.
