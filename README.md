# YearningX Frontend

YearningX Frontend 是 Yearning v4 的全新 Web 前端，面向数据库变更治理、SQL 预审、审批执行和查询访问场景。

本仓库独立维护前端源码和提交历史，并通过 Git Submodule 挂载到 YearningX 根仓库的 `frontend/` 目录。正式构建和发布必须使用 YearningX 锁定并验证过的前端 Commit，不得追踪浮动分支。

## 当前状态

项目处于工程基线阶段，应用脚手架将在 Frontend Work Package `FE-F1-SCAFFOLD` 中正式建立。当前仓库尚未提供可运行的安装、开发、测试或构建命令；在 `package.json` 和锁文件提交前，不应假设包管理器或命令名称。

## 已确定的技术方向

- React
- TypeScript
- Vite、Tailwind CSS v4、shadcn/ui 与 Base UI；非业务视觉采用冻结 Commit 的 Shadcn Dashboard 基线
- 基于共享 OpenAPI 契约生成或严格映射 API Client
- 基于 i18n 资源提供中文和英文界面
- 前端源码测试、组件测试、E2E、视觉回归和无障碍检查在本仓库执行

具体版本由 YearningX Release 和工具链契约冻结，不在 README 中使用“latest”形成不可复现依赖。

## 仓库边界

- 所有新版前端运行时代码、测试和静态资源只保存在本仓库。
- OpenAPI、状态机、错误码、权限、数据库及其他共享契约由 YearningX 根仓库维护，前端不得复制并形成第二套业务规则。
- 旧前端 [`cookieY/gemini-next`](https://github.com/cookieY/gemini-next) 只用于行为、交互和可复用资源参考，不得成为源码 Import、构建输入或运行时依赖。
- 前端不得绕过后端权限、Submission Gate、流程快照或状态机约束。
- 前端源码提交完成并通过本仓库门禁后，必须在 YearningX 更新 `frontend` Gitlink 并保存双仓库 Commit 证据。

## 产品与交互原则

- 保留 Yearning 熟悉的信息架构和数据库管理工具感。
- 使用 AI 增强 SQL 预审、Finding、Evidence 和建议流程，不做聊天壳。
- 用户提交工单前必须显式完成 AI 预审；打开或编辑草稿不得自动触发 AI。
- 界面文本遵守 i18n；选择中文时应尽量使用完整中文描述。
- 非业务视觉（布局、主题、色彩、间距、圆角、阴影和通用组件外观）继承冻结 Commit 的 Shadcn Dashboard 基线，通过 Tailwind CSS v4 语义变量和 shadcn Variant 统一管理，不为品牌感重建第二套主题。
- 全局页脚展示YearningX整体产品的AGPL-3.0许可声明；本前端独立仓库继续使用MIT许可证。

## 安全边界

- SQL、Evidence 明文、凭据、Token、标识符映射和解密内容不得写入 URL、Local Storage、Session Storage、日志或遥测。
- Reveal 必须由用户显式触发，使用动态水印和 `no-store`，并产生审计记录。
- 前端隐藏操作只改善体验，不能代替后端逐接口授权。
- 业务错误依据稳定数字 `err_code` 处理，不使用 HTTP 状态码表达业务结果。

## 开发入口

从 YearningX 根仓库开始工作，并先阅读：

1. `docs/ai-agent-development-prompt.md`
2. `docs/yearning-v4-product-contract.md`
3. `docs/frontend-react-implementation-prd.md`
4. `docs/frontend/yearning-ui-design-spec.md`
5. `docs/contracts/frontend-ui-migration-contract.md`
6. `docs/contracts/repository-topology-contract.md`
7. `docs/development/ai-work-package-runbook.md`
8. `api/contracts/ui-template-baseline.json` 及当前 Frontend Work Package、Requirement Matrix 和相关机器契约

不得在没有满足 Work Package 依赖、任务快照和路径边界检查的情况下开始实现。

## License

本前端独立仓库使用 [MIT License](./LICENSE)。YearningX整体产品及其他组成部分按各自仓库声明的许可证发布；前端MIT许可不替代YearningX产品界面的AGPL-3.0声明。
