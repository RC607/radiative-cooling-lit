# Git 日常维护

## 仓库与分支

- 本地目录：`C:\Users\Mo_Xiaoran\Documents\deepseek-harness\default-workspace\rc-lit-portal`
- 远程：`git@github-rc607:RC607/radiative-cooling-lit.git`（SSH，使用 `~/.ssh/rc-lit-portal_ed25519`）
- 生产分支：`main`
- 每次 push 到 `main`，Cloudflare Pages 自动构建部署；不需要手动上传 `dist/`。

## 哪些文件该改，哪些不要手改

| 类型 | 路径 | 说明 |
| --- | --- | --- |
| 源数据 | `data/papers.json`、`data/imported.json` | 文献记录的唯一来源 |
| 分类 | `data/categories.json`、`data/classification-review.csv` | 分类定义与纠错表 |
| 代码 | `scripts/`、`src/` | 构建脚本、页面模板、前端 JS/CSS |
| 配置 | `public/_headers`、`.github/workflows/` | 安全头、自动更新工作流 |
| 生成物（提交） | `public/data/*.json`、`public/download/*` | 由 `npm run build` 生成，不要手改 |
| 生成物（忽略） | `dist/`、`.tmp/`、`node_modules/` | 不提交 |

原则：**只改源文件，生成物交给 `npm run build`**。提交前用 `git status` 看清楚。

## 每次开始前

```bash
cd "C:\Users\Mo_Xiaoran\Documents\deepseek-harness\default-workspace\rc-lit-portal"
git pull --rebase origin main
```

每天北京时间 02:00 左右，GitHub Actions 会自动提交新文献。先 pull 可以避免 push 被拒绝。

如果本地已有未提交修改：

```bash
git stash
git pull --rebase origin main
git stash pop
```

## 日常修改闭环

```bash
# 1. 改源文件（data/、scripts/、src/ 等）
# 2. 重新构建（会更新 public/data 与 public/download）
npm run build

# 3. 自检（断链、写操作、密钥、检索数据、sitemap）
npm run check

# 4. 本地预览
npm run preview        # http://127.0.0.1:4321/

# 5. 提交
git add -A
git commit -m "data: 新增 XXX 文献"   # 或 fix: / feat: / docs:
git push
```

push 后 Pages 会自动部署；到 GitHub Actions / Cloudflare Pages 看构建结果即可。

## 常见场景

### 1. 新增一篇文献

- 优先加到 `data/imported.json` 末尾，沿用现有字段；
- `id` 不能重复（自动同步使用 `RC-N-xxx`；手工可用下一个空号）；
- 必填：`id`、`category`、`sub`、`title_zh`、`title_en`、`authors`、`journal`、`year`、`published`、`type`；
- 建议补 `doi`、`keywords`、`abstract_zh`、`abstract_en`；
- 运行 `npm run build`，`loadCorpus` 会校验分类、必填字段与 DOI 去重。

### 2. 修正分类

```bash
# 1. 在 data/classification-review.csv 中改 type/category/sub 三列
npm run apply-classification
npm run build
npm run check
git add -A
git commit -m "data: 修正 XXX 的分类"
git push
```

### 3. 修改检索/页面/样式

```bash
# 改 src/assets/js/search.js 或 scripts/lib/pages.mjs 等
npm run build
npm run check
npm run preview
git add -A
git commit -m "feat: ..."
git push
```

资源 URL 带 `?v=3.2` 版本参数；修改 JS/CSS 后如果版本没变，浏览器可能缓存旧文件。改版本号的位置：

- `scripts/lib/html.mjs` 的 `SITE.version`
- `package.json` 的 `version`
- `docs/VERIFY.md` 中的缓存说明（可选）

### 4. 自动更新与本地提交冲突

如果 `git push` 提示被拒绝：

```bash
git pull --rebase origin main
```

- 冲突在 `data/imported.json`：手动合并，保留 Actions 新增的记录和你的修改；
- 冲突在 `public/data/` 或 `public/download/`：不要手工合并，先解决 `data/`，然后：
  ```bash
  npm run build
  git add public/data public/download
  git rebase --continue
  ```
- 冲突解决后必须重新 `npm run build && npm run check`，再 push。

### 5. 回滚

```bash
# 回滚某次提交（生成新提交，安全）
git revert <commit-hash>
git push

# 只恢复数据文件
git checkout <commit-hash> -- data/imported.json
npm run build
git add data/imported.json public/data public/download
git commit -m "revert: 恢复文献数据"
git push
```

不要对 `main` 使用 `git push --force`。

### 6. 实验性修改

```bash
git switch -c feature/search-tweak
# 修改、构建、提交
git push -u origin feature/search-tweak
```

Cloudflare Pages 会为分支生成预览部署；确认无误后在 GitHub 开 PR 合并到 `main`，合并后才更新生产站。

### 7. 打标签（里程碑）

```bash
git tag -a v3.2 -m "精确检索版本"
git push origin v3.2
```

## 提交信息建议

- `feat:` 新功能
- `fix:` 修复
- `data:` 文献数据/分类变更
- `docs:` 文档
- `chore:` 构建、依赖、缓存版本

## 推送前检查清单

```bash
git status                 # 只包含预期文件
git diff --stat            # 看一眼改动范围
git log --oneline -5       # 确认提交历史
npm run check              # 通过
```

- [ ] 没有提交 `.tmp/`、`dist/`、`node_modules/`
- [ ] 没有提交任何 Token / 密码 / `.env`
- [ ] `public/data` 与 `public/download` 是 `npm run build` 生成的
- [ ] `npm run check` 通过
- [ ] push 后 Pages 部署成功

## 出问题先看哪里

1. `git status`：是否有未提交/冲突文件；
2. `git log --oneline -10`：最近提交是否包含 Actions 的数据提交；
3. GitHub → Actions：每日更新是否失败；
4. Cloudflare Pages → Deployments：构建是否成功；
5. 本地 `npm run build` / `npm run check` 复现；
6. 详见 [`OPERATIONS.md`](OPERATIONS.md)。
