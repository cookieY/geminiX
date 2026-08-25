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

实施规则：

- 一次只实施一个Frontend Work Package，只修改其允许路径。
- YearningX共享OpenAPI、状态、权限、错误码和机器契约为只读输入；需要变化时回到主仓库走Requirement Change Proposal。
- 不实现聊天壳，不引入旧`gemini-next`运行时，不在浏览器持久化SQL、Evidence、凭据、Token、映射或Reveal明文。
- React、TypeScript、Ant Design、i18n、生成Client和测试命令以当前工具链契约及脚手架为准。
- 前端隐藏操作不能代替后端权限检查，页面不得复制另一套Submission Gate或状态机。
- 前端源码和测试先在本仓库提交，再由YearningX更新Gitlink并绑定两个仓库Commit证据。
- 未经用户明确授权不得commit或push；不得把未运行测试报告为通过。

完成报告必须包含Requirement、用户可见结果、修改文件、测试与覆盖率、视觉和无障碍证据、未执行测试、风险和Frontend Commit。
