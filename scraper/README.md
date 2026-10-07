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

# 从已验证的 BALLDONTLIE 分页 cursor 后继续，避免重拉已完成页面
uv run cs-guess-scraper sync \
  --source balldontlie \
  --balldontlie-start-cursor 5326 \
  --skip-majors

# 全量同步，并更新应用共用目录
uv run cs-guess-scraper sync \
  --db data/cs_guess.sqlite \
  --output data/players.game.json \
  --report data/sync-report.json \
  --catalog-output ../src/data/players.generated.json \
  --catalog-metadata-output ../src/data/players.generated.meta.json \
  --reviewed-identity-merges identity-merges.reviewed.json \
  --reviewed-source-quarantines source-quarantines.reviewed.json \
  --reviewed-identity-separations identity-separations.reviewed.json \
  --reviewed-major-winners reviewed-major-winners.json \
  --reviewed-major-appearances reviewed-major-appearances.json \
  --reviewed-player-overrides reviewed-player-overrides.json \
  --reviewed-role-overrides reviewed-role-overrides.json

# 审计或重新导出
uv run cs-guess-scraper audit --db data/cs_guess.sqlite
uv run cs-guess-scraper quality \
  --db data/cs_guess.sqlite \
  --output data/data-quality-report.json \
  --fail-on-critical
uv run cs-guess-scraper export \
  --db data/cs_guess.sqlite \
  --output data/players.game.json \
  --catalog-output ../src/data/players.generated.json \
  --catalog-metadata-output ../src/data/players.generated.meta.json \
  --reviewed-major-winners reviewed-major-winners.json \
  --reviewed-major-appearances reviewed-major-appearances.json \
  --reviewed-player-overrides reviewed-player-overrides.json \
  --reviewed-role-overrides reviewed-role-overrides.json

# 回放已提交的目录时，使用其 players.generated.meta.json 中 updatedAt 的 UTC 日期。
# 在 export 命令中传入 --catalog-date YYYY-MM-DD，并省略 --catalog-metadata-output，
# 保留原始生成时间，避免跨生日回放时出现年龄差异。

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
  --quarantines source-quarantines.reviewed.json \
  --separations identity-separations.reviewed.json
```

Liquipedia 默认严格保持每次请求至少 2 秒间隔；PandaScore 支持
429、5xx 和暂时断连的有限重试；BALLDONTLIE 按免费档限制保持每次
请求至少 12.1 秒。BALLDONTLIE 返回的 `steam_id` 当前实际对应
PandaScore player ID，导入器会把它当作跨源关联键，不会误存为 Steam64。
同步报告会记录各来源 seen/stored/error、人工身份决策、Major 关联率、
合并结果和数据库覆盖率。`quality --fail-on-critical` 会阻止存在未解决身份
冲突、不完整 Major 阵容或错误冠军人数的数据通过；头像与 Logo 缺口作为
非阻断覆盖率警告单独列出。

HLTV 清单中的每个目标都会在关联前核对身份，并保留月精度的历史队伍。
显式身份映射使用稳定的 provider ID，重复执行安全，并记录为
`identity:reviewed_cross_source` 人工决策。经第三来源确认混入错误身份的
单条 provider 记录会先隔离其字段与队伍证据，同时保留 source record 和
`identity:quarantined_source` 审计记录。
`identity-separations.reviewed.json` 保存已经确认的同名不同人组合；同步时会在
自动身份合并之前重放，provider ID 在规范 player ID 变化后仍可稳定解析。
当 Major 参赛表缺少最终名次时，`reviewed-major-winners.json` 使用赛事与
战队的稳定 provider ID 补充冠军结果，并为夺冠阵容中的每位选手保存
`manual` 名次证据；`reviewed-major-appearances.json` 用同样的方式补充或修正
缺失阵容、队伍、替补身份和名次。两类修正都可重复执行并进入同步报告。
`reviewed-role-overrides.json` 则只收录有外部证据的历史角色修正，按 provider
ID 重放并写入选手审计轨迹；没有可靠来源的缺失角色在游戏导出层统一归为步枪手，
不会篡改原始角色记录。
`reviewed-player-overrides.json` 保存有明确外部证据的生日等字段修正，同样按
provider ID 重放，并把核验链接写入 source record，避免不可追溯的手工改库。
来源优先级、清洗规则和后续候选见
[SOURCE_EVALUATION.md](SOURCE_EVALUATION.md)。数据模型见
[DATA_MODEL.md](DATA_MODEL.md)，SQLite 结构见 [schema.sql](schema.sql)。

## 自动刷新

`Refresh player data` GitHub Actions 工作流每周一运行，也可手动选择单个来源。
工作流先从 `ghcr.io/<owner>/cs-guess-data:latest` 恢复规范 SQLite 数据库。每次同步
都会把数据库、生成目录和审计报告保存为不可变的
`run-<run-id>-<attempt>` OCI 候选快照；只有零 critical 的候选才会更新 `latest`。
Docker 层由内容摘要寻址，未变化的层可由 registry 去重。旧的按 package version
计数删除已停用：OCI index、平台 manifest 和 attestation 在 GHCR 中是不同的 version，
不能把保留 8 个 version 当作保留 8 个完整快照。当前只生成保留计划，不执行删除。

当游戏目录变化或候选仍有 critical 时，工作流使用独立的
`automation/player-data-refresh-<run-id>-<attempt>` 分支创建 Draft PR，并提交包含
快照 digest 和质量计数的 `player-data-candidate.json`。冲突不会丢失，也不会污染
canonical `latest`。
PR 正文会按稳定选手 ID 汇总新增、删除、修改人数，并显示字段前后值与比较基线。
正文每类最多展示 25 行，完整字段变更保存在 Actions artifact 的 `catalog-review.md`
中（保留 14 天）；后续提交的最新摘要在候选回放检查的 Actions Summary 中查看。
本地可运行 `uv run --project scraper --frozen python -m cs_guess_scraper.catalog_review
--base origin/main --output scraper/data/catalog-review.md
--preview scraper/data/catalog-review-preview.md`，无需重新抓取数据。
人工在 PR 中修改 reviewed JSON 后，`Review and promote player data candidate`
工作流直接恢复候选 SQLite、重放决策、
重新导出并执行 `quality --fail-on-critical`，不会重新请求 Liquipedia、PandaScore、
BALLDONTLIE 或 bo3。质量检查通过后再将 PR 标记为 ready 并合并；merge 到 `main`
后，同一个轻量 workflow 会再次重放已合并的决策，并把通过门禁的 corrected
snapshot 提升为 canonical `latest`，同样不会重新抓取 provider。需要在仓库中配置
以下值：

- Actions secret `PANDASCORE_API_TOKEN`；
- 可选的 Actions secret `BALLDONTLIE_API_TOKEN`；
- Actions variable `LIQUIPEDIA_USER_AGENT`，必须包含可联系的项目身份；
- 仓库 Actions 设置中的 “Allow GitHub Actions to create and approve pull requests”。

首次发布后可在 package settings 中把 `cs-guess-data` 设为 public；该包只包含公开
来源数据与派生报告。当前未启用自动删除，存储会继续增长；请查看只读保留审计报告，
不要手工按 version 数量删除未打标签的 child manifests。

同步报告、质量报告和完整审计会作为短期 Actions artifact 保留，完整可恢复状态则
保存在 GHCR。Copilot 不参与自动身份合并；AI 只能在人工触发的独立审查流程中
根据结构化冲突报告提出候选修正，修正仍需引用证据并经 PR 审核。

### 快照保留审计（仅 dry-run）

`Audit snapshot retention` 在刷新或候选回放成功结束后运行，也可手动运行。
独立 job 只有 `contents: read`、`packages: read` 和 `pull-requests: read` 权限，
脚本没有 DELETE 请求、删除模式或启用删除的参数。审计失败不会阻断数据发布，
会产生失败的审计 run 和 `snapshot-retention-plan.json` 报告，候选删除列表清空。

计划默认保留最新 8 个不同 digest 的逻辑快照（`run-<id>-<attempt>` 或
`reviewed-<40 位 commit SHA>`），并额外保护：

- `latest`、默认分支的 candidate，以及所有开放 PR（包括 Draft 和 fork）的 candidate
- 上述 root 的递归 OCI index children，包括平台 manifest、SBOM 和 provenance
- OCI subject 双向关联的 attestation / signature，以及多个 root 共享的 children
- 未识别的 tag，以及不能明确归属到已知快照的无标签 manifest

快照按 GHCR `created_at` 排序，同一 digest 的多个 tag 只计一个快照。
保护项可以令实际保留数量超过 8。只有明确属于过期快照、且不被任何保护 root
引用的 manifest version 才会出现在信息性候选列表中；不是清空所有无标签版本。
完整读取 package 和开放 PR 分页，按不可变 head SHA 读取候选，校验 registry 内容
摘要及 tag 对应关系，再次读取 package inventory、PR heads 和默认分支 SHA。
权限不足、404、未知 schema、缺失 children、分页异常或观察到并发发布变化时，
一律阻断计划并保留全部。历史上已经损坏的图也会阻断，需要独立人工处理。

只读审计不能锁住 registry：报告生成后仍可能出现新发布或 PR，稳定的两次读取
不保证后续删除安全。将来如要启用删除，需要另外审查和批准执行器，所有发布和
清理共用写入锁、删除前重新验证保护图，并先移除过期 root、重新计算剩余引用后
才处理专属于它的 children；当前报告不能直接作为删除执行清单。

本地离线回归测试：`python3 -m unittest discover -s scripts/tests -v`。
读取真实 inventory 需要具备 package 和仓库读取权限的 `GH_TOKEN`、
`GITHUB_ACTOR` 及 `GITHUB_REPOSITORY`，运行
`python3 scripts/snapshot_retention.py --output snapshot-retention-plan.json`。
不要把 token 写进命令行、报告或仓库文件。

## 已发布选手 ID 的兼容性

应用目录中的 `id` 会被历史对局引用，昵称变化不能重新分配这个 ID。
新导出的行携带 `catalogIdentity`：规范数据库 ID 与按来源区分的 provider IDs。
后续导出优先按这些身份匹配旧行；即使规范数据库重建，只要 provider ID 保持
一致，仍沿用已发布的公共 ID。前端和服务端可忽略这个仅供目录回放的附加字段。

旧目录还没有身份字段时，只允许全名及国家相同、且昵称或历史别名唯一匹配的
一次性迁移；例如 `chshekin` 改名为 `laser` 后仍保留 `id=chshekin`。
多个旧身份匹配同一新行、或多个新行争用同一旧 ID 时导出会报错，必须人工核对，
不会自动合并。旧 ID 会先预留，避免新选手因排序靠前抢走旧选手的 ID。

请以已发布目录作为 `--catalog-output` 的旧输入，再重新生成候选目录。已经丢失
旧 ID 的候选不能作为迁移基线；后续候选合并仍须通过完整回放质量门禁。
目录中的身份元数据不是完整的历史 tombstone 注册表；删除选手后重新引入仍应
保留对应的历史目录或做显式身份迁移。

### 2026-09-28 身份迁移复核

旧 canonical OCI index 的 amd64 manifest 已不可恢复，因此本次不声称恢复了旧数据库。
以 main 已发布的 3,457 行目录为公共 ID 基线，在 9 月 28 日不可变候选数据库中
逐一关联来源身份：3,456 行唯一匹配；StRoGo 的国家由 RU 变为 TJ，使用同一
Liquipedia `StRoGo` 的历史修订 `3446846`（9 月 21 日采集）核对昵称、
Ivan Shurpatov、生日 2002-07-06 及原 RU，确认其身份不变。
所有 3,457 个原 ID 均保留且一对一；`chshekin` 改名为 `laser` 仍沿用原 ID。
新目录写入 `catalogIdentity` 后再次回放结果完全一致，后续不再依赖这次旧格式迁移。
