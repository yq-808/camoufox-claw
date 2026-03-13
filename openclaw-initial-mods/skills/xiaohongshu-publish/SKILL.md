---
name: xiaohongshu-publish
description: 小红书发布与编辑 - 浏览器自动化发布图文笔记，支持图片上传、标题编辑、正文全量重写。
author: 空间龙虾
version: 1.1.0
---

# 小红书发布 📝

用于发布新笔记和编辑已有笔记。

## 前置条件

- 浏览器已启动并运行
- 用户已登录小红书创作平台
- 已准备好图片文件路径
- 网络连接正常

---

## 核心规则（正文编辑）

- 正文只能使用 `run_code` 输入。
- 每次编辑正文必须先全选清空，再全量重写。
- 换行只能用真实 Enter：`page.keyboard.press('Enter')`。
- 禁止使用 `fill`、`type`、`\n`、`\r\n` 处理正文。

---

## 正文模板（统一使用）

```text
run_code:
async (page) => {
  const lines = [
    "第一段内容",
    "第二段内容",
    "第三段内容",
  ];
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  for (let i = 0; i < lines.length; i++) {
    await page.keyboard.type(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
}
```

---

## 功能 1：发布图文笔记

1. `navigate: https://creator.xiaohongshu.com/publish/publish?type=image`
2. `click: "上传图文"`
3. `click: "上传图片"` + `file_upload: /path/to/image.jpg`
4. `type: 标题输入框 "你的标题"`
5. 按“正文模板（统一使用）”执行 `run_code`
6. `click: "发布"`，再 `wait_for: 发布成功提示`

---

## 功能 2：编辑已发布笔记

1. `navigate: https://creator.xiaohongshu.com/creator/post`
2. `click: 目标笔记 "编辑"`
3. 按“正文模板（统一使用）”执行 `run_code`
4. `click: "更新"`（或页面实际按钮文案），再 `wait_for: 更新成功提示`

---

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| 编辑后内容错乱 | 做了局部增量修改 | 回到正文模板，先清空再全量重写 |
| 正文仍是一段 | 使用了 `fill/type/\n` | 只用 `run_code + Enter` |
| 更新未生效 | 未点更新或未等待成功提示 | 点击更新后等待成功提示再离开 |

---

*Created by 空间龙虾 🦞*
*Version: 1.1.0*
