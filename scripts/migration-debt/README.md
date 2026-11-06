# `migration-debt` = 组件迁移欠账，**不是数据库迁移**

这里的 JSON 是**平台 UI 组件的迁移欠账清单**（`tooltip` / `popover` / `tabs` / `modal` 等）：
每条记录「哪个文件还在用旧写法、挂在哪条台账行上」。组件守卫读它们，两边数字必须相等。

- 与 SQLite 无关。查数据库迁移请去 `products/market-intelligence/.../daily-briefing/` 与各 store 的
  `user_version` 逻辑，规范见 `docs-private/10-development/storage-sqlite-standard.md`。
- **不改名**（虽然名字确实容易被误读）：守卫按这个路径读、台账里多处引用它；改名换不来收益，
  只会留下一批指向旧路径的记录。改的是读者的第一印象——就是这份 README。
- 只减不增；修掉一处必须同笔删掉对应行；过期条目同样要红（口径见 `MI-11-R154`）。
