# 企业服务与公司市场协议基线

本记录对应 T02。用户指定的源为 [Jas0nxlee/UWork_frontend](https://github.com/Jas0nxlee/UWork_frontend)，读取日期 2026-11-10，`main` 提交 `f6dda23d7e6f39aa66804933b60f893d38ab6914`。源码核对和匿名请求已执行；没有使用员工账号、创建 Key 或发送模型请求，不代表企业认证联调通过。

## 公开服务实测

| 请求 | 结果 | 固定样本与解释 |
|---|---|---|
| `GET https://pivot.ucas.com.cn:23090/api/auth/orgs` | HTTP 200 | [orgs.json](fixtures/public-services/orgs.json)；返回北京、南京、厦门、天津，`llm_base_url` 为公网 HTTPS；样本删除内网字段，客户端不使用该字段 |
| `GET https://aihub.ucas.com.cn/skillhub/.well-known/clawhub.json` | HTTP 200 | [discovery.json](fixtures/public-services/discovery.json)；`apiBase=/skillhub/api/v1`，按发现来源解析后同源 |
| `GET /skillhub/api/v1/skills?page=0&limit=2` | HTTP 200 | [skills.json](fixtures/public-services/skills.json)；`items` 含 slug、displayName、summary、latestVersion.version；`nextCursor="1"`，是下一页索引，不能误当技能数或假定固定 offset |
| `GET /skillhub/api/v1/skills/global/weather/resolve?version=1.0.0` | HTTP 200 | [weather-resolve.json](fixtures/public-services/weather-resolve.json)；响应包装为 `code/msg/data`，请求 ID 和时间已从样本删除 |
| `GET /skillhub/api/v1/skills/global/weather/versions/1.0.0/download` | HTTP 200 | ZIP 含 `LICENSE.txt`、`NOTICE.md`、`SKILL.md`；本轮只读下载和内存校验，没有安装或执行技能，也不把下载包提交到仓库 |

weather 版本响应中的 `downloadUrl` 为 `/api/v1/skills/global/weather/versions/1.0.0/download`，不带部署前缀 `/skillhub`。源 `apps/zcode-cli/packages/adapters/src/plugins/skillhub-package.ts` 的 `resolveSkillhubDownloadUrl` 已说明应用根相对路径语义。新适配器必须在已验证的 API 部署路径下解析并核对同源、技能和版本，不直接对 origin 拼接该值，也不接受任意跳转下载。

本轮对 ZIP 非目录文件按路径排序，逐文件 SHA-256 后拼成 `path:fileSha256` 加真实 LF，再计算 SHA-256，得到 `sha256:0f94e922d372c96950684af5fa48cccc91f7f374335f2be9acb53eabd7cf3dd0`，与 resolve 一致。这只验证该样本的内容一致性，不构成发布签名或技能安装验收。

匿名请求 `/api/keys`、`/api/usage`、`/api/usage/models`、`/api/usage/stats?period=7d&metric=requests` 均返回 HTTP 401 与包含 `error` 的 JSON；这验证未认证拒绝，尚不确定有效登录后的 403/429 或过期语义。

匿名 `GET /api/auth/authorize` 在北京 org_id 和源文档回调地址下返回 HTTP 200，内容是 `open.weixin.qq.com/connect/oauth2/authorize` 的 `snsapi_base` 链接，含微信网页应用 appid，不含原生 CorpApp 扫码需要的 agentId。未跟随链接或登录；不能把此 appid 当 CorpID，也不能据此补造桌面扫码配置。

## 企业协议来源与待固定样本

源 `packages/services/src/enterprise-identity/wecomIdentityAdapter.ts`、`packages/shared/src/wecom-identity-config.ts` 和 `packages/services/src/ucas-gateway/ucasGatewayClient.ts` 为解析依据；`docs/enterprise-identity-integration.md` 记录既有对接行为。当前只确认源码，以下带身份接口没有实调。

| 操作 | 请求与读取字段 | 目标行为与待验证项 |
|---|---|---|
| 扫码 | 逐组织 corpId、agentId、orgId、callbackUrl；state 为 orgId，callback 带唯一 `uwork_nonce` | 允许组织与精确回调的公开配置需来自发行输入；不同域名/端口不能互换；重复 code/state/nonce 与额外参数拒绝 |
| handoff | `POST /api/auth/handoff/start`，body `org_id`；返回 `handoff_id/handoff_secret`；claim body 使用两字段 | secret 仅在 Host 内存；202 等待；不把超时、5xx 或格式错误当作“不支持”；真实服务支持状态待验 |
| code 交换 | `POST /api/auth/login`，body `code/org_id`；返回 `token/user.id/user.org_id/user.name/needsEmailAuth?` | 严格绑定尝试、组织、代际和时限；`needsEmailAuth` 路径须服务端 refresh 认证；不能照搬源宽泛回退 |
| 恢复 | `POST /api/auth/refresh`，Bearer；返回 token/user | 同一 org/user；JWT exp 只用于调度，不能代替后端验证；401/403、网络和异常响应分开；两账号样本待验 |
| Key | `GET /api/keys` 的 `keys[].id/alias/masked_key/status`；reveal 返回 `key`；generate 返回 `id/key/masked_key/status?` | 复用 active Key；生成超时先重新查询；有效/失效/并发创建及未知结果样本待验 |
| 套餐与模型 | `GET /api/usage` 的 subscriptions；`GET /api/usage/models` 的 models/unrestricted/hasSubscription | 单位、周期、授权语义和实际模型能力待验；目标按撤权更新，不能照搬源只追加模型规则 |
| 统计 | `GET /api/usage/stats?period=7d\|month\|30d&metric=requests\|cost\|tokens`；强刷 `refresh=1` | summary/trend/models 字段见源解析器；successRate 源为 0–100；币种、时区、费用单位、限流及真实对账样本待验 |

源当前 Key 持久化和退出规则不等于迁移目标：目标仍按[方案](plan.md)使用 dsh credentials reference、受管 route、身份代际、settings revision 和崩溃恢复，不保留退出后仍可使用的旧企业路由。样本解析测试必须覆盖非法字段、错误组织、过期、重复消费与响应身份变化；尚未获得的真实响应不能标记为已确认。

## 发行资源核查

源 `.github/workflows/desktop-release.yml` 使用 `secrets.UWORK_ENTERPRISE_IDENTITY_CONFIG`，由 `scripts/desktop-enterprise-identity.ts stage` 写入随包公开配置，再 verify。仓库脚本和 secret 名可读不表示 secret 值已取得；当前环境状态未绑定凭证。公开组织接口仅有组织 ID、名字、slug 和网关地址，不能从它推导每家完整 CorpID/AgentID/精确回调白名单。

源 workflow 提供 `macos-15/arm64` 和 `windows-2022/x64` runner，但设置 `ZCODE_MAC_ADHOC_SIGN=1` 与 `CSC_IDENTITY_AUTO_DISCOVERY=false`。这不是本迁移所需 Developer ID、公证或 Windows 正式证书的证据；旧源签名说明文档也不代表当前 fork 已有签名身份。源工作流仍属于旧 runtime，不直接作为新 dsh 产物执行。

## T02 退出条件

匿名市场已有实际可下载版本与指纹证据。企微尚缺当前发行公开配置的实际输入、两账号真实扫码/恢复响应、受权网关与统计样本；发行尚缺新 runtime 在两平台上的签名安装验收。上述信息未出现在当前可读仓库和已绑定环境中，T02 保持未验收。后续可基于源解析器构造明确标记为合成的夹具继续开发，但合成测试不能替代真实服务结果。
