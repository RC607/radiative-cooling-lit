# 辐射制冷文献检索系统 · 公开只读站

面向辐射制冷（白色 / 彩色 / 透明）的文献检索站：构建时生成静态页面 + 纯前端检索，
部署在 Cloudflare Pages 免费层，访客不需要维护者电脑开机。

- **分类**：三大方向（白色 6 细分、彩色 5 细分、透明 2 细分）+ 两类文献（研究型论文 / 综述）。
- **只读**：没有任何管理后台、导入接口或写操作；站点由维护者在本地 / GitHub Actions 更新。
- **静态**：全部页面与数据是构建产物，无服务端、无数据库、无第三方 API。
- **自动更新**：GitHub Actions 每日定时拉取新文献 → 重建 → 部署。
- **检索**：Pagefind 构建期全文索引，纯前端检索，不请求外部 API。

## 快速开始

```bash
npm install        # 安装 Pagefind（构建期生成检索索引）
npm run build      # 校验数据 → 生成 dist/ → 生成 Pagefind 索引
npm run preview    # http://127.0.0.1:4321/
npm run check      # 断链 / 写操作残留 / 密钥特征 / Pagefind / sitemap 自检
```

构建前可设置 `SITE_URL`（如 `https://your-domain.com`），用于生成 canonical、og:url 与 sitemap；
未设置时回退到 Cloudflare 提供的部署地址。

## 目录

```
data/                        源数据（唯一数据入口，Git 中可审阅）
  papers.json                人工整理的内置库
  imported.json              网络同步 / 人工收录的文献
  categories.json            三大方向 13 细分 + 两类文献的定义
  sync-state.json            上次同步时间、新增数量与错误（自动生成）
  classification-review.csv  历史迁移的逐条复核表（可编辑）
  classification-report.json 迁移统计与低置信度清单
scripts/
  lib/classify.mjs           分类器（颜色方向 + 细分 + 研究/综述）
  lib/openalex.mjs           OpenAlex 请求与辐射制冷主题过滤
  lib/corpus.mjs             读取、校验、去重、派生字段、统计
  lib/biblio.mjs             GB/T 7714 / BibTeX / RIS 题录
  lib/html.mjs               页面外壳、侧栏、卡片、分页
  lib/pages.mjs              各页面渲染
  build-data.mjs             导出 public/data/*.json 与下载文件
  build.mjs                  生成 dist/（页面、资源、sitemap、robots、Pagefind 索引）
  update-data.mjs            从 OpenAlex 增量更新 imported.json
  serve.mjs                  本地静态预览
  check.mjs                  构建产物自检
  migrate-taxonomy.mjs       一次性分类迁移（已完成）
  apply-classification-csv.mjs 把人工修订的复核表写回数据
.github/workflows/update-and-deploy.yml  每日定时更新、构建、提交
src/assets/                  样式、前端 JS、图标（构建时复制到 dist/assets）
public/                      原样发布：_headers、data/*.json、download/*
dist/                        构建产物（已 gitignore）
```

## 分类维护

历史 484 篇由规则迁移，逐条结果见 `data/classification-review.csv`（含置信度与判定依据）。
如需修正：

1. 用 Excel 打开 `data/classification-review.csv`，只改 `type`、`category`、`sub` 三列（填中文名）；
2. 运行 `npm run apply-classification`；
3. 运行 `npm run build`。

可选值：

- `type`：研究型论文 / 综述
- `category`：白色辐射制冷 / 彩色辐射制冷 / 透明辐射制冷
- `sub`：见 `data/categories.json`（如 纯无机辐射制冷、有机无机杂糅辐射制冷、结构色、吸收色、发光色、透明辐射制冷薄膜……）

## 数据流

```
data/*.json ──loadCorpus()──> 校验/去重/派生 ──┬──> 静态页面（dist/**/index.html）
                                             ├──> public/data/literature.json（全量）
                                             ├──> public/data/index.json（检索轻量索引）
                                             ├──> public/data/citations.json（按需加载）
                                             ├──> public/download/*.bib|ris
                                             └──> dist/pagefind/（Pagefind 检索索引）
```

`data/` 是唯一事实来源；`public/data/` 是导出产物，构建时重新生成，不应手工编辑。

## 检索索引

`npm run build` 的最后一步会调用 Pagefind，对 `dist/paper/*/index.html` 建立全文索引，输出到 `dist/pagefind/`：

- 只索引文献详情页（当前库全部文献），分类页、列表页、检索页不进入索引；
- 中文按分词索引、英文按词索引；`6` 个筛选维度（方向、细分、类型、年份、期刊、关键词）和 `1` 个排序键（发表时间）；
- 检索页只请求本地 `data/meta.json` 与 `/pagefind/*`，不访问任何外部 API；
- 调试静态页面时可加 `--no-pagefind` 跳过索引（此时 `npm run check` 会提示缺少索引）。

Pagefind 作为 `dependencies` 安装，Cloudflare Pages 构建时会自动安装。

## 自动更新

`.github/workflows/update-and-deploy.yml` 每天 UTC 18:00（北京时间 02:00）运行，也支持手动 `workflow_dispatch`：

1. `npm ci`
2. `npm run update-data`：从 OpenAlex 拉取最近 60 天的辐射制冷文献，过滤、去重、分类，写入 `data/imported.json`
3. `npm run build` + `npm run check`
4. 有变化则提交 `data/`、`public/data/`、`public/download/` 并 push

Cloudflare Pages 与仓库连接后，push 会自动触发 Pages 构建，不需要额外的部署步骤。

**Secrets（可选）**：在 GitHub → Settings → Secrets and variables → Actions 中添加

| Secret | 用途 |
| --- | --- |
| `OPENALEX_API_KEY` | 提高 OpenAlex 配额（不填也能运行） |
| `OPENALEX_MAILTO` | OpenAlex polite pool 联系邮箱（可选） |

Secrets 只在更新步骤读取，不会进入构建产物或前端。

本地调试：

```bash
npm run update-data -- --dry-run          # 只打印候选，不写文件
npm run update-data -- --window-days 30   # 缩短回溯窗口
```

更新脚本的安全策略：先合并到临时目录并用 `loadCorpus` 校验，校验通过才原子写回；任一数据源失败不影响已有数据；所有数据源都失败时退出码为 1，工作流停止且不提交。

## 本地预览

```bash
npm run preview          # 默认 4321 端口
node scripts/serve.mjs 8080
```

预览服务器模拟 Cloudflare Pages 的目录索引与 404 行为。

## 部署

Cloudflare Pages 连接本仓库，详细步骤见 [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md)。

| 配置项 | 值 |
| --- | --- |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 根目录 | `/` |
| Node 版本 | `20`（环境变量 `NODE_VERSION`） |
| 环境变量 | `SITE_URL`（正式域名，用于 canonical / sitemap）；不要设 `NODE_ENV=production` |
| 前端密钥 | 无 |

免费层：500 次构建/月、20,000 个文件、单文件 25 MiB、100 个自定义域名；静态请求与带宽不按请求数计费。
每日 1 次自动提交 ≈ 30 次构建/月，远低于配额。

自定义域名在 Pages → Custom domains 绑定；绑定后把 `SITE_URL` 改为正式域名并重新部署。

## 安全

- 前端不包含任何 API Key / Token；数据更新只在 GitHub Actions 或本地执行。
- 无管理入口、无写接口；`/api/*` 不存在。
- `public/_headers` 提供 CSP、nosniff、Referrer-Policy 等安全响应头。
- 收藏夹仅写入访客本机 `localStorage`。

## 文档

- [Cloudflare Pages 部署](docs/DEPLOY-CLOUDFLARE.md)
- [验证清单与性能数据](docs/VERIFY.md)
- [运维、回滚与故障排查](docs/OPERATIONS.md)
