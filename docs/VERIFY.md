# 验证清单（步骤 5）

## 本地命令

```bash
npm ci
npm run build          # 静态页 + 检索数据
npm run preview        # http://127.0.0.1:4321/
npm run check          # 断链 / 写操作 / 密钥 / PDF / 安全头 / 检索数据 / sitemap
npm run update-data -- --dry-run
```

## 构建产物

| 指标 | 数值 |
| --- | --- |
| 文献 | 504 篇 |
| HTML 页面 | 679 |
| 产物文件 | 694 |
| 内部链接 | 65,061，0 断链 |
| 构建耗时 | 约 1–2 秒 |

## 压缩与缓存

Cloudflare Pages 会对 HTML/CSS/JS/JSON/SVG 自动使用 Brotli（不支持时回退 gzip）。本地预览也模拟了两种压缩：

| 文件 | 原始 | gzip | brotli |
| --- | --- | --- | --- |
| `literature.json` | 959 KB | 288 KB | 199 KB |
| `index.json` | 380 KB | 69 KB | 50 KB |
| `meta.json` | 82 KB | 16 KB | 13 KB |
| `citations.json` | 656 KB | 177 KB | 124 KB |
| `style.css` | 33 KB | 7 KB | 6 KB |
| `search.js` | 29 KB | 9 KB | 8 KB |

缓存策略（`public/_headers`）：

- `/assets/*`：7 天（URL 带 `?v=3.2` 版本参数，更新后自动破缓存）
- `/data/*`、`/download/*`：1 小时
- HTML：5 分钟

## 数据加载策略

- **检索**：首次加载 `/data/literature.json`（916 KB，Brotli 191 KB），在浏览器内精确匹配；后续查询毫秒级。
- **收藏夹**：只加载精简 `index.json`（363 KB，无摘要），不加载全量文献。
- **题录/导出**：`citations.json` 点击时才加载。
- **分片阈值**：文献超过 2,000 篇时，`build-data` 会自动生成 `literature.white/colored/transparent.json` 分片并写入 `manifest.json`。
- 当前 `public/data/manifest.json` 记录各文件用途与分片状态。

## 图片与 PDF

- 站内 `<img>` 数量：**0**；Logo 与 favicon 为内联 SVG，无额外请求。
- `dist/` 内 PDF 数量：**0**；不托管论文全文，详情页只提供 DOI / 出版方链接。
- `check.mjs` 会阻止把 PDF 放入公开站，并检查图片缺少 `alt` 或未设置 `loading="lazy"` 的情况。

## 安全与只读

`npm run check` 自动检查：

- 无 `/api`、无 POST 表单、无导入/同步/删除按钮；
- 无管理后台、登录页、`data-act` 写操作；
- 无 `api_key` / `token` / `secret` / Bearer 特征；
- 无外部脚本、外部图片、外部 `fetch`；
- 每页有 `lang`、title、description、canonical、viewport；
- 外链 `target="_blank"` 必须带 `rel="noopener"`；
- `_headers` 含 CSP，`robots.txt` 屏蔽 `/search/` 与 `/favorites/`。

结果：**0 个问题**。

## 404 / 移动端 / 性能

- 404：任意不存在的路径返回站内 404 页面，HTTP 404。
- 移动端：360 / 390 / 768 px 三档截图检查，无横向溢出；侧栏与筛选默认折叠。
- 性能（本地无网络延迟，headless Edge）：

| 页面 | 请求数 | 传输量 | 加载 |
| --- | --- | --- | --- |
| 首页 | 2 | 约 10 KB | 80 ms |
| 检索页（结构色） | 4 | 约 240 KB（检索数据 199 KB） | 约 220 ms |
| 检索耗时 | — | — | 1–5 ms |

线上经 Cloudflare CDN 后通常更快。

## 线上验证清单

部署完成后逐项检查：

1. `https://<域名>/` 首页正常，数据总量、三大方向、最新文献显示正确；
2. `https://<域名>/search/` 空查询显示 504 篇；
3. `https://<域名>/search/?q=结构色` 有结果，作者行显示；
4. `https://<域名>/search/?q=水泥` 只出现题名/摘要/关键词中完整包含“水泥”或英文等价词 cement / cementitious 的文献，不应只含“水”或“泥”；
5. `https://<域名>/search/?q=BaSO4` 有结果；关键词筛选 `结构色` 为 7 篇；
6. `https://<域名>/search/?cat=transparent` 为 25 篇；
7. 任一详情页 `/paper/RC-W-001/` 题录、DOI、收藏、题录弹窗正常；
8. 随机不存在路径返回 404 页面；
9. 移动端（DevTools 360 px）无横向滚动；
10. `curl -I https://<域名>/` 含 `content-security-policy`、`x-content-type-options`；
11. `curl -H 'Accept-Encoding: br' -I https://<域名>/data/literature.json` 含 `content-encoding: br`（Cloudflare 自动）；
12. `https://<域名>/sitemap.xml`、`robots.txt` 可访问；
13. GitHub Actions 的 **Update data** 手动运行一次，确认提交后 Pages 自动部署。
