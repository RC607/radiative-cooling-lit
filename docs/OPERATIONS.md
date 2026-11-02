# 运维与交付（步骤 6）

## 最终目录结构

```
rc-lit-portal/
├─ .github/workflows/update-and-deploy.yml   每日更新 + 构建 + 提交
├─ data/                                     源数据（唯一事实来源）
│  ├─ papers.json                            人工整理的内置库（48 篇）
│  ├─ imported.json                          网络收录与自动同步（436 篇起）
│  ├─ categories.json                        三大方向 13 细分 + 两类文献
│  ├─ classification-review.csv              分类复核表（484 行）
│  ├─ classification-report.json             分类统计与低置信清单
│  └─ sync-state.json                        首次更新后生成
├─ docs/
│  ├─ DEPLOY-CLOUDFLARE.md                   Cloudflare Pages 部署步骤
│  ├─ VERIFY.md                              验证清单与性能数据
│  └─ OPERATIONS.md                          本文件
├─ public/
│  ├─ _headers                               CSP / 缓存 / 安全头
│  ├─ data/                                  literature/index/meta/citations/manifest
│  └─ download/                              全库 BibTeX / RIS / GB/T
├─ scripts/
│  ├─ build.mjs                              静态页与检索数据
│  ├─ build-data.mjs                         导出 JSON、题录、manifest
│  ├─ update-data.mjs                        OpenAlex 增量更新
│  ├─ check.mjs                              构建产物自检
│  ├─ serve.mjs                              本地预览（含 Brotli/gzip）
│  ├─ migrate-taxonomy.mjs                   一次性分类迁移
│  ├─ apply-classification-csv.mjs           CSV 纠错回写
│  └─ lib/                                   corpus / classify / biblio / html / pages / openalex
├─ src/assets/                               样式、前端 JS、favicon
├─ dist/                                     构建产物（gitignore）
├─ package.json / package-lock.json
├─ .nvmrc / .gitignore / .gitattributes
└─ README.md
```

## 需要手动完成的 GitHub 步骤

1. 在 GitHub 新建仓库（如 `radiative-cooling-lit`），不要初始化 README。
2. 本地提交并推送：
   ```bash
   cd rc-lit-portal
   git config user.name "你的名字"
   git config user.email "你的邮箱"
   git commit -m "feat: static literature portal"
   git remote add origin https://github.com/<你>/rc-lit-portal.git
   git push -u origin main
   ```
3. 仓库 → Settings → Actions → General：允许 Actions 运行。
4. 可选 Secrets（Settings → Secrets and variables → Actions）：
   - `OPENALEX_API_KEY`
   - `OPENALEX_MAILTO`
5. Actions → **Update data** → Run workflow，先手动跑一次，确认能提交。
6. 可选：Settings → Branches → 为 `main` 开启保护，但允许 GitHub Actions 推送（否则工作流无法 commit）。

## 需要手动完成的 Cloudflare 步骤

详见 [`DEPLOY-CLOUDFLARE.md`](DEPLOY-CLOUDFLARE.md)，要点：

1. Workers & Pages → Create → Pages → Connect to Git → 选仓库；
2. 项目名 `radiative-cooling-lit`，生产分支 `main`；
3. Framework preset = None；构建命令 `npm run build`；输出目录 `dist`；根目录 `/`；
4. 环境变量：`NODE_VERSION=20`、`SITE_URL=https://radiative-cooling-lit.pages.dev`；
5. Deploy，验证首页 / 检索 / 404；
6. 绑定自定义域名后，把 `SITE_URL` 改为正式域名并重新部署。

## 回滚方法

### 1. 整站回滚（最快）

Cloudflare Pages → 项目 → **Deployments** → 选上一个成功部署 → **Rollback to this deployment**。

### 2. 数据回滚

```bash
git log --oneline data/imported.json
git revert <commit>
git push
```

推送后 Actions 会重新校验/构建，Pages 自动部署上一版数据。

### 3. 只恢复某几条文献

从历史版本取回 `data/imported.json` 中对应记录，或删除新增的 `RC-N-xxx` 记录后重新构建。更新脚本只追加、不修改旧记录，因此回滚通常只需撤销最近一次数据提交。

### 4. 分类回滚

`data/classification-review.csv` 是迁移时的快照；改错分类时把 `type/category/sub` 改回并运行 `npm run apply-classification`。

## 常见失败排查

### Actions 失败

| 现象 | 原因 / 处理 |
| --- | --- |
| `update-data` 退出码 1 | 所有 OpenAlex 请求失败。查看日志中的 HTTP 状态；稍后手动重跑。失败时不会改动数据 |
| `git push` 被拒绝 | 分支保护未允许 Actions，或权限不是 `contents: write` |
| `npm ci` 报 lockfile 不同步 | 本地 `npm install` 后提交新的 `package-lock.json` |
| `npm run build` 失败 | 看日志中的 Node/数据错误；本地复现 `npm run build` |
| `npm run check` 失败 | 按输出修复断链、缺失检索数据或安全项；失败时不会提交 |
| 定时任务没触发 | GitHub 的 schedule 可能延迟；用 workflow_dispatch 手动跑。确认在默认分支上 |

### Cloudflare 构建失败

| 现象 | 处理 |
| --- | --- |
| 构建超时 | 检查是否误提交 `dist/`、`node_modules/` 或大文件 |
| 文件数超限 | 免费层 20,000 文件；当前约 694 |
| 构建成功但页面旧 | 检查是否推送到生产分支；Pages 只部署生产分支到主域名 |
| canonical 指向随机 `*.pages.dev` | 设置 `SITE_URL` 并重新部署 |

### 搜索无结果 / 不精确

1. 直接访问 `https://<域名>/data/literature.json`，确认返回 JSON 且包含文献；
2. 浏览器控制台是否有 `search.js` 或数据加载错误；
3. 强刷页面（`assets` 缓存 7 天；本站已用 `?v=3.1` 版本参数破缓存，若仍旧可 Ctrl+F5）；
4. 确认搜索词是**完整子串**：`水泥` 只匹配包含“水泥”的记录，不再拆分“水/泥”；
5. 多词为 AND：`水泥 涂料` 需要两个词都出现；去掉一个词可扩大结果；
6. 若某篇新文献搜不到，确认它已进入 `/data/literature.json` 且 `dist/paper/<id>/` 存在。

### 数据未更新

1. Actions 最近一次运行是否成功、是否产生 commit；
2. commit 是否推到 `main`；
3. Cloudflare Pages 是否已连接仓库并触发部署；
4. `data/sync-state.json` 的 `last_run` / `last_new`；
5. 回溯窗口内确实没有新文献（可手动 `workflow_dispatch` 把 `window_days` 调大）；
6. 新记录是否因 DOI/题名重复被跳过（看 Actions 日志的候选数）；
7. 站点是否被 CDN/浏览器缓存（HTML 5 分钟）。

### 404 页面不生效

确认 `dist/404.html` 存在；Cloudflare Pages 会自动使用它。若使用自定义域名，确认没有额外的重写规则覆盖。

## 日常维护

- 每月看一次 Actions 运行结果与 `data/sync-state.json`；
- 新增文献的分类是否正确：抽查 `data/imported.json` 末尾或页面详情；
- 分类纠错：编辑 `data/classification-review.csv` → `npm run apply-classification` → `npm run build`；
- 更新依赖：`npm update` 后本地构建验证，再提交；
- 备份：`data/` 在 Git 历史中即可回溯；重要节点打 tag。
