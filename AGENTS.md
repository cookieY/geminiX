# YearningX Frontend Agent指令

本仓库是Yearning v4独立React前端，通过YearningX根仓库的`frontend/` Git Submodule锁定正式Commit。

开始正式开发前必须确认当前仓库位于完整YearningX工作区，并完整读取：

1. `../AGENTS.md`
2. `../docs/development/document-and-contract-map.md`
3. `../docs/yearning-v4-product-contract.md`
4. `../docs/frontend-react-implementation-prd.md`
5. `../docs/frontend/yearning-ui-design-spec.md`
6. `../docs/contracts/frontend-ui-migration-contract.md`
7. `../docs/contracts/repository-topology-contract.md`
8. `../docs/development/ai-work-package-runbook.md`
9. `../api/contracts/requirement-evidence-matrix.json`
10. `../api/development/work-packages.json`中的当前Frontend Package及相关机器契约

如果父目录中的YearningX权威文件不存在，只能检查本仓库，不得开始正式Work Package。旧前端参考仓库通过父仓库的`scripts/development/prepare_legacy_repositories.sh`发现或下载，禁止写死绝对路径或复制旧源码。

UI基线前置：开始任何前端UI实现前，必须读取`../docs/frontend/yearning-ui-design-spec.md`，安装并启用官方Shadcn Dashboard Agent Skill与上游最新`shadcndashboard-mcp`服务（不钉死版本，安装时记录实际解析来源与版本），验证`listBlocks`、`listComponents`、`searchBlocks`、`getBlockInstall`、`listInstalledBlocks`和`get_audit_checklist`六件工具；运行`../scripts/development/prepare_ui_reference_repository.sh`获取Shadcn Dashboard只读参考Checkout（首次下载取上游默认分支最新并冻结该Commit，冻结坐标以`../api/contracts/ui-template-baseline.json`为机器权威，脚本输出`YEARNING_UI_TEMPLATE_ROOT`，Checkout位于本仓库与YearningX工作树之外）。Skill、MCP缺失或模板Checkout校验失败时先补齐安装或记录阻塞，不得凭记忆猜测Block名称、安装命令或模板组件实现；Skill和MCP只用于开发理解与发现，不得进入CI、生产构建或运行时依赖。

实施规则：

- 一次只实施一个Frontend Work Package，只修改其允许路径。
- YearningX共享OpenAPI、状态、权限、错误码和机器契约为只读输入；需要变化时回到主仓库走Requirement Change Proposal。
- 不实现聊天壳，不引入旧`gemini-next`运行时，不在浏览器持久化SQL、Evidence、凭据、Token、映射或Reveal明文。
- React、TypeScript、Vite、Tailwind CSS v4、shadcn/ui、Base UI、i18n、生成Client和测试命令以当前工具链契约及脚手架为准；不引入Ant Design或第二套通用组件库。
- 非业务视觉（布局、主题、色彩、间距、圆角、阴影和通用组件外观）继承冻结Commit的Shadcn Dashboard基线，通过Tailwind CSS v4语义变量和shadcn Variant管理，不为品牌感重建第二套主题。
- 前端隐藏操作不能代替后端权限检查，页面不得复制另一套Submission Gate或状态机。
- 前端源码和测试先在本仓库提交，再由YearningX更新Gitlink并绑定两个仓库Commit证据。
- 未经用户明确授权不得commit或push；不得把未运行测试报告为通过。

标准操作序列：进入本仓库先查`git status`；处于detached HEAD时核对`git rev-parse main`等于YearningX Gitlink指向后`git checkout main`，禁止在detached HEAD上提交。新环境首次使用前必须配置本地`user.signingkey`（YearningX批准公钥串）与`gpg.ssh.allowedSignersFile`（指向YearningX的`api/development/allowed_signers`）——全局`.gitconfig`中的signingkey不是批准公钥。提交后以`git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile=<allowed_signers> verify-commit`输出`Good signature`为准；`%G?`对SSH签名不可靠。推送main后回YearningX更新Gitlink并附本仓库CI证据完成YearningX侧提交。

完成报告必须包含Requirement、用户可见结果、修改文件、测试与覆盖率、视觉和无障碍证据、未执行测试、风险和Frontend Commit。
