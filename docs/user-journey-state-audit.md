# 用户可达状态审查清单

> 本文件是前端体验审查的唯一进度源。每个状态必须经历：
> `待检查 → sol low 用户视角检查 →（发现问题时）sol high 修复 → sol low 复验 → 完成`。
>
> 状态定义以 `src/machines/user-journey-machine.ts` 为准；本文件同时补充路由状态机之外、用户实际可见的搜索、弹窗和响应式状态。

## 状态标记

- [ ] 待检查
- [~] 检查或修复中
- [x] 已检查且无需修复，或已修复并复验通过
- [!] 存在已确认问题，等待修复
- [-] 当前环境无法抵达，必须记录阻塞证据

每次检查必须填写：

1. 实际进入方式和最终 URL。
2. 桌面端截图；布局敏感页面还要有移动端截图。
3. 任务是否可继续、文案是否准确、加载/空/错/成功状态是否清晰。
4. 键盘焦点、可点击目标、对比度、动态效果和减少动画偏好等可见风险。
5. 问题级别（P0/P1/P2/P3）、修复提交或工作区变更、复验截图。

## A. 启动、身份与大厅

- [x] `checkingIdentity` — 启动时检查匿名身份；无闪屏、无错误跳转。
- [x] `onboarding.idle` — 首次身份引导静止态；清楚说明必须先设置身份。
- [x] `onboarding.rolling` — 首次身份抽取滚动态；候选头像预载，动画不卡顿。
- [x] `onboarding.result` — 首次身份结果待确认；确认后回到原本请求的页面。
- [x] `lobby` — 模式大厅；身份、今日、单人、匹配、好友房、战绩入口完整。
- [x] `identity.idle` — 身份管理页；池子、锁定条件、抽取次数和当前身份正确。
- [x] `identity.rolling` — 身份重抽滚动态；不会延迟加载头像或误扣次数。
- [x] `identity.result` — 新身份待选择；可保留当前、使用新身份、继续重抽。

## B. 战绩

- [x] `stats.list.empty` — 尚无战绩；空状态简洁并提供清晰下一步。
- [x] `stats.list.populated` — 有战绩列表；状态、时间、比分和模式信息可扫读。
- [x] `stats.replay` — 对局回放弹窗；答案与逐次猜测完整且可退出。

## C. 今日挑战

- [x] `daily.loading` — 今日挑战载入；稳定占位且不会显示伪造轮次。
- [x] `daily.error` — 载入失败；错误可理解、可重试、不会丢失已有进度。
- [x] `daily.playing.empty` — 进入即计时、0/8 次猜测、搜索与提交可用。
- [x] `daily.playing.results` — 已有猜测；比较色、方向、国家距离和三等分正确。
- [x] `daily.won.dialog` — 猜中后的胜利弹窗和庆祝反馈。
- [x] `daily.won.result` — 关闭弹窗后，结果面板直接替换猜测组件。
- [x] `daily.lost.dialog` — 失败弹窗；答案、次数和下一步明确。
- [x] `daily.lost.result` — 关闭弹窗后保留完整结果，不回到无状态页面。

## D. 单人练习

- [x] `solo.selectingDifficulty` — 简单、完整、困难三档题库选择。
- [x] `solo.playing.empty` — 新局 0/8；计时、搜索、难度标签正确。
- [x] `solo.playing.results` — 已提交猜测；结果表和比较含义正确。
- [x] `solo.won.dialog` — 胜利结果弹窗；可继续下一局或更换难度。
- [x] `solo.won.result` — 关闭弹窗后的成功结果态。
- [x] `solo.lost.dialog` — 失败结果弹窗。
- [x] `solo.lost.result` — 关闭弹窗后的失败结果态。

## E. 快速匹配

- [x] `quick.setup` — 人数、可见性、难度、BO1/BO3/BO5 对齐且选择摘要一致。
- [x] `quick.submitting` — 提交匹配中；按钮防重复且有明确反馈。
- [x] `quick.setupError` — 容量、参数或网络失败；保留设置并允许重试。
- [x] `quick.matching` — 独立等待页；显示所选队列等待人数和游戏中人数。
- [x] `quick.canceling` — 取消匹配中；不会重复取消或短暂返回错误页面。
- [x] `quick.cancelError` — 取消失败；仍保留队列状态并允许再次取消。
- [x] `quick.entering` — 匹配成功进场动画；减少动画偏好有降级。
- [x] `quick.waiting.1v1` — 双人对局等待开局；身份、连接状态和比分无冲突。
- [x] `quick.playing.1v1` — 双人左右对称展示；对手猜对项可见、猜测内容按模式隐藏。
- [x] `quick.waiting.4p` — 四人乱斗等待开局；席位与连接状态清楚。
- [x] `quick.playing.4p` — 四人进度、排名和当前玩家强调清楚。
- [x] `quick.roundResult` — BO3/BO5 单回合结算；下一回合倒计时与比分准确。
- [x] `quick.seriesResult` — 系列赛最终胜负弹窗与结果面板。

## F. 好友房

- [x] `room.setup` — 加入房间与创建房间左右权重、垂直起点一致。
- [x] `room.setup.difficulty` — 创建房间含简单、完整、困难三档难度。
- [x] `room.submitting` — 创建/加入提交中；防重复并保持输入。
- [x] `room.error` — 房间号、容量或网络错误；错误靠近操作且可恢复。
- [x] `room.waiting.1v1` — 双人好友房等待；房间号、复制、身份和席位清楚。
- [x] `room.playing.1v1` — 双人好友房对局；布局和快速匹配一致。
- [x] `room.waiting.4p` — 四人好友房等待；房主和成员状态清楚。
- [x] `room.playing.4p` — 四人好友房对局；进度和排名可扫读。
- [x] `room.roundResult` — 好友房单回合结算与房主控制。
- [x] `room.seriesResult` — 好友房系列赛最终结果。

## G. 实时连接（与快速匹配/好友房状态正交）

- [x] `connection.idle` — 非实时页面不创建无用连接。
- [x] `connection.connecting` — 正在连接；页面不误报离线或开局。
- [x] `connection.connected` — 已连接；快照与人数广播稳定。
- [x] `connection.reconnecting` — 断线自动重连；保留当前对局和输入。
- [x] `connection.offline` — 会话失效；禁止继续提交并给出恢复出口。
- [x] `connection.closed` — 主动离开；不会自动重新加入旧会话。

## H. 跨页面交互子状态

- [x] `search.idle` — 搜索框未输入时不展开结果。
- [x] `search.querying` — 输入昵称、姓名、战队、中文/英文国家名或缩写均可匹配。
- [x] `search.keyboardHighlight` — 上下键选择时有灰色补全提示。
- [x] `search.enterSubmit` — 选中项后按 Enter 直接提交，而不是只填入。
- [x] `search.noResults` — 无结果状态简洁且不遮挡页面。
- [x] `search.retiredOrUnattached` — 退役/无队伍选手可搜索，显示“无队伍”。
- [x] `tooltip.open` — 说明文字仅在需要时出现，不遮挡标题或主要操作。
- [x] `dialog.focus` — 所有结果/回放/身份弹窗初始焦点、Tab 环和 Escape 行为正确。
- [x] `responsive.desktop` — 1440×900：主体水平、垂直视觉居中，列起点和间距统一。
- [x] `responsive.mobile` — 390×844：无水平溢出，主操作可见，表格有明确横滑提示。
- [x] `motion.reduced` — 系统减少动画时跳过滚动、庆祝和进场长动画。

## 发现的问题

| ID | 状态 | 级别 | 问题 | 修复 agent | 复验 |
| --- | --- | --- | --- | --- | --- |
| J-001 | `checkingIdentity` | P2 | 首次身份重定向可能出现空白帧；身份页懒加载错误地显示“正在准备对局”，骨架与目标页不匹配。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-002 | `onboarding.rolling` | P2 | 候选头像未预载，滚动首帧均为占位；低高度和减少动画保护不完整。 | `fix_state_onboarding_rolling`（已修） | 通过，已关闭 |
| J-003 | `onboarding.idle` | P2 | 强制设置身份的原因、用途与返回原流程说明未前置；CTA 折叠线结论经 DPR 校准确认为误报。 | `fix_state_onboarding_idle`（已修） | 通过，已关闭 |
| J-004 | `onboarding.result` | P2 | 低高度时结果 CTA 缺少可滚动/聚焦保障；返回目标文案不准确。 | `fix_state_onboarding_rolling`（已修） | 通过，已关闭 |
| J-005 | `lobby` | P2 | Round 信息重复并抢占层级；模式元信息过小且中英混排。 | `fix_state_lobby`（已修） | 通过，已关闭 |
| J-006 | `identity.idle` | P2 | 当前/已解锁池状态弱，池资格与消耗规则必须打开 tooltip 才可知。 | `fix_identity_management_states`（已修） | 通过，已关闭 |
| J-007 | `identity.rolling` | P2 | 普通重抽未预载候选头像，滚动首帧大量显示首字母。 | `fix_identity_management_states`（已修） | 通过，已关闭 |
| J-008 | `identity.rolling/result` | P2 | 扣费无成功返回且滚动中刷新会丢结果；跨标签竞态可能免费抽取，采用失败会静默关闭。 | `fix_identity_management_states`（已修） | 通过，已关闭 |
| J-009 | `identity.result` | P2 | 赢家文本与三个按钮同处 live region，焦点切换可能导致读屏遗漏或重复播报。 | `fix_identity_management_states`（已修） | 通过，已关闭 |
| J-010 | `stats.list.empty` | P2 | 0 局时显示胜率 0%/连胜 0，误把无样本表达成真实表现。 | `fix_stats_states`（已修） | 通过，已关闭 |
| J-011 | `stats.list.populated` | P1 | 回合记录被文案表达成系列/对局统计；0 猜测与无有效记录混淆。 | `fix_stats_states`（已修） | 通过，已关闭 |
| J-012 | `stats.replay` | P1 | 历史答案 ID 缺失会回退为目录首位选手，旧回放可能展示伪造答案。 | `fix_stats_states`（已修） | 通过，已关闭 |
| J-013 | `stats.replay` | P1 | 0 猜测仍渲染 8 行“等待猜测”；结果详情缺少上下文且初始焦点落在空表格。 | `fix_stats_states`（已修） | 通过，已关闭 |
| J-014 | `daily.loading` | P2 | 路由懒加载、数据加载和真实游戏使用三种不同结构，进入时连续布局跳变。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-015 | `identity.result` | P2 | 另一标签页替换或处理 pending 结果后，当前弹窗仍保留旧结果，随后所有操作失败且无法关闭。 | `fix_identity_management_states`（已修） | 通过，已关闭 |
| J-016 | `stats.replay` | P2 | 答案失效但猜测仍可解析时，桌面端同时隐藏 compact 列表且无法渲染对比表，猜测记录消失。 | `fix_stats_states`（已修） | 通过，已关闭 |
| J-017 | `daily.lost.dialog/result` | P2 | catalog 与持久化快照允许 `undefined` 队名，答案资料展示为程序缺失值。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-018 | `daily.lost.dialog` | P2 | 无 Dialog trigger，关闭结果弹窗后没有显式焦点落点，键盘焦点可能回到 body。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-019 | `daily.lost.result` | P2 | 0 次猜测超时会保留每日结果，却跳过匿名档案的回合记录，战绩与结果不一致。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-020 | `daily.playing.results` | P2 | 年龄方向、同洲国名及 9px/70% 距离提示的文字对比度低于 4.5:1，距离信息尤其难读。 | `fix_stats_states`（已修） | 通过，已关闭 |
| J-021 | `solo.selectingDifficulty` | P2 | 难度卡声明为 radiogroup/radio，却未实现方向键与 roving tabIndex，键盘行为不符合标准单选组预期。 | `fix_state_lobby`（已修） | 通过，已关闭 |
| J-022 | `solo.playing.empty/results` | P2 | 刷新会把当前猜测与剩余时间重置为 0/8、3:00 并更换答案，却仍显示 ROUND #1，当前练习静默丢失。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-023 | `solo.playing.empty` | P3 | 空 query 且无候选列表时 combobox 仍宣告 `aria-expanded=true` 并引用不存在的 listbox。 | `fix_stats_states`（已修） | 通过，已关闭 |
| J-024 | `solo.won.result/lost.result` | P2 | “查看结果”关闭无 trigger 的结算 Dialog 后未显式把焦点移到结果标题，焦点可能回到 body。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-025 | `solo.lost.dialog/result` | P2 | 只持久化 lost 状态而未保留超时/次数用尽原因，两种失败只能靠 0/8 或 8/8 猜测。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-026 | `solo.playing/won/lost` | P2 | v2 改用新存储 key 却未迁移已部署 v1，升级用户会静默丢失当前回合或结算并从第 1 局重开。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-027 | `quick.submitting` | P1 | 提交无同步单飞锁，双击可能创建两个 ticket；真实 fetch abort 后拿不到已创建 ticket，仍可能留下幽灵队列。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-028 | `quick.submitting` | P2 | 提交中人数、可见性和 BO 仍可修改，摘要会与已发送请求快照不一致。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-029 | `quick.submitting` | P2 | 只有按钮文字和 spinner，提交区域没有 aria-busy，状态变化没有 status/live 语义。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-030 | `quick.setupError` | P2 | 创建匹配请求没有超时，网络永久 pending 时页面会一直锁在提交态，无法重试。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-031 | `quick.setupError` | P2 | 失败时 disabled CTA 丢失焦点，恢复后焦点落到 body，没有回到可继续操作的位置。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-032 | `quick.setupError` | P3 | 修改任一匹配设置后仍保留旧配置产生的错误，提示已过期。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-033 | `quick.matching` | P1 | 房间实时连接失败/错误完全不渲染，公共队列广播仍可显示“已连接”，用户会无限停在寻找对手。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-034 | `quick.matching` | P2 | 无等待超时或 session 失效恢复；刷新后 elapsed 从 00:00 重置，不能代表真实排队时长。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-035 | `quick.matching` | P2 | 等待页不展示当前匿名身份，用户无法确认排队所用身份。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-036 | `quick.matching` | P2 | 只展示 BO1/3/5 明细，缺少当前题库/人数/可见性维度的等待与游戏中总数。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-037 | `quick.matching` | P2 | aria-live 包裹整个六格摘要，计时每秒更新可能反复播报整组状态。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-038 | `quick.canceling` | P1 | 取消期间房间 socket 仍活跃，匹配成功进场与取消成功回跳会竞态，最终页面取决于响应顺序。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-039 | `quick.canceling` | P2 | 取消无同步单飞锁，React disabled 生效前的双击/键盘重复可能发出多个 DELETE。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-040 | `quick.canceling` | P2 | 取消请求无 AbortController/generation/mounted guard，卸载后的晚响应仍可能清 session 并强制导航。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-041 | `quick.canceling` | P2 | 取消区域缺 aria-busy/status/live，disabled CTA 还会丢失键盘焦点。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-042 | `quick.cancelError` | P2 | DELETE 无超时，永久 pending 会把用户锁在“正在取消”且无法重试。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-043 | `quick.cancelError` | P2 | 取消失败后焦点落到 body，没有回到恢复的取消 CTA 或错误提示。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-044 | `quick.cancelError` | P2 | 取消 API 丢弃服务端错误 code/message，ticket 不存在与服务不可用均显示同一泛化文案。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-045 | `quick.submitting` | P1 | 服务端幂等结果缓存无 TTL/容量上限，失败路径 lock 也可能不清理，长期高并发会持续占用内存。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-046 | `quick.submitting` | P1 | client_request_id 缓存未绑定请求指纹，同 key 不同身份/参数可能返回首个请求的 session token。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-047 | `quick.entering` | P1 | aria-modal 进场层没有初始焦点或焦点陷阱，底层取消 CTA 仍可被 Enter/Tab 触发，形成进场/取消竞态。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-048 | `quick.entering` | P2 | reduced-motion 仅禁用 CSS 动画，仍固定等待 450ms，满格进度与实际延迟不一致。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-049 | `quick.entering` | P2 | 玩家槽只显示 Player 01/02，没有标记“你”与对手序号；缺名时多个相同占位无法辨认。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-050 | `quick.entering` | P3 | 4 人移动 2×2 卡片第二排缺少横向分隔，席位边界主要靠位置猜测。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-051 | `quick.waiting.1v1` | P1 | ModeSidebar 离开只清本地凭证并导航，未取消/离开服务器 quick room，可能让对手永久等待并遗留房间。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-052 | `quick.waiting.1v1` | P2 | 重连中把自己和对手都标成“离线”，没有区分本地连接恢复与远端玩家 presence。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-053 | `quick.playing.1v1` | P2 | 对手断线只标“离线”，未显示服务端 30 秒宽限/判负倒计时，玩家不知道应等待还是退出。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-054 | `quick.waiting.4p` | P1 | max_players=4 但只有 3 名玩家时只渲染三卡，没有明确“等待玩家”的第 4 席。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-055 | `quick.waiting.4p` | P2 | 快速匹配错误展示 `HOST · GROUP BATTLE`，制造并不存在的房主职责心智模型。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-056 | `quick.waiting.4p` | P2 | 三位非自己玩家均只标“对手”，顶部席位与下方进度板无法快速对应。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-057 | `quick.playing.4p` | P1 | 服务端从 HashMap.values 生成玩家数组，快照间席位顺序可能变化，三个对手进度板会互换。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-058 | `quick.playing.4p` | P2 | 只有个人分数，没有当前名次、并列状态或领先者标识，四人局势难扫读。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-059 | `quick.roundResult` | P1 | 四人结果弹层仍用双人 `self : first opponent` 比分，遗漏另外两人并可能误导当前排名。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-060 | `quick.seriesResult` | P2 | 系列结束只提供“返回模式大厅”，缺少可发现的“查看对局”和沿用设置的“再来一局”。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-064 | `quick.playing.4p` | P2 | 4 人断线倒计时只跟踪首位对手，对手 2/3 断线时无法看到各自宽限与判负时间。 | `fix_state_checking_identity`（已修） | 通过，已关闭 |
| J-065 | `room.submitting` | P1 | 加入/创建没有同步单飞锁，React pending 生效前双击可发出多请求并创建孤儿房间。 | `fix_room_submission`（已修） | 通过，已关闭 |
| J-066 | `room.submitting` | P1 | 请求无 timeout/abort/generation/unmount 保护，晚响应仍可能保存凭证并导航。 | `fix_room_submission`（已修） | 通过，已关闭 |
| J-067 | `room.submitting` | P1 | 成功导航未使用 replace，浏览器返回会回到已有凭证的设置页并可能重复创建/加入。 | `fix_room_submission`（已修） | 通过，已关闭 |
| J-068 | `room.submitting` | P2 | pending 时房间号输入仍可编辑，控件冻结不完整。 | `fix_room_submission`（已修） | 通过，已关闭 |
| J-069 | `room.submitting` | P2 | 缺少本次提交快照，pending 摘要可能与用户随后看到的设置不一致。 | `fix_room_submission`（已修） | 通过，已关闭 |
| J-070 | `room.submitting` | P2 | 提交区域缺 aria-busy/status/live，读屏无法获知正在加入或创建。 | `fix_room_submission`（已修） | 通过，已关闭 |
| J-071 | `room.submitting` | P2 | 失败后只显示 alert，没有把焦点恢复到对应 CTA 或输入。 | `fix_room_submission`（已修） | 通过，已关闭 |
| J-072 | `room.error` | P2 | postSession 构造 ApiError 时丢失 errorCode，room_not_found/room_full 等结构化错误无法准确映射。 | `fix_room_error_codes`（已修） | 通过，已关闭 |
| J-073 | `room.error` | P2 | profile_not_found/idempotency_conflict 等服务端错误缺少中文映射，会直接泄露英文消息。 | `fix_room_error_codes`（已修） | 通过，已关闭 |
| J-074 | `room.waiting.1v1` | P1 | 显式离开只清除本地凭证并关闭连接，没有调用好友房离开接口，服务端仍保留旧成员。 | `fix_room_waiting_states`（已修） | 通过，已关闭 |
| J-075 | `room.waiting.1v1` | P1 | 等待文案声称成员到齐会自动开始，但好友房实际必须由房主发送 `start_round`。 | `fix_room_waiting_states`（已修） | 通过，已关闭 |
| J-076 | `room.waiting.1v1` | P2 | 房间号只能阅读，缺少复制操作、成功反馈和剪贴板失败降级。 | `fix_room_waiting_states`（已修） | 通过，已关闭 |
| J-077 | `room.waiting.1v1` | P2 | 非房主成员无法识别当前房主，房主转移后的控制职责也不清楚。 | `fix_room_waiting_states`（已修） | 通过，已关闭 |
| J-078 | `room.waiting.1v1` | P2 | 人数、猜测可见性、难度和 BO 分散在多处，缺少集中可扫读的房间设置摘要。 | `fix_room_waiting_states`（已修） | 通过，已关闭 |
| J-079 | `room.waiting.1v1` | P3 | 开始按钮禁用时没有可读原因，房主无法区分连接中、等待成员或权限不足。 | `fix_room_waiting_states`（已修） | 通过，已关闭 |
| J-080 | `room.playing.1v1` | P2 | 对手断线超时判胜后，结算弹窗仍声称赢家“锁定了神秘选手”，协议缺少权威结束原因。 | `fix_room_playing_1v1`（已修） | 通过，已关闭 |
| J-081 | `room.playing.1v1` | P2 | 选手搜索 combobox 只有 placeholder，没有持久的可访问名称，读屏只宣告未命名组合框。 | `fix_room_playing_1v1`（已修） | 通过，已关闭 |
| J-082 | `room.playing.1v1` | P2 | Socket.IO 同步及命令回调直接读取 `ack.accepted`，服务端返回 null/畸形 ACK 时产生未捕获异常。 | `fix_room_playing_1v1`（已修） | 通过，已关闭 |
| J-083 | `room.playing.1v1` | P3 | 同一位对手断线状态同时由对战上下文和猜测表两个 live region 播报，读屏会收到重复提醒。 | `fix_room_playing_1v1`（已修） | 通过，已关闭 |
| J-084 | `room.waiting.4p` | P1 | 四人房前后端仍按“至少 2 人”允许开始，2/4 时就会宣告成员就位并进入只含两人的乱斗。 | `fix_room_waiting_4p`（已修） | 通过，已关闭 |
| J-085 | `room.waiting.4p` | P2 | 390×844 下侧栏顶部“模式大厅”和日期/元信息被裁切，虽无横向溢出但关键信息不可见。 | `fix_room_waiting_4p`（已修） | 通过，已关闭 |
| J-086 | `room.waiting.4p` | P2 | 四个玩家卡均为无分组语义的普通容器，读屏无法识别玩家列表与每个席位边界。 | `fix_room_waiting_4p`（已修） | 通过，已关闭 |
| J-087 | `room.submitting` | P2 | 开发环境 StrictMode 首次 effect cleanup 会永久 dispose `RoomSubmission`，随后创建/加入静默失效，阻塞本地验收。 | `fix_room_waiting_4p`（已修） | 通过，已关闭 |
| J-088 | `room.playing.4p` | P1 | 玩家断线超时已被本轮判负后重连，快照仍只显示在线且搜索可用，但提交会被 `round_forfeited` 拒绝，资格状态对玩家不可见。 | `fix_room_playing_4p`（已修） | 通过，已关闭 |
| J-089 | `room.roundResult` | P1 | 结算阶段成员离开后客户端先收到旧快照；2人房显示可开始但服务端已裁定系列，4人房剩3/4且不能补位或继续，系列永久卡死。 | `fix_room_round_result`（已修） | 通过，已关闭 |
| J-090 | `room.roundResult` | P2 | 用户关闭结算弹窗后刷新，同一房间同一轮的庆祝弹窗会再次自动出现。 | `fix_room_round_result`（已修） | 通过，已关闭 |
| J-091 | `room.roundResult` | P2 | 390×844 的4人榜单以 `min-w-[32rem]` 撑宽整个弹窗，标题和底部操作随页面横向偏移。 | `fix_room_round_result`（已修） | 通过，已关闭 |
| J-092 | `room.roundResult` | P2 | 好友房 BO3/BO5 没有权威下一轮倒计时或自动开始，完全依赖房主手动操作且刷新后没有连续节奏。 | `fix_room_round_result`（已修） | 通过，已关闭 |
| J-093 | `connection.idle` | P2 | 队列 socket 正在 connecting/reconnecting 时，online/visible 会新建实例并覆盖引用；旧实例仍可重连且卸载无法关闭，形成孤儿连接与重复广播。 | `fix_connection_idle`（已修） | 通过，已关闭 |
| J-094 | `room.seriesResult` | P2 | BO3/BO5 终局只展示最后一轮答案与累计比分/排名，协议没有逐轮结果，用户无法核对各轮答案、胜负和轮后比分。 | `fix_room_series_result`（已修） | 通过，已关闭 |
| J-095 | `room.seriesResult` | P2 | 好友房系列终局只有查看对局和返回大厅，没有保留成员、重置系列并继续同一房间的权威“再来一局”流程。 | `fix_room_series_result`（已修） | 通过，已关闭 |
| J-096 | `room.seriesResult` | P3 | 缺少 BO5、2/4人房主与成员视角、刷新终局、好友房重赛和 BO1 平局加赛的协议与端到端覆盖。 | `fix_room_series_result`（已修） | 通过，已关闭 |
| J-097 | `connection.connecting` | P2 | 初次连接与离线共用红色警告视觉，自己的 presence 还误写为“正在重连”，并由两个 live region 重复暗示曾断线。 | `fix_connection_connecting`（已修） | 通过，已关闭 |
| J-098 | `connection.connecting` | P2 | 首个权威 Snapshot 到达前，空快照被默认渲染成 2P/BO3/waiting 的完整伪房间、0:0 和等待对手。 | `fix_connection_connecting`（已修） | 通过，已关闭 |
| J-099 | `connection.connecting` | P3 | room realtime hook 缺少 StrictMode、延迟 sync、鉴权失败与空 ACK 的整钩子生命周期覆盖。 | `fix_connection_connecting`（已修） | 通过，已关闭 |
| J-100 | `connection.connected` | P2 | 同一猜测 `request_id` 的 ACK 重试会重新生成新序号结果事件，客户端可能重复行/进度并提前禁用输入。 | `fix_connection_connected`（已修） | 通过，已关闭 |
| J-101 | `connection.connected` | P2 | 匹配页把连接状态与动态人数放在同一 live status，人数每次变化都会重复播报两条“已连接”。 | `fix_connection_connected`（已修） | 通过，已关闭 |
| J-102 | `connection.connected` | P2 | 浏览器完整刷新会丢失当前未提交的搜索词与已选选手，虽已提交进度可由 Snapshot 恢复。 | `fix_connection_connected`（已修） | 通过，已关闭 |
| J-103 | `connection.connected` | P3 | 同序号同步 Snapshot 只按 `< lastSeq` 过滤，HTTP 初始快照后的相同 seq ACK 会重复应用与派生。 | `fix_connection_connected`（已修） | 通过，已关闭 |
| J-104 | `connection.reconnecting` | P2 | 房间 socket 无限重连且没有总时限，永久断网会永远停留在 reconnecting，无法进入明确可恢复的 offline/timeout 状态。 | `fix_connection_reconnecting`（已修） | 通过，已关闭 |
| J-105 | `connection.reconnecting` | P2 | 断线前已展开的搜索结果项仍保留 `onSelect`，输入和提交虽禁用，用户仍可点击改写未提交草稿。 | `fix_connection_reconnecting`（已修） | 通过，已关闭 |
| J-106 | `connection.reconnecting` | P2 | 自己本轮已判负时 presence 优先显示“在线 · 本轮已判负”，本地 transport 断线后不会显示正在重连。 | `fix_connection_reconnecting`（已修） | 通过，已关闭 |
| J-107 | `connection.reconnecting` | P2 | 重连同时由连接 status 与错误 alert 播报，同一断线事件被读屏重复宣布，权威快照壳层也有相同组合。 | `fix_connection_reconnecting`（已修） | 通过，已关闭 |
| J-108 | `connection.offline` | P1 | 鉴权失效后重试与刷新会无限复用旧 token；好友房/匹配的 401/403/404 安全退出又不会提交本地清理。 | `fix_connection_offline`（已修） | 通过，已关闭 |
| J-109 | `connection.offline` | P2 | 终局离线时“再来一局”按钮仍视觉启用，点击只被 `!connected` guard 静默吞掉。 | `fix_connection_offline`（已修） | 通过，已关闭 |
| J-110 | `connection.offline` | P2 | Quick matching 离线且取消失败时，同时渲染实时连接与取消失败两个 alert。 | `fix_connection_offline`（已修） | 通过，已关闭 |
| J-111 | `connection.offline` | P3 | 动态进入 offline 后没有把焦点引导到恢复区，原控件禁用后缺少稳定的键盘恢复路径。 | `fix_connection_offline`（已修） | 通过，已关闭 |
| J-112 | `search.idle` | P2 | IME 组合输入期间 `onValueChange` 仍立即展开并匹配，`isComposing` 只保护了键盘事件。 | `fix_search_idle`（已修） | 通过，已关闭 |
| J-113 | `search.idle` | P3 | 移动单列中结果层绝对定位覆盖下一行提交按钮，虽无横向溢出但主要操作会被遮挡。 | `fix_search_idle`（已修） | 通过，已关闭 |
| J-114 | `connection.closed` | P2 | 服务端主动断开 fatal 分支只置状态和清凭证，没有 retire 当前 Socket owner，监听器与 Manager 资源保留到页面卸载。 | `fix_connection_closed`（已修） | 通过，已关闭 |
| J-115 | `connection.closed` | P2 | 取消/退出意图只存在内存，DELETE 未确认时刷新或返回会中止请求并重新恢复旧会话。 | `fix_connection_closed`（已修） | 通过，已关闭 |
| J-116 | `connection.closed` | P2 | 好友房退出的异步晚响应缺 mounted/generation 导航守卫，用户已建立新会话后仍可能被 replace 到首页。 | `fix_connection_closed`（已修） | 通过，已关闭 |
| J-117 | `connection.closed` | P3 | 无凭证直达游戏页仍进入恢复壳并显示“凭证已保存”，没有准确 replace 到对应入口。 | `fix_connection_closed`（已修） | 通过，已关闭 |
| J-118 | `search.querying` | P2 | 其他字段的精确匹配会压过昵称前缀；全目录有 11 组查询把战队精确结果排在目标昵称前缀之前。 | `fix_search_querying`（已修） | 通过，已关闭 |
| J-119 | `search.keyboardHighlight` | P2 | cmdk 自动首项/鼠标 hover 与组件高亮状态不同步，`aria-selected` 已变化但 activedescendant 和灰色补全仍为空。 | `fix_search_keyboard_highlight`（已修） | 通过，已关闭 |
| J-120 | `search.keyboardHighlight` | P2 | 外部受控 query 或候选结果集收缩时，可能保留已不存在的 highlightedId/键盘模式，直到下一次方向键才恢复。 | `fix_search_keyboard_highlight`（已修） | 通过，已关闭 |
| J-121 | `search.enterSubmit` | P2 | 高亮 Enter 在实时 ACK 前就清空 query/收起；发送失败或 ACK 拒绝时只解除 pending，草稿已丢且无法直接重试。 | `fix_search_enter_submit`（已修） | 通过，已关闭 |
| J-122 | `search.noResults` | P2 | 空结果提示只在视觉上显示为 presentation，结果从有到无时读屏无法获得“没有找到这名选手”的动态反馈。 | `fix_search_no_results`（已修） | 通过，已关闭 |
| J-123 | `search.retiredOrUnattached` | P2 | 36 名选手仍以 `ex-*` 旧队名作为当前战队；抓取合并还会在 `currentTeam` 缺失时回填旧战队，导致离队选手被误呈现为仍属旧队。 | `fix_search_retired_unattached`（已修） | 通过，已关闭 |
| J-124 | `tooltip.open` | P2/P3 | InfoTip 仅能点击打开，hover/focus 不显示；Popover 动画未适配 reduced-motion，24 个入口缺少交互回归测试，Quick Match 说明入口过度拆分。 | `fix_tooltip_open`（已修） | 通过，已关闭 |
| J-125 | `dialog.focus` | P2/P3 | 身份抽取、匹配成功导航和对战退出关闭后缺少稳定焦点接收者；部分测试 mock Dialog，未覆盖真实 Escape、Tab 环与恢复。 | `fix_dialog_focus`（已修） | 通过，已关闭 |
| J-126 | `responsive.desktop` | P2/P3 | 好友房等宽列实际内容约 184px 对 483px，左下形成大块空白；身份页仍用 0.92fr/1.08fr，且 section/control 间距 token 未落地，页面继续混用局部数值。 | `fix_responsive_desktop`（已修） | 通过，已关闭 |
| J-127 | `responsive.mobile` | P2/P3 | Button 默认/小尺寸仅 28–36px，多个移动触控目标小于40px；首页 Header 在390px被挤成 `CS GUE...`，且缺少统一390px几何回归合同。 | `fix_responsive_mobile`（已修） | 通过，已关闭 |
| J-128 | `motion.reduced` | P2/P3 | 独立复验发现 reduced-motion 重抽结果不重新聚焦确认按钮；StrictMode 首轮 cleanup abort 后，第二轮 setup 会因 ref/cache 命中而不重启头像预载。 | `fix_motion_reduced` / sol high | 已修复并复验 |
| J-061 | `room.setup` | P1 | 移动端加入房间卡被 min-h-96 强制撑高，CTA 固底留下大空白，把创建设置推到首屏之外。 | `fix_room_setup_layout`（已修） | 通过，已关闭 |
| J-062 | `room.setup` | P2 | 桌面左右强制等高，左侧单输入大面积留白而右侧配置密集，视觉重量仍不均衡。 | `fix_room_setup_layout`（已修） | 通过，已关闭 |
| J-063 | `room.setup.difficulty` | P2 | 难度选择只显示简单/完整/困难与人数，未展示已有的知名选手/Major全池/全部选手题池含义。 | `fix_room_difficulty_labels`（已修） | 通过，已关闭 |

## 审查日志

| 时间 | 状态 | 检查 agent | 结果 | 截图/证据 |
| --- | --- | --- | --- | --- |
| 2026-07-28 | 初始化 | root | 已建立全量状态清单 | `src/machines/user-journey-machine.ts` |
| 2026-07-28 | `checkingIdentity` | `audit_state_checking_identity` / sol low | P2，已派发 sol high 修复 | 源码与 21 项相关测试；瞬时态暂缺截图 |
| 2026-07-28 | `checkingIdentity` | `audit_state_checking_identity` / sol low 复验 | 通过；J-001 关闭 | 23 项相关测试 + `pnpm typecheck`；真实慢网截图为证据缺口 |
| 2026-07-28 | `onboarding.idle` | `audit_state_onboarding_idle` / sol low | 真正首次用户截图已补，等待复核 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\12-onboarding-idle-fresh.png` |
| 2026-07-28 | `onboarding.idle` | `audit_state_onboarding_idle` / sol low | P2，已派发 sol high 修复 | 1280×720 首屏 CTA 在折叠线下；移动端待复验 |
| 2026-07-28 | `onboarding.rolling` | `audit_state_onboarding_rolling` / sol low | P1/P2，已派发 sol high 修复 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\13-onboarding-rolling-fresh.png` |
| 2026-07-28 | `onboarding.result` | `audit_state_onboarding_result` / sol low | P1/P2，合并到同一 dialog 的 sol high 修复 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\14-onboarding-result-fresh.png` |
| 2026-07-28 | `lobby` | `audit_state_lobby` / sol low | P1/P2，已派发 sol high 修复 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\15-lobby-current.png` |
| 2026-07-28 | `onboarding.rolling` | `audit_state_onboarding_rolling` / sol low 复验 | 通过；J-002 关闭 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\17-onboarding-rolling-fixed.png`；DPR 裁切不用于坐标判断 |
| 2026-07-28 | `onboarding.result` | `audit_state_onboarding_result` / sol low 复验 | 通过；J-004 关闭 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\18-onboarding-result-fixed.png` + CTA `[active]` DOM；移动端仅代码约束 |
| 2026-07-28 | `onboarding.idle` | `audit_state_onboarding_idle` / sol low 复验 | 通过；J-003 关闭，CTA 折叠线为 DPR 截图误报 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\16-onboarding-result-fixed.png`（实际状态为 onboarding idle）+ 2 项测试 |
| 2026-07-28 | `lobby` | `audit_state_lobby` / sol low 复验 | 通过；J-005 关闭，原 P1 为 DPR 截图误报 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\19-lobby-fixed.png`（仅用于层级/文案）+ 2 项测试 |
| 2026-07-28 | `identity.idle` | `audit_state_identity_idle` / sol low | P2，已派发 sol high 合并修复 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\20-identity-idle.png` |
| 2026-07-28 | `identity.rolling` | `audit_state_identity_rolling` / sol low | P2，普通重抽预载与付费恢复问题 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\21-identity-rolling.png` |
| 2026-07-28 | `identity.result` | `audit_state_identity_result` / sol low | P2，付费竞态与结果读屏问题 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\22-identity-result.png` + 主 CTA `[active]` DOM |
| 2026-07-28 | `stats.list.empty` | `audit_state_stats_empty` / sol low | P2，已派发 sol high 合并修复 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\23-stats-empty.png` |
| 2026-07-28 | `stats.list.populated` | `audit_state_stats_populated` / sol low | P1/P2，回合/系列口径与 0 猜测问题 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\24-stats-populated.png` |
| 2026-07-28 | `stats.replay` | `audit_state_stats_replay` / sol low | P1/P2，历史回退伪造与 8 行空猜测问题 | `C:\Users\12009\.codex\visualizations\2026\07\28\cs-guess-user-journey-audit\25-stats-replay.png` + 表格 region `[active]` DOM |
| 2026-07-28 | `daily.loading` | `audit_state_daily_loading` / sol low | P2，已派发 sol high 修复；无稳定截图 | 源码、状态机与相关测试 |
| 2026-07-28 | `identity.idle` | `audit_state_identity_idle` / sol low 复验 | 通过；J-006 关闭 | 当前/已解锁文字状态、行内资格说明、消耗文案、中文战绩；10 项相关测试 |
| 2026-07-28 | `daily.loading` | `audit_state_daily_loading` / sol low 复验 | 通过；J-014 关闭 | 同构 chunk/data/error surface；8 项相关测试；真实慢网截图仍为证据限制 |
| 2026-07-28 | `identity.rolling/result` | `audit_state_identity_rolling` / sol low 复验 | J-007–J-009 主体通过；发现残余跨标签收敛 P2，派发二次 sol high | 12 项相关测试 + 状态同步源码审查；J-015 |
| 2026-07-28 | `stats.list.empty/populated/replay` | `audit_state_stats_empty` / sol low 复验 | 空态、回合口径、0 猜测、历史失效、详情上下文通过；发现答案失效组合的桌面隐藏 P2 | 11 项相关测试；J-010–J-013 关闭，J-016 |
| 2026-07-28 | `daily.lost.dialog` + `daily.lost.result` | `audit_state_daily_loading` / sol low | 两态 P2，已派发 sol high 修复 | `27-daily-lost-dialog.png`、`28-daily-lost-result.png` + 23 项相关测试；J-017–J-019 |
| 2026-07-28 | `stats.replay` | `audit_state_stats_empty` / sol low 二次复验 | 通过；J-016 关闭，统计三态全部完成 | 8 项 StatsPage 测试 + typecheck |
| 2026-07-28 | `identity.rolling/result` | `audit_state_identity_rolling` / sol low 二次复验 | 通过；J-007–J-009、J-015 关闭，身份三态全部完成 | 6 个相关测试文件、33 项测试 + typecheck |
| 2026-07-28 | `daily.error` | `audit_state_checking_identity` / sol low | 通过；真实 API 失败抵达、原位重试恢复且不伪造 round/timer | `14-daily-error-api-failure.png` + 23 项相关测试 + typecheck |
| 2026-07-28 | `daily.playing.empty` | `audit_state_identity_idle` / sol low | 通过；进入即建立绝对 deadline、0/8、空搜索不展开、8 行桌面/移动收敛 | `26-daily-playing-empty.png` + 14 项相关测试 |
| 2026-07-28 | `daily.playing.results` | `audit_state_checking_identity` / sol low | P2，方向/同洲/距离逻辑与刷新恢复通过，但比较提示对比度不足 | `15-daily-playing-results-desktop.png`、`16-daily-playing-results-mobile.png` + 8 项相关测试；J-020 |
| 2026-07-28 | `daily.lost.dialog` + `daily.lost.result` | `audit_state_daily_loading` / sol low 复验 | 通过；J-017–J-019 关闭 | 前端 8、Python 7、Rust 2 项定向测试；答案 ID 不变、焦点交接、0 猜测幂等记录 |
| 2026-07-28 | `daily.playing.results` | `audit_state_checking_identity` / sol low 复验 | 通过；J-020 关闭 | 最差对比度 4.72:1，距离提示 12px 无降透明度；2 项测试 + typecheck |
| 2026-07-28 | `daily.won.dialog` + `daily.won.result` | `audit_state_identity_idle` / sol low | 通过；隔离 origin 真实猜中并验证焦点、结果替换、刷新幂等 | `27-daily-won-dialog.png`、`28-daily-won-result.png` + 6 项相关测试 |
| 2026-07-28 | `solo.selectingDifficulty` | `audit_state_daily_loading` / sol low | P2；三档内容/人数/进入路径/响应式通过，radio 方向键无效 | `29-solo-selecting-difficulty-desktop.png`、`30-solo-selecting-difficulty-mobile-390.png`；J-021 |
| 2026-07-28 | `solo.playing.results` | `audit_state_checking_identity` / sol low | P2；比较矩阵/继续搜索/移动结构通过，刷新静默重置练习 | `17-solo-playing-results-desktop.png`、`18-solo-playing-results-mobile.png` + 6 项相关测试；J-022 |
| 2026-07-28 | `solo.playing.empty` | `audit_state_identity_idle` / sol low | P2/P3；0/8、计时、题池/URL、桌面移动结构通过，刷新重置且空 combobox ARIA 不一致 | `29-solo-playing-empty-desktop.png`、`30-solo-playing-empty-mobile.png` + 14 项相关测试；J-022、J-023 |
| 2026-07-28 | `solo.selectingDifficulty/playing.empty/playing.results` | `reverify_solo_states` / sol low 复验 | 通过；J-021–J-023 关闭 | 6 个文件、22 项测试 + typecheck；进度持久化、radio 键盘、combobox ARIA |
| 2026-07-28 | `solo.won.dialog` + `solo.won.result` | `audit_solo_won_states_2` / sol low | dialog 通过；result P2，关闭后缺少焦点交接 | 4 个文件、16 项相关测试；真实截图为证据限制；J-024 |
| 2026-07-28 | `solo.lost.dialog` + `solo.lost.result` | `audit_solo_won_states_2` / sol low | P2；结果替换/刷新/幂等通过，失败原因未持久化且结果焦点未交接 | 16 项相关测试；真实截图为证据限制；J-024、J-025 |
| 2026-07-28 | `solo.won.dialog` + `solo.won.result` + `solo.lost.dialog` + `solo.lost.result` | `audit_solo_won_states_2` / sol low 复验 | J-024/J-025 通过；发现 v1→v2 无迁移 P2，继续修复 | 7 个文件、22 项测试 + typecheck；J-026 |
| 2026-07-28 | `solo.playing/won/lost` | `audit_solo_won_states_2` / sol low 最终复验 | 通过；J-026 关闭，Solo 全部状态完成 | 4 个文件、25 项测试 + typecheck；稳定 fallback、迁移提示与幂等 |
| 2026-07-28 | `quick.setup` | `audit_solo_won_states_2` / sol low | 通过；组合摘要、CTA、实时人数、身份入口、桌面移动结构一致 | `quick-setup-desktop.png`、`quick-setup-mobile-390-top.png`；移动 full-page 截图为证据限制 |
| 2026-07-28 | `quick.submitting` | `audit_solo_won_states_2` / sol low | P1/P2；成功/错误/减少动画基础通过，双击幽灵队列、设置竞态与读屏反馈不足 | 源码与请求生命周期审查；未污染共享队列；J-027–J-029 |
| 2026-07-28 | `quick.setupError` | `audit_solo_won_states_2` / sol low | P2/P3；503 实测保留设置/可重试，但无 timeout、失败焦点丢失、设置变更不清旧错 | `quick-setup-error-capacity.png`；CDP 拦截未污染共享队列；J-030–J-032 |
| 2026-07-28 | `quick.matching` | `audit_solo_won_states_2` / sol low | P1/P2；摘要/凭证/取消/响应式通过，房间连接错误被隐藏且缺恢复、身份、总数与合理 live 语义 | `quick-matching-isolated.png`；mock session 未污染共享队列；J-033–J-037 |
| 2026-07-28 | `quick.canceling` | `audit_solo_won_states_2` / sol low | P1/P2；单次取消成功/reduced-motion/错误保票通过，取消与匹配成功竞态且缺单飞、晚响应保护、a11y | `quick-canceling-isolated.png`；mock DELETE 未污染共享队列；J-038–J-041 |
| 2026-07-28 | `quick.cancelError` | `audit_solo_won_states_2` / sol low | P1/P2；503 实测保留队列与可重试，但继承导航竞态且无 timeout、焦点恢复、错误 code 映射 | `quick-cancel-error-isolated.png`；mock DELETE 未污染共享队列；J-038–J-044 |
| 2026-07-28 | `quick.submitting/setupError` | `audit_solo_won_states_2` / sol low 复验 | 客户端 UI/超时/焦点与设置冻结通过；真实 abort 幽灵票、幂等缓存无界及指纹泄露仍为 P1 | 前端 12 项 + Rust 并发幂等测试；J-028–J-032 关闭，J-027/J-045/J-046 |
| 2026-07-28 | `quick.entering` | `audit_solo_won_states_2` / sol low | P1/P2/P3；replace/凭证/timer清理基础通过，modal焦点、reduced延迟、玩家角色与4人分隔不足 | 隔离 mock session，overlay 短暂无法稳定截图；J-047–J-050 |
| 2026-07-28 | `quick.waiting.1v1` | `audit_solo_won_states_2` / sol low | P1/P2；身份/比分/布局/刷新基础通过，离开未清服务器房间且重连双方误报离线 | `quick-waiting-1v1-isolated.png`、`quick-waiting-1v1-mobile-isolated.png`；J-051/J-052 |
| 2026-07-28 | `quick.playing.1v1` | `audit_solo_won_states_2` / sol low | P2；左右对称/隐藏明牌/进度/Socket去重/移动通过，对手断线缺权威宽限倒计时 | `quick-playing-1v1-hidden-desktop.png`、`quick-playing-1v1-open-mobile.png`；J-053 |
| 2026-07-28 | `quick.waiting.4p` | `audit_solo_won_states_2` / sol low | P1/P2；模式/比分/在线离线/移动通过，缺第4空席、误导房主标签及稳定对手编号 | `quick-waiting-4p-desktop.png`、`quick-waiting-4p-mobile.png`；J-051/J-054–J-056 |
| 2026-07-28 | `quick.playing.4p` | `audit_solo_won_states_2` / sol low | P1/P2；四席/自己高亮/隐藏明牌/移动通过，服务端席位不稳定且缺明确排名 | `quick-playing-4p-hidden-desktop.png`、`quick-playing-4p-hidden-mobile.png`；J-053/J-057/J-058 |
| 2026-07-28 | `quick.roundResult` | `audit_solo_won_states_2` / sol low | P1；双人结算/答案/权威倒计时/焦点/幂等通过，四人弹层只显示自己与首个对手 | `quick-round-result-bo3.png`；J-059 |
| 2026-07-28 | `quick.seriesResult` | `audit_solo_won_states_2` / sol low | P2；最终排行榜/刷新幂等/焦点/移动通过，只有返回大厅，缺查看与再来一局 | `quick-series-result-4p-bo5-desktop.png`、`quick-series-result-4p-bo5-mobile.png`；J-060 |
| 2026-07-28 | `room.setup` | `audit_solo_won_states_2` / sol low | P1/P2；输入/设置/键盘/错误/响应式基础通过，移动卡过高且桌面左右视觉重量失衡 | `room-setup-desktop.png`、`room-setup-mobile.png`；J-061/J-062 |
| 2026-07-28 | `room.setup/room.setup.difficulty` | `audit_solo_won_states_2` / sol low 复验 | 布局通过，J-061/J-062关闭；难度题池含义缺失P2 | `room-setup-difficulty-latest-desktop.png`、`room-setup-difficulty-latest-mobile.png`；J-063 |
| 2026-07-28 | `quick.submitting`–`quick.seriesResult` | `audit_solo_won_states_2` / sol low 总复验 | 除 4 人非首位对手断线倒计时外通过；J-027/J-033–J-060 关闭 | 前端 36、Rust 9 项测试 + Socket.IO E2E + typecheck；J-064 |
| 2026-07-28 | `room.setup.difficulty` | `audit_solo_won_states_2` / sol low 复验 | 通过；J-063 关闭 | 390px 三列/96px 高/无溢出；3 项测试 + typecheck |
| 2026-07-28 | `quick.playing.4p` | `audit_solo_won_states_2` / sol low 最终复验 | 通过；J-064 关闭，Quick 全部状态完成 | 4 个文件、9 项测试 + typecheck；对手1–3独立权威断线倒计时 |
| 2026-07-28 | `room.submitting` | `audit_solo_won_states_2` / sol low | P1/P2；基础禁用/存凭证顺序/alert通过，缺单飞、超时晚响应、replace、完整冻结、快照与a11y/焦点 | 源码与请求生命周期审查；未创建共享房间；J-065–J-071 |
| 2026-07-28 | `room.submitting` | `audit_solo_won_states_2` / sol low 复验 | 通过；J-065–J-071 关闭 | 前端 19、Rust 2 项测试 + typecheck；好友房补偿离开与房主转移 |
| 2026-07-28 | `room.error` | `audit_solo_won_states_2` / sol low | P2；错误位置/焦点/保留设置/重试通过，ApiError丢code且两类后端错误未中文化 | 17 项相关测试 + typecheck；J-072/J-073 |
| 2026-07-28 | `room.error` | `audit_solo_won_states_2` / sol low 复验 | 通过；J-072/J-073 关闭 | 3 个文件、33 项测试 + typecheck；结构化中文错误映射 |
| 2026-07-28 | `room.waiting.1v1` | `audit_solo_won_states_2` / sol low | P1/P2/P3；席位、身份、比分、presence、刷新恢复和服务端房主转移基础通过，离开同步、真实开始语义、复制、房主识别、集中摘要及禁用原因不足 | 源码、5 项 presence 测试；共享房间 mock 路由限制导致本轮无可信截图；J-074–J-079 |
| 2026-07-28 | `room.waiting.1v1` | `fix_stats_states` / sol low 复验 | 未通过；J-075–J-078 关闭，J-074 任意 2xx 会误清会话，J-079 连续相同 ACK 错误会卡住 pending | 前端 19 项、Rust 1 项测试 + typecheck；真实等待房截图仍为证据缺口 |
| 2026-07-28 | `room.waiting.1v1` | `fix_stats_states` / sol low 最终复验 | 通过；J-074/J-079 关闭，好友房等待态完成 | 5 个相关文件、43 项测试 + typecheck；严格 204/404 退出与连续同错 ACK 重试 |
| 2026-07-28 | `room.playing.1v1` | `fix_state_checking_identity` / sol low | 无 P1；真实双客户端的房主开始、隐藏/明牌、搜索提交、8次限制、桌面/移动、刷新与离开基础通过；断线胜因文案、搜索可访问名称、空 ACK 容错及重复 live 播报不正确 | 真实 host/member 双端截图 5 张；前端 50 项、Socket.IO E2E、Rust 断线判胜/BO3/离房测试；权威倒计时的当前构建视觉实证仍缺；J-080–J-083 |
| 2026-07-28 | `room.waiting.4p` | `fix_stats_states` / sol low | 不通过；4席/presence/摘要/复制/房主转移/清房基础通过，2/4可错误开局、移动顶部裁切、玩家卡缺分组语义，且开发 StrictMode 阻塞创建/加入 | 真实 host + 3 Socket.IO 客户端；桌面/移动截图；前端56、Rust28项测试 + typecheck；J-084–J-087；首连 ACK 告警并入 J-082 复验 |
| 2026-07-28 | `room.playing.1v1` | `fix_state_checking_identity` / sol low 复验 | 通过；J-080–J-083 关闭，1v1好友房对局完成 | 前端6文件39项、Rust room 7项、Socket.IO队列/鉴权/ACK/重连测试 |
| 2026-07-28 | `room.playing.4p` | `fix_stats_states` / sol low | P1；4席、排名、隐藏进度、三人独立断线、刷新稳定、房主转移和移动端基础通过；断线超时判负者重连后被误呈现为仍可参赛 | 真实 host + 3 Socket.IO 客户端；桌面/移动截图；前端33、Rust29项测试 + typecheck；旧dist的J-082/J-083现象不计当前源码问题；J-088 |
| 2026-07-28 | `room.waiting.4p` | `fix_state_checking_identity` / sol low 复验 | 通过；J-084–J-087 关闭，四人好友房等待态完成 | 前端5文件48项 + typecheck、Rust专项、Socket.IO E2E；390×844 1/4与4/4截图 |
| 2026-07-28 | `room.playing.4p` | `fix_stats_states` / sol low 复验 | 未通过；权威判负快照、重连状态与进度板通过，但收到 `round_forfeited` error 的客户端会把旧错误带入下一轮并继续禁猜 | Rust定向 + 前端49项 + typecheck；J-088残余退回修复 |
| 2026-07-28 | `room.playing.4p` | `fix_stats_states` / sol low 最终复验 | 通过；J-088关闭，四人好友房对局态完成 | 真实4人Socket房间跨轮判负恢复；前端52+19、Rust30项 + typecheck/diff-check；席位与进度板截图 |
| 2026-07-28 | `room.roundResult` | `fix_state_checking_identity` / sol low | 不通过；2P/4P资料、比分排名、焦点、桌面/reduced-motion与四类权威原因基础通过；结算离开会卡死系列、刷新重复庆祝、移动榜单撑宽弹窗、好友房缺权威下一轮倒计时 | 真实2P断线结算与4P桌面/移动截图；前端36、Rust room9项 + typecheck/Socket.IO E2E；J-089–J-092 |
| 2026-07-28 | `connection.idle` | `fix_stats_states` / sol low | 主路径通过但不可关闭；非实时路由/退出/凭证与连接分离/timer清理通过，队列socket在connecting/reconnecting期间可被online/visible覆盖成孤儿 | 真实连接计数；前端80项 + typecheck；StrictMode稳定无双活但缺manager生命周期覆盖；J-093 |
| 2026-07-28 | `room.seriesResult` | `fix_state_checking_identity` / sol low | 不通过；累计比分/胜者/离开终止排名/清房/焦点/reduced-motion与相邻J089–092补丁基础通过，缺逐轮历史和同房再开入口，BO5/多视角/刷新/重赛覆盖不足 | 前端5文件36项、Rust room11项+路由1项、typecheck；并行HMR导致当前轮截图缺口；J-094–J-096 |
| 2026-07-28 | `connection.idle` | `fix_stats_states` / sol low 复验 | 通过；J-093关闭，非实时页与退出实时页无孤儿连接 | queue生命周期17项、typecheck、Socket.IO E2E、build；OwnedSocket/generation与路由懒加载复验 |
| 2026-07-28 | `room.roundResult` | `fix_state_checking_identity` / sol low 复验 | 部分通过；J-090–J-092关闭，J-089核心状态正确但断线超时文案被泛化离开文案遮蔽 | 前端7文件59项、Rust room11项+清房1项、Socket.IO E2E；移动截图本轮服务无响应，源码/渲染测试为证 |
| 2026-07-28 | `connection.connecting` | `fix_state_checking_identity` / sol low | 无P1；matching与失败恢复、Socket所有权通过；初连视觉/presence/live文案错误，首个Snapshot前渲染伪房间，room hook整生命周期覆盖不足 | 前端7文件63项 + typecheck、Socket.IO E2E；J-097–J-099 |
| 2026-07-28 | `room.roundResult` | `fix_state_checking_identity` / sol low 二次复验 | 仍未通过；J-089四种终局文案与旧快照回退正确，但 DialogDescription 与倒计时子节点形成嵌套 live region | 前端3文件37项 + typecheck；J-089 a11y残余退回修复 |
| 2026-07-28 | `room.roundResult` | `fix_state_checking_identity` / sol low 最终复验 | 通过；J-089关闭，好友房单回合结算态完成 | Celebration 2文件16项 + typecheck/diff-check；五类状态唯一live region与reduced-motion |
| 2026-07-28 | `room.seriesResult` | `fix_stats_states` / sol low 复验 | 部分通过；J-094关闭，J-095/J-096残余为房主断线超时后未转移host，在线成员无权restart并卡在terminal | 前端6文件56项、Rust room13项、typecheck/Socket.IO E2E/build；退回修复 |
| 2026-07-28 | `connection.connected` | `fix_state_checking_identity` / sol low | 无P1；乱序过滤、2/4P快照、重连进度、队列节流分桶与单例连接通过；ACK重试重复事件、人数live重复播报、刷新丢草稿、同seq快照重应用 | 前端9文件98项、服务端6项、Socket.IO E2E、build；J-100–J-103 |
| 2026-07-28 | `connection.connecting` | `fix_stats_states` / sol low 复验 | 通过；J-097–J-099关闭，初连连接壳与room hook生命周期完成 | 定向7文件84项、全量266项、typecheck、Socket.IO E2E、SSR bundle；移动/StrictMode复验 |
| 2026-07-28 | `room.seriesResult` | `fix_stats_states` / sol low 二次复验 | 部分通过；J-095关闭，J-096残余为host显式离开且剩余成员全离线时仍把离线最小seat设为host而不清房，相关直接覆盖不足 | Rust room18项、前端70项、typecheck、Socket.IO E2E；退回修复 |
| 2026-07-28 | `connection.reconnecting` | `fix_state_checking_identity` / sol low | 无P1；快照/草稿保留、CTA门控、对手倒计时、单socket、sync去重与鉴权offline通过；永久故障无限重连、搜索结果仍可选、判负遮蔽transport、status+alert重复播报 | 延迟mock 10文件89项、Socket.IO E2E；J-104–J-107 |
| 2026-07-28 | `connection.reconnecting` | `fix_state_checking_identity` / sol low 复验 | 部分通过；J-104–J-106关闭，J-107残余为MatchmakingPage的连接status与error alert在重连/超时时双播报 | 组件/fake-timer/a11y 8文件91项、typecheck、Socket.IO E2E；退回修复 |
| 2026-07-28 | `connection.connected` | `audit_connection_connected_reverify` / sol low 复验 | 通过；J-100–J-103关闭，已连接态完成 | 前端68+13项、Rust幂等2项、Socket.IO E2E、typecheck；双层幂等/草稿/同seq复验 |
| 2026-07-28 | `connection.offline` | `fix_stats_states` / sol low | 不通过；30秒超时、只读状态与提交门控通过，fatal旧token死循环/安全退出不清理、离线重开伪可用、双alert和焦点恢复不足 | 前端9文件122项、typecheck、Socket.IO E2E；J-108–J-111 |
| 2026-07-28 | `connection.reconnecting` | `fix_state_checking_identity` / sol low 最终复验 | 通过；J-107关闭，重连态完成 | Matchmaking+LiveGame a11y 2文件38项、typecheck；状态/alert互斥与恢复转换 |
| 2026-07-28 | `search.idle` | `fix_state_checking_identity` / sol low | 无P1；空query/ARIA/关闭/禁用/跨页复用通过，IME组合期仍展开，移动绝对浮层可能遮挡提交CTA | 组件/页面8文件66项、typecheck、build；移动受首次身份门禁限制为CSS几何证据；J-112/J-113 |
| 2026-07-28 | `connection.closed` | `audit_connection_connected_reverify` / sol low | 无P1；确认退出、失败保留、精确清理、清房/转移与普通cleanup通过；server disconnect未retire、退出意图未持久、晚响应导航竞态、无凭证文案误导 | 前端11文件134项、Rust退出7项、Socket.IO E2E、typecheck；J-114–J-117 |
| 2026-07-28 | `search.idle` | `fix_state_checking_identity` / sol low 复验 | 通过；J-112/J-113关闭，空搜索态完成 | 组件/页面8文件73项、typecheck、build；IME与移动文档流复验 |
| 2026-07-28 | `connection.offline` | `fix_stats_states` / sol low 最终复验 | 通过；J-108/J-111关闭，离线态完成 | 前端8文件136项、typecheck、Socket.IO E2E；configuration清理与焦点保持复验 |
| 2026-07-28 | `search.querying` | `fix_state_checking_identity` / sol low | 无P1/P3；多字段/国家/规范化/性能/题池范围通过，其他字段精确匹配会压过昵称前缀，目录有11组冲突 | 算法/组件/模式8文件79项 + 数据扫描；J-118 |
| 2026-07-28 | `connection.closed` | `audit_connection_connected_reverify` / sol low 复验 | 通过；J-114–J-117关闭，主动关闭态与全部连接状态完成 | 前端7文件122项、typecheck、Socket.IO E2E；tombstone/晚响应/无凭证replace复验 |
| 2026-07-28 | `search.querying` | `fix_state_checking_identity` / sol low 复验 | 通过；J-118关闭，多字段查询态完成 | 11 query/16目标、目录性质72 query/634目标 + 1 synthetic层级、31项测试、typecheck/oxlint；未把73误写成全目录数量 |
| 2026-07-28 | `search.keyboardHighlight` | `audit_connection_connected_reverify` / sol low | 无P1；键盘循环/Enter/Escape/IME/mobile基础通过，初始auto-select与hover未同步补全/ARIA，受控query或结果收缩会残留陈旧highlight | 组件/算法/页面5文件82项；J-119/J-120 |
| 2026-07-28 | `search.keyboardHighlight` | `audit_connection_connected_reverify` / sol low 复验 | 通过；J-119/J-120关闭，键盘高亮态完成 | 真实桌面/390px DOM、8文件104项、typecheck、build；唯一高亮/ARIA/滚动复验 |
| 2026-07-28 | `search.enterSubmit` | `fix_state_checking_identity` / sol low | 无P1/P3；单次提交/IME/门禁/幂等/成功清理通过，高亮Enter在ACK前清草稿，发送或ACK失败无法重试 | 前端12文件153项、Rust幂等2项、Socket.IO E2E、typecheck；J-121 |
| 2026-07-28 | `search.enterSubmit` | `fix_state_checking_identity` / sol low 复验 | 通过；J-121关闭，Enter提交态完成 | 前端9文件140项、typecheck、oxlint；失败/超时/晚ACK/轮次切换与单飞复验 |
| 2026-07-28 | `search.noResults` | `audit_connection_connected_reverify` / sol low | 无P1/P3；交互/IME/响应式/跨页复用通过，视觉空态为presentation且无live语义，读屏无法获知无结果 | 真实DOM/a11y快照、9文件113项、typecheck；J-122 |
| 2026-07-28 | `search.noResults` | `audit_connection_connected_reverify` / sol low 复验 | 通过；J-122关闭，无结果态完成 | 真实桌面/390px DOM、9文件115项、typecheck、build；唯一外部live status、IME/恢复/关闭复验 |
| 2026-07-28 | `search.retiredOrUnattached` | `fix_state_checking_identity` / sol low | 无P1/P3；搜索、困难全目录、结果/历史/头像/ARIA通过；36条 `ex-*` 与缺失 currentTeam 回填旧队造成当前战队语义错误 | 2754人全目录扫描、前端14文件96项、抓取器7项、typecheck；J-123 |
| 2026-07-28 | `search.retiredOrUnattached` | `audit_connection_connected_reverify` / sol low 复验 | 通过；J-123关闭，退役/无队伍搜索态完成；Folke两条既有身份合并冲突不阻塞本状态 | 抓取器133项、前端7文件50项、typecheck、build；2754条逐项一致与通用多来源共识规则 |
| 2026-07-28 | `tooltip.open` | `audit_tooltip_open` / sol low | 无P1；按钮/ARIA/Escape/Portal/碰撞边距/触屏点击基础通过，hover/focus/reduced-motion/行为测试不足，Quick Match入口重复 | 24个入口源码审查、5文件65项、typecheck、lint；内置浏览器不可用为视觉证据限制；J-124 |
| 2026-07-28 | `tooltip.open` | `audit_tooltip_open` / sol low 最终复验 | 通过；纯hover Escape残余退回修复后关闭J-124，说明浮层态完成 | InfoTip+QuickMatch 13项、typecheck、lint、build；hover/focus/touch/ARIA/reduced-motion复验 |
| 2026-07-28 | `dialog.focus` | `fix_search_querying` / sol low | 无P1；Radix焦点陷阱/ARIA/移动滚动/减少动画基础通过，身份抽取、匹配导航、对战退出关闭后焦点交接无效，真实集成测试不足 | 4类模态、9文件46项、typecheck；内置浏览器不可用为视觉证据限制；J-125 |
| 2026-07-28 | `dialog.focus` | `audit_tooltip_open` / sol low 复验 | 通过；J-125关闭，弹窗焦点态完成 | 11文件99项、typecheck、lint；真实Radix双向Tab/关闭恢复/自动导航/closing焦点复验 |
| 2026-07-28 | `responsive.desktop` | `fix_search_querying` / sol low | 无P1；主要路由容器/快速匹配subgrid/三等分/控件高度通过，好友房左右重量失衡、身份列比例不对称、布局token未落地 | 1440×900首页DOM几何、10文件43项、typecheck；其他页面截图受CDP超时限制；J-126 |
| 2026-07-28 | `responsive.desktop` | `audit_tooltip_open` / sol low 复验 | 通过；J-126关闭，桌面响应式态完成 | 根浏览器1440×900截图/DOM几何、7文件31项、typecheck；room分层/Identity等分/token落地复验 |
| 2026-07-28 | `responsive.mobile` | `fix_search_querying` / sol low | 无P1；主要页面/Dialog/横滑表格无页面溢出，按钮命中区系统性小于40px且首页品牌被截断，移动几何合同不足 | 根浏览器390×844截图/DOM、11文件47项、typecheck；matching真实票据与软键盘为证据限制；J-127 |
| 2026-07-28 | `responsive.mobile` | `audit_tooltip_open` / sol low 最终复验 | 通过；xs/icon-xs与Quick BO三等分残余退回修复后关闭J-127，移动响应式态完成 | 根浏览器390×844 DOM、12文件78项、typecheck；8种Button/Series/Header/Room复验 |
| 2026-07-28 | `motion.reduced` | `fix_search_querying` / sol low | 无P1；身份滚动/匹配进场/庆祝/Dialog/Popover/scroll基础通过，头像预载会阻塞减少动画抽取，少量微交互与状态测试策略不完整 | 10文件91项、typecheck；媒体模拟会话为证据限制；J-128 |
| 2026-07-28 | `motion.reduced` | `audit_tooltip_open` / sol low 最终复验 | 通过；重抽焦点与StrictMode预载两项残余退回修复后关闭J-128，减少动画态完成 | 12文件64项、typecheck、lint；rollKey播报/3099-3100ms边界/双setup/超时取消复验 |
| 2026-07-28 | 全部 66 个用户可达状态 | 根任务最终门槛 | 通过；全部状态为`[x]`，J-001–J-128均有修复与独立复验记录 | 前端59文件376项、状态机18项、抓取器133项、Rust 48项、Socket.IO E2E、typecheck、lint、build、fmt、Clippy、diff-check |
| 2026-07-28 | `connection.offline` | `fix_stats_states` / sol low 复验 | 部分通过；J-109/J-110关闭，J-108 configuration fatal未清旧凭证，J-111连接恢复后仍主动抢焦点 | 前端8文件124项、Socket.IO E2E；并行PlayerSearch修改使本轮typecheck未形成有效门槛；退回修复 |
| 2026-07-28 | `room.seriesResult` | `fix_stats_states` / sol low 最终复验 | 通过；J-096关闭，好友房系列终局态完成 | Rust room21项、Quick四人取消1项、前端75项、typecheck、Socket.IO E2E；接管/清房/重开补位/宽限重连 |

## 完成门槛

- 上述每一项均为 `[x]`，或有经过三次尝试仍无法解除的明确 `[-]` 阻塞。
- `user-journey-machine.test.ts` 证明所有全局状态可达、非法事件不会跳转。
- 每个发现的问题都有修复证据和独立复验。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。
- Rust 单元/集成测试与 Clippy 通过，Socket.IO 端到端重连测试通过。
