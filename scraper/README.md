# CS Guess Scraper

采集并合并 Liquipedia、PandaScore、BALLDONTLIE CS2 选手数据，保存
完整队史与逐届 Major 出场记录，最后生成前端和 Rust 服务端共用的游戏目录。

## 配置

在项目根目录创建 `.env`：

```dotenv
PANDASCORE_API_TOKEN=
BALLDONTLIE_API_TOKEN=
LIQUIPEDIA_USER_AGENT=CSGuess/0.1 (project-url; contact-email)
ALLOW_HLTV_FALLBACK=false
```

`.env`、SQLite 和本地全量快照均已被 Git 忽略。HLTV 仅支持已知
`player ID + slug` 的定向兜底，不负责发现选手，也不会绕过访问挑战。

## 使用

```bash
uv sync

# 小规模多源烟测
uv run cs-guess-scraper sync --limit 10 --skip-majors

# 仅用 BALLDONTLIE 补充已有 PandaScore 身份的生日/当前队伍
uv run cs-guess-scraper sync \
  --source balldontlie \
  --skip-majors

# 全量同步，并更新应用共用目录
uv run cs-guess-scraper sync \
  --db data/cs_guess.sqlite \
  --output data/players.game.json \
  --report data/sync-report.json \
  --catalog-output ../src/data/players.generated.json

# 审计或重新导出
uv run cs-guess-scraper audit --db data/cs_guess.sqlite
uv run cs-guess-scraper export \
  --db data/cs_guess.sqlite \
  --output data/players.game.json \
  --catalog-output ../src/data/players.generated.json

# 仅在 .env 显式启用后，为一个已知规范选手定向补字段
uv run cs-guess-scraper hltv \
  --db data/cs_guess.sqlite \
  --id 11893 --slug zywoo \
  --match-source liquipedia --match-external-id ZywOo

# 用同一个限速客户端处理已审核的 HLTV 清单
uv run cs-guess-scraper hltv-batch \
  --db data/cs_guess.sqlite \
  --targets hltv-targets.reviewed.json

# 应用已由第三来源人工复核的显式身份映射
uv run cs-guess-scraper merge-reviewed \
  --db data/cs_guess.sqlite \
  --mappings identity-merges.reviewed.json \
  --quarantines source-quarantines.reviewed.json
```

Liquipedia 默认严格保持每次请求至少 2 秒间隔；PandaScore 支持
429、5xx 和暂时断连的有限重试；BALLDONTLIE 按免费档限制保持每次
请求至少 12.1 秒。BALLDONTLIE 返回的 `steam_id` 当前实际对应
PandaScore player ID，导入器会把它当作跨源关联键，不会误存为 Steam64。
同步报告会记录各来源 seen/stored/error、Major 关联率、合并结果和
数据库覆盖率。

HLTV 清单中的每个目标都会在关联前核对身份，并保留月精度的历史队伍。
显式身份映射使用稳定的 provider ID，重复执行安全，并记录为
`identity:reviewed_cross_source` 人工决策。经第三来源确认混入错误身份的
单条 provider 记录会先隔离其字段与队伍证据，同时保留 source record 和
`identity:quarantined_source` 审计记录。
来源优先级、清洗规则和后续候选见
[SOURCE_EVALUATION.md](SOURCE_EVALUATION.md)。数据模型见
[DATA_MODEL.md](DATA_MODEL.md)，SQLite 结构见 [schema.sql](schema.sql)。
