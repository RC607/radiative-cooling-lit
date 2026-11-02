# 部署到 Cloudflare Pages

本站是纯静态站点，Cloudflare Pages 免费层即可托管；与 GitHub 仓库连接后，每次 push（包括每日自动更新工作流的提交）都会自动构建并发布。

## 0. 前置条件

- 代码已推送到 GitHub（默认分支 `main`）；
- 有一个 Cloudflare 账号（免费）；
- 仓库根目录就是本站项目根目录（含 `package.json`、`scripts/`、`data/`）。

## 1. 连接 GitHub 仓库

1. 登录 <https://dash.cloudflare.com/>；
2. 左侧 **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**；
3. 选择 **GitHub**，授权 Cloudflare 访问该仓库；
4. 选中 `rc-lit-portal` 仓库 → **Begin setup**。

## 2. 项目与构建配置

| 配置项 | 填写值 |
| --- | --- |
| Project name | `rc-lit-portal`（决定默认域名 `rc-lit-portal.pages.dev`） |
| Production branch | `main` |
| Framework preset | **None** |
| Root directory | `/`（仓库根目录） |
| Build command | `npm run build` |
| Build output directory | `dist` |

构建过程：`npm install/ci` → 生成静态页 → Pagefind 索引 → 输出 `dist/`。首次构建约 1–2 分钟（依赖安装占大部分）。

## 3. 环境变量

在 **Environment variables (advanced)** 中添加（Production 与 Preview 都建议加）：

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `NODE_VERSION` | `20` | 与 `.nvmrc` 一致；Pagefind 需要 Node 18+ |
| `SITE_URL` | `https://rc-lit-portal.pages.dev` | 用于 canonical、og:url、sitemap；绑定自定义域名后改成正式域名 |

注意事项：

- Pagefind 已放在 `dependencies`，即使构建环境省略 devDependencies 也能安装；仍建议**不要**设置 `NODE_ENV=production`；
- 不需要在该项目里放任何 API Key / Token；OpenAlex 的更新只在 GitHub Actions 中运行；
- `SITE_URL` 只参与构建，不会作为密钥暴露。

## 4. 首次部署

点击 **Save and Deploy**，等待构建完成，访问 `https://rc-lit-portal.pages.dev`。

验证：

- 首页、`/search/`、任一文献详情页可打开；
- `/search/?q=结构色` 有结果（说明 Pagefind 索引已生成）；
- 任意不存在的路径返回站内 404；
- `_headers` 生效（可查看响应头里的 CSP）。

## 5. 自定义域名（可选）

1. Pages 项目 → **Custom domains** → **Set up a domain**；
2. 输入域名（如 `lit.example.com` 或根域名 `example.com`）；
3. 域名托管在 Cloudflare：自动创建 CNAME 并签发 SSL；托管在外部：按提示在 DNS 添加 CNAME；
4. 生效后回到 Pages → Settings → Environment variables，把 `SITE_URL` 改成正式域名；
5. 重新部署一次（Deployments → Retry deployment，或推送一个空提交），让 canonical / sitemap 更新。

建议同时把 `*.pages.dev` 301 到正式域名（Cloudflare Redirect Rules 或 Bulk Redirects），避免重复收录。

## 6. 自动部署

- 推送到 `main` → 自动生产部署；
- 推送其他分支 / PR → 预览部署（不影响生产）；
- 每日更新工作流提交数据后 → 自动触发生产部署；
- 无需在 GitHub Actions 里配置 Cloudflare Token。

## 7. 免费层额度（当前官方限制）

| 项目 | Free 额度 | 本站情况 |
| --- | --- | --- |
| 构建次数 | 500 次/月 | 每天 1 次 ≈ 30 次/月 |
| 并发构建 | 1 | 足够 |
| 构建超时 | 20 分钟 | 本站约 1–2 分钟 |
| 站点文件数 | 20,000 | 约 1,200 个（含 Pagefind） |
| 单文件大小 | 25 MiB | 最大约 0.9 MB |
| 自定义域名 | 100 个/项目 | 1 个 |
| 静态请求 / 带宽 | 静态资源不按请求数计费 | 日访问 5,000 次无压力 |
| 预览部署 | 不限数量 | 可选 |

参考：<https://developers.cloudflare.com/pages/platform/limits/>

## 8. 回滚

- **整站回滚**：Pages 项目 → Deployments → 选择上一个成功部署 → **Rollback to this deployment**；
- **数据回滚**：`git revert <commit>` 后 push，Actions 会重建并部署；
- **只回滚数据**：恢复 `data/imported.json` 到上一版本，重新构建。

## 9. 常见构建失败

| 现象 | 排查 |
| --- | --- |
| 构建时找不到 `pagefind` | 确认 `package-lock.json` 已提交；Pagefind 在 `dependencies` 中，`npm ci` 应安装 |
| `npm ci` 报 lockfile 不同步 | 本地 `npm install` 后提交新的 `package-lock.json` |
| 构建成功但搜索无结果 | 检查构建日志是否有 Pagefind 步骤；确认 `/pagefind/pagefind.js` 可访问 |
| canonical / sitemap 指向 `*.pages.dev` 随机域名 | 设置 `SITE_URL` 并重新部署 |
| 404 页面不生效 | 确认 `dist/404.html` 存在（构建自动生成） |
| 构建超时 | 检查是否误把 `dist/` 或大文件提交进仓库 |
