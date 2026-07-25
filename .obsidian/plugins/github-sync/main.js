const { Modal, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
const { existsSync } = require("fs");
const { dirname, resolve } = require("path");
const { spawn } = require("child_process");

const DEFAULT_SETTINGS = {
  scriptPath: ""
};

class SyncOutputModal extends Modal {
  onOpen() {
    this.titleEl.setText("同步到 GitHub");
    this.statusEl = this.contentEl.createDiv({ cls: "github-sync-status" });
    this.logEl = this.contentEl.createEl("pre", { cls: "github-sync-log" });
  }

  setStatus(message, type) {
    this.statusEl.setText(message);
    this.statusEl.dataset.status = type;
  }

  appendOutput(output) {
    this.logEl.textContent += output;
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  onClose() {
    this.contentEl.empty();
  }
}

class GitHubSyncSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("p", {
      text: "点击侧栏的 GitHub 图标或使用命令面板运行同步。"
    });

    new Setting(containerEl)
      .setName("同步脚本路径")
      .setDesc(`留空时自动使用：${this.plugin.getDefaultScriptPath()}`)
      .addText((text) =>
        text
          .setPlaceholder(this.plugin.getDefaultScriptPath())
          .setValue(this.plugin.settings.scriptPath)
          .onChange(async (value) => {
            this.plugin.settings.scriptPath = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}

module.exports = class GitHubSyncPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.isSyncing = false;

    this.statusBarItem = this.addStatusBarItem();
    this.setStatus("GitHub：就绪");

    this.addRibbonIcon("github", "同步到 GitHub", () => {
      void this.startSync();
    });

    this.addCommand({
      id: "sync-to-github",
      name: "同步到 GitHub",
      callback: () => {
        void this.startSync();
      }
    });

    this.addSettingTab(new GitHubSyncSettingTab(this.app, this));
  }

  onunload() {
    this.statusBarItem?.remove();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getDefaultScriptPath() {
    return resolve(this.app.vault.adapter.basePath, "..", "sync_to_github.command");
  }

  getScriptPath() {
    return this.settings.scriptPath || this.getDefaultScriptPath();
  }

  setStatus(message) {
    this.statusBarItem?.setText(message);
  }

  async startSync() {
    if (this.isSyncing) {
      new Notice("GitHub 同步正在进行中。");
      return;
    }

    const scriptPath = this.getScriptPath();
    const modal = new SyncOutputModal(this.app);
    modal.open();

    if (!existsSync(scriptPath)) {
      const message = `找不到同步脚本：${scriptPath}`;
      modal.setStatus(message, "error");
      new Notice(message);
      return;
    }

    this.isSyncing = true;
    this.setStatus("GitHub：同步中...");
    modal.setStatus("正在同步，请勿关闭 Obsidian。", "running");
    modal.appendOutput(`运行脚本：${scriptPath}\n\n`);

    try {
      await this.runScript(scriptPath, (output) => modal.appendOutput(output));
      this.setStatus("GitHub：已同步");
      modal.setStatus("同步完成。", "success");
      new Notice("GitHub 同步完成。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("GitHub：同步失败");
      modal.setStatus(`同步失败：${message}`, "error");
      new Notice("GitHub 同步失败，请查看日志。", 8000);
    } finally {
      this.isSyncing = false;
    }
  }

  runScript(scriptPath, onOutput) {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn("/bin/zsh", [scriptPath], {
        cwd: dirname(scriptPath),
        env: process.env
      });

      child.stdout.on("data", (chunk) => onOutput(chunk.toString()));
      child.stderr.on("data", (chunk) => onOutput(chunk.toString()));
      child.on("error", (error) => rejectPromise(error));
      child.on("close", (code, signal) => {
        if (code === 0) {
          resolvePromise();
          return;
        }

        rejectPromise(new Error(signal ? `脚本被 ${signal} 终止。` : `脚本退出码：${code}`));
      });
    });
  }
};
