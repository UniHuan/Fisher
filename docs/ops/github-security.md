# GitHub 仓库安全设置

本文记录公开仓库必须保持的 GitHub 设置。无法由代码自动验证的项目，由仓库管理员在合并前确认。

## 安全功能

| 功能                            | 路径                                | 目标状态                            |
| ------------------------------- | ----------------------------------- | ----------------------------------- |
| Private vulnerability reporting | Settings > Code security            | 开启                                |
| Secret scanning                 | Settings > Code security            | 开启                                |
| Push protection                 | Settings > Code security            | 开启                                |
| Dependabot alerts               | Settings > Code security            | 开启                                |
| Dependabot security updates     | Settings > Code security            | 开启                                |
| Code scanning                   | 使用 `.github/workflows/codeql.yml` | 保持 workflow，不启用 default setup |

`SECURITY.md` 的私密报告链接依赖 Private vulnerability reporting。开启后，未登录访问会跳转登录，登录后应能看到 Report a vulnerability。

## main 分支规则

在 Settings > Rules > Rulesets 新建分支规则：

- 目标分支：`main`
- 合并前必须创建 Pull Request
- 至少 1 人审批
- 新提交后撤销旧审批
- 所有评论必须解决
- 必须通过 `verify`、`integration`、`playwright`、`docker` 检查
- 禁止 force push
- 禁止删除分支
- 仅允许明确需要的仓库管理员绕过

## Actions

在 Settings > Actions > General 设置：

- Workflow permissions 选择只读仓库内容权限
- Fork pull request workflows 选择 Require approval for all outside collaborators
- 取消 Allow GitHub Actions to create and approve pull requests
- 公开仓库不使用 self-hosted runner 执行 fork PR
- 第三方 Action 固定到 commit SHA，由 Dependabot 更新

## Dependabot 策略

- npm 和 GitHub Actions 的 minor/patch 更新自动创建 PR。
- npm 主版本、Node 与 Nginx 基础镜像主版本不自动创建 PR，按发布计划人工处理。
- Dependabot alerts 仍然覆盖安全公告。严重漏洞需要人工评估是否提前升级。
- 主版本 PR 不开启 auto-merge，必须通过完整 CI 和人工验证。

## 验证命令

```bash
# 仓库公开状态和许可证识别
curl -s https://api.github.com/repos/UniHuan/Fisher \
  | jq '{private, visibility, license}'

# 分支规则集，应至少包含 main 规则
curl -s https://api.github.com/repos/UniHuan/Fisher/rulesets | jq .

# 最近的 CI 和 CodeQL 运行
curl -s 'https://api.github.com/repos/UniHuan/Fisher/actions/runs?per_page=10' \
  | jq '.workflow_runs[] | {name, event, status, conclusion, head_sha}'
```
