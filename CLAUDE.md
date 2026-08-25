# YearningX Frontend Claude Code指令

本仓库是Yearning v4的独立React前端仓库，通过YearningX根仓库的`frontend/` Git Submodule锁定正式Commit。

## 工作入口

Frontend Work Package必须从已初始化本Submodule的YearningX工作区开始。开始任务前先确认父目录存在：

```text
../CLAUDE.md
../api/development/work-packages.json
../docs/frontend-react-implementation-prd.md
```

如果这些文件不存在，说明当前仓库不是处于可验证的YearningX工作区。此时只能检查前端仓库自身状态，不得根据记忆或远端浮动分支开始正式Work Package。

必须先完整读取：

1. `../CLAUDE.md`
2. `../docs/development/document-and-contract-map.md`
3. `../docs/yearning-v4-product-contract.md`
4. `../docs/frontend-react-implementation-prd.md`
5. `../docs/frontend/yearning-ui-design-spec.md`
6. `../docs/contracts/frontend-ui-migration-contract.md`
7. `../docs/contracts/repository-topology-contract.md`
8. `../docs/development/ai-work-package-runbook.md`
9. `../api/contracts/requirement-evidence-matrix.json`
10. `../api/development/work-packages.json`中的当前Frontend Package及相关机器契约

旧前端参考仓库必须通过父仓库的`scripts/development/prepare_legacy_repositories.sh`发现或下载，不得写死开发者机器绝对路径，也不得把旧`gemini-next`复制进本仓库。

## 实施边界

- 只实施当前Frontend Work Package，不提前开始后续Package。
- 只修改当前Package允许的前端路径；YearningX共享OpenAPI、状态、权限和错误码是只读输入。
- 共享契约需要变化时，回到YearningX按Requirement Change Proposal流程处理，不在前端仓库复制第二套规则。
- 技术栈、版本、包管理器、生成命令和质量门禁必须以YearningX工具链契约及`FE-F1-SCAFFOLD`落盘结果为准，不凭README假设。
- AI能力嵌入预审、Finding和Evidence工作流，不实现聊天壳。
- SQL、Evidence明文、凭据、Token、映射和Reveal内容不得进入URL、浏览器持久存储、日志或遥测。
- i18n、权限能力、数字业务错误码和状态枚举必须来自共享契约或确定性生成结果。
- 隐藏按钮不能代替后端授权。
- 不允许运行时依赖旧`gemini-next`。

## Git与证据

- 前端源码、测试和源码级证据先在本仓库完成并提交。
- 未经用户明确授权不得commit或push。
- 前端Commit完成后，由YearningX更新`frontend` Gitlink并生成绑定两个仓库Commit的Manifest。
- 不能只更新Gitlink而宣称Frontend Work Package完成。
- 不得从YearningX根仓库直接伪造`frontend/src/**`变更路径或前端测试证据。

完成时必须报告Requirement、用户可见结果、修改文件、测试、覆盖率、视觉与无障碍证据、未执行测试、风险和Frontend Commit。
