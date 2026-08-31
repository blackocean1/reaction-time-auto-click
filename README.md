# Human Benchmark 反应时间自动点击

这是一个 Tampermonkey 用户脚本，用于在 Human Benchmark 反应时间测试中自动完成 5 轮：点击“开始”后，脚本会在测试区域进入绿色状态时自动触发点击，并在每轮结果后开始下一轮。

自动生成的成绩不代表真实的人类反应时间，可能被网站判定为无效；不要使用它提交排行榜成绩。

## 安装

1. 在浏览器安装 Tampermonkey。
2. 新建一个用户脚本。
3. 打开本目录中的 `reaction-time-auto-click.user.js`，复制全部内容到 Tampermonkey 编辑器中并保存。
4. 打开 [Human Benchmark 反应时间测试](https://humanbenchmark.me/zh/tests/reactiontime)。
5. 点击页面右上角面板的“开始”。脚本会自动完成 5 轮。

## EXE 运行

`dist/reaction-time-auto-click.exe` 是可直接双击运行的 Windows 程序。它内置 Node.js、Playwright 运行文件和用户脚本，但不会内置浏览器；目标电脑需要安装 Microsoft Edge，不需要安装 Node.js 或 Tampermonkey。

双击 EXE 后，程序会以铺满屏幕的最大化窗口打开 Edge 和测试页面，自动点击“开始”并完成 5 轮。窗口保留标题栏和边框，可以恢复、拖动或自由放大缩小；页面会跟随窗口尺寸变化。最终结果显示后，关闭 Edge 窗口即可退出程序。

如需诊断环境，可在 PowerShell 中运行：

```powershell
dist\reaction-time-auto-click.exe --check
```

`--headless` 仅用于开发验证，会在完成 5 轮后自动退出：

```powershell
dist\reaction-time-auto-click.exe --headless
```

## 停止

点击面板的“停止”，或在页面按 `Esc`，即可立即停止自动操作。

## 验证

```powershell
npm install
npm test
node --check reaction-time-auto-click.user.js
npm run build:exe
```

构建产物为 `dist\reaction-time-auto-click.exe`。构建使用 Node.js SEA 将 Playwright 运行文件和用户脚本嵌入 EXE，不会下载或打包 Chromium。

脚本依赖页面当前的 `.game-container`、`.state-ready` 和 `.round-counter` 等 DOM 类名。网站页面结构改变后，可能需要同步更新脚本。
