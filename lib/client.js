window.__ModuleLoader__.load({
	id: "dsh-audiogen",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_dom_client = require("react-dom/client");
		let react = require("react");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/protocol.ts
		/** Same-origin route family (loopback-only, mirroring dsh-imagegen). */
		const SETTINGS_API = {
			describe: "/api/dsh-audiogen/settings/describe",
			mutate: "/api/dsh-audiogen/settings/mutate"
		};
		/** The audio-generation proxy route. */
		const GENERATE_API = "/api/dsh-audiogen/generate";
		/** Host-mediated built-in provider catalog (channels the user can instantiate). */
		const PRESETS_API = "/api/dsh-audiogen/presets";
		/** Host-mediated model/voice discovery endpoint. */
		const MODEL_API = { discover: "/api/dsh-audiogen/models/discover" };
		/** Host-persisted generation history routes. */
		const HISTORY_API = {
			list: "/api/dsh-audiogen/history/list",
			append: "/api/dsh-audiogen/history/append",
			remove: "/api/dsh-audiogen/history/remove",
			clear: "/api/dsh-audiogen/history/clear",
			audio: "/api/dsh-audiogen/history/audio"
		};
		//#endregion
		//#region src/client/api.ts
		/**
		* Browser-side API client for the audio generation and history routes.
		*/
		var AudiogenApi = class {
			async generate(request) {
				return await (await fetch(GENERATE_API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(request)
				})).json();
			}
			async history() {
				const body = await (await fetch(HISTORY_API.list, { method: "POST" })).json();
				return body.ok === true ? body.history ?? [] : [];
			}
			async clearHistory() {
				await fetch(HISTORY_API.clear, { method: "POST" });
			}
		};
		//#endregion
		//#region src/client/controller.ts
		var AudioGenController = class {
			panelOpen = false;
			listeners = /* @__PURE__ */ new Set();
			getSnapshot() {
				return { panelOpen: this.panelOpen };
			}
			subscribe(fn) {
				this.listeners.add(fn);
				return () => {
					this.listeners.delete(fn);
				};
			}
			open() {
				if (this.panelOpen) return;
				this.panelOpen = true;
				this.notify();
			}
			close() {
				if (!this.panelOpen) return;
				this.panelOpen = false;
				this.notify();
			}
			toggle() {
				if (this.panelOpen) this.close();
				else this.open();
			}
			notify() {
				for (const fn of [...this.listeners]) fn();
			}
		};
		//#endregion
		//#region src/client/locales.ts
		/**
		* dsh-audiogen surface copy: zh is the key source, en mirrors every key.
		*/
		const zh = {
			"entry.label": "AI 音频",
			"entry.tooltip": "AI 音频面板（TTS / 音乐 / 音效）",
			"panel.title": "AI 音频",
			"mode.tts": "文本转语音",
			"mode.music": "音乐生成",
			"mode.sfx": "音效生成",
			"mode.voiceDesign": "音色设计",
			"prompt.placeholder": "输入文本、音乐/音效描述，或音色设计描述…",
			"prompt.required": "请输入文本或提示词",
			"model.label": "模型 / 音色",
			"voice.label": "音色",
			"speed.label": "语速",
			"duration.label": "时长（秒）",
			"format.label": "输出格式",
			"generate": "开始生成",
			"generating": "生成中…",
			"download": "下载",
			"result.empty": "生成结果将显示在这里",
			"result.done": "生成完成，共 {count} 段音频",
			"history.title": "历史记录",
			"history.empty": "暂无历史记录",
			"config.missing": "尚未配置音频 API：请前往「设置 → 插件 → AI 音频」添加渠道。",
			"config.disabled": "插件已停用，请在设置中重新启用。",
			"settings.title": "AI 音频（dsh-audiogen）",
			"settings.description": "配置多厂商音频生成 API 地址与密钥",
			"settings.collapse": "收起",
			"settings.expand": "展开",
			"settings.enabled": "启用插件",
			"settings.announceToAgent": "向 Agent 播报本插件",
			"settings.allowAgentAudio": "允许 Agent 调用音频生成",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.discard": "放弃修改",
			"settings.unsaved": "有未保存的修改",
			"settings.readOnly": "当前设置为只读。",
			"channels.title": "音频渠道",
			"channels.hint": "每个渠道是一个独立的音频厂商/API 端点，可配置多个。",
			"channels.empty": "还没有渠道。",
			"channels.addProvider": "+ 添加预置厂商",
			"channels.addCustom": "+ 添加自定义渠道",
			"channels.edit": "编辑",
			"channels.delete": "删除",
			"channels.confirm": "确认删除",
			"channels.cancel": "取消",
			"channels.keySet": "已填密钥",
			"channels.keyMissing": "未填密钥",
			"channels.modelCount": "{n} 个模型/音色",
			"channels.noModels": "未配置模型",
			"channels.statusReady": "可用",
			"channels.statusIncomplete": "未完成",
			"channels.untitled": "未命名渠道",
			"channel.name": "名称",
			"channel.apiUrl": "API 地址",
			"channel.apiKey": "API 密钥",
			"channel.apiKeyHint": "留空则保持当前密钥；输入新值可更换。",
			"channel.models": "模型 / 音色（每行一个：别名=上游ID）",
			"channel.modelsHint": "每行格式：别名=上游ID，可加 @分类（tts/music/sfx/voice_design/voice_clone）；例如 tts-1=tts-1 @tts 或 Rachel=21m00Tcm4TlvDq8ikWAM @tts",
			"channel.default": "设为默认",
			"channel.cancel": "取消",
			"channel.save": "保存渠道",
			"presets.title": "预置厂商",
			"presets.custom": "自定义渠道"
		};
		const en = {
			"entry.label": "AI Audio",
			"entry.tooltip": "AI audio panel (TTS / music / SFX)",
			"panel.title": "AI Audio",
			"mode.tts": "Text to speech",
			"mode.music": "Music",
			"mode.sfx": "Sound effects",
			"mode.voiceDesign": "Voice design",
			"prompt.placeholder": "Text to speak, or a music/SFX/voice-design description…",
			"prompt.required": "Prompt or text is required",
			"model.label": "Model / voice",
			"voice.label": "Voice",
			"speed.label": "Speed",
			"duration.label": "Duration (s)",
			"format.label": "Format",
			"generate": "Generate",
			"generating": "Generating…",
			"download": "Download",
			"result.empty": "Generated audio will appear here.",
			"result.done": "Done, {count} audio file(s).",
			"history.title": "History",
			"history.empty": "No audio history yet.",
			"config.missing": "No audio API configured. Open Settings > Plugins > AI Audio and add a channel.",
			"config.disabled": "The plugin is disabled. Enable it in Settings.",
			"settings.title": "AI Audio (dsh-audiogen)",
			"settings.description": "Configure multi-vendor audio generation endpoints and keys",
			"settings.collapse": "Collapse",
			"settings.expand": "Expand",
			"settings.enabled": "Enable plugin",
			"settings.announceToAgent": "Announce this plugin to agents",
			"settings.allowAgentAudio": "Allow agents to generate audio",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.discard": "Discard",
			"settings.unsaved": "Unsaved changes",
			"settings.readOnly": "Settings are read-only.",
			"channels.title": "Audio channels",
			"channels.hint": "Each channel is an independent audio vendor/API endpoint.",
			"channels.empty": "No channels yet.",
			"channels.addProvider": "+ Add preset vendor",
			"channels.addCustom": "+ Add custom channel",
			"channels.edit": "Edit",
			"channels.delete": "Delete",
			"channels.confirm": "Confirm delete",
			"channels.cancel": "Cancel",
			"channels.keySet": "Key set",
			"channels.keyMissing": "No key",
			"channels.modelCount": "{n} model(s)/voice(s)",
			"channels.noModels": "No models configured",
			"channels.statusReady": "Ready",
			"channels.statusIncomplete": "Incomplete",
			"channels.untitled": "Untitled channel",
			"channel.name": "Name",
			"channel.apiUrl": "API URL",
			"channel.apiKey": "API key",
			"channel.apiKeyHint": "Leave blank to keep the current key.",
			"channel.models": "Models / voices (one per line: alias=upstreamId)",
			"channel.modelsHint": "One per line: alias=upstreamId, optional @category (tts/music/sfx/voice_design/voice_clone); e.g. tts-1=tts-1 @tts or Rachel=21m00Tcm4TlvDq8ikWAM @tts",
			"channel.default": "Set default",
			"channel.cancel": "Cancel",
			"channel.save": "Save channel",
			"presets.title": "Preset vendors",
			"presets.custom": "Custom channel"
		};
		//#endregion
		//#region src/client/helpers.ts
		/**
		* Shared panel helpers: active-dictionary pick and a small error extractor.
		*/
		function dictionary() {
			return (typeof document !== "undefined" ? document.documentElement.lang : "zh").toLowerCase().startsWith("en") ? { ...en } : { ...zh };
		}
		function tt(key, values) {
			const text = dictionary()[key] ?? key;
			if (values === void 0) return text;
			let rendered = text;
			for (const [name, value] of Object.entries(values)) rendered = rendered.replaceAll(`{${name}}`, String(value));
			return rendered;
		}
		//#endregion
		//#region src/client/settings-scope.ts
		/**
		* Browser-side settings scope for the dsh-audiogen namespace, served by the
		* plugin's own loopback bridge routes (/api/dsh-audiogen/settings). The
		* official rc.6 settings scope answers "unavailable" for every third-party
		* namespace (the host-apiproxy allowlist is hard-coded), so this package
		* re-serves its namespace through the host settings seam over a same-origin,
		* loopback-only HTTP pair — the same pattern the dsh-web-ui family bridge
		* uses, self-contained per plugin.
		*/
		/** Settings wire face over the bridge routes (fetch-backed). */
		function createBridgeApi(fetchFn) {
			const post = async (path, body) => {
				try {
					const response = await fetchFn(path, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					});
					if (!response.ok) return { result: {
						ok: false,
						code: "internal",
						message: `bridge HTTP ${response.status}`
					} };
					return { result: await response.json() };
				} catch {
					return { result: {
						ok: false,
						code: "internal",
						message: "settings bridge unreachable"
					} };
				}
			};
			return { settings: {
				describe: async (payload) => post(SETTINGS_API.describe, payload),
				mutate: async (payload) => post(SETTINGS_API.mutate, payload)
			} };
		}
		/**
		* A SettingsScope over the bridge face: serialized queue, revision-fenced
		* writes, recovery read after a refusal. Mirrors the official controller's
		* ordering but trusts the Host-seam value without re-running the wire-schema
		* validation — the seam already validated it.
		*/
		var BridgeScopeController = class {
			api;
			spec;
			store;
			/** Whether the namespace currently holds a stored secret (e.g. apiKey). */
			keySet;
			/** Individual secret presence bits, keyed by the settings field name. */
			secretSets;
			tail = Promise.resolve();
			disposed = false;
			constructor(api, spec) {
				this.api = api;
				this.spec = spec;
				this.store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
					status: "loading",
					value: void 0,
					base: void 0,
					user: void 0,
					revision: void 0,
					writable: false,
					mode: "host"
				});
				this.keySet = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(false);
				this.secretSets = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({});
			}
			getSnapshot() {
				return this.store.getSnapshot();
			}
			/** Whether a stored secret exists (from the redacted view's secrets list). */
			getKeySetSnapshot() {
				return this.keySet.getSnapshot();
			}
			/** Observe the secret-set flag. */
			subscribeKeySet(listener) {
				return this.keySet.subscribe(listener);
			}
			/** Whether a specific secret field currently has a stored value. */
			getSecretSetSnapshot(field) {
				return this.secretSets.getSnapshot()[field] === true;
			}
			/** Observe changes to individual secret-field presence bits. */
			subscribeSecretSets(listener) {
				return this.secretSets.subscribe(listener);
			}
			subscribe(listener) {
				return this.store.subscribe(listener);
			}
			/** Queue a bridge refresh. */
			load() {
				return this.enqueue(() => this.read());
			}
			set(field, value) {
				return this.enqueue(() => this.writeOps([{
					op: "set",
					path: [field],
					value
				}]));
			}
			unset(field) {
				return this.enqueue(() => this.writeOps([{
					op: "unset",
					path: [field]
				}]));
			}
			/** Apply several path ops in one revision-fenced mutate call (atomic save).
			*  Path ops may address plain-object fields (e.g. `channelSecrets.<id>`),
			*  but never navigate *inside* arrays — write array fields wholesale. */
			mutateOps(ops) {
				return this.enqueue(() => this.writeOps(ops));
			}
			async dispose() {
				this.disposed = true;
				await this.tail;
			}
			enqueue(operation) {
				if (this.disposed) return Promise.resolve();
				const task = this.tail.then(async () => {
					if (this.disposed) return;
					await operation();
				});
				this.tail = task.catch(() => {});
				return task;
			}
			async read() {
				let response;
				try {
					response = await this.api.describe({});
				} catch {
					if (!this.disposed) this.store.update((draft) => {
						draft.status = "unavailable";
					});
					return;
				}
				if (!response.result.ok || this.disposed) {
					if (!this.disposed) this.store.update((draft) => {
						draft.status = "unavailable";
					});
					return;
				}
				const { namespaces, writable } = response.result.value;
				const view = namespaces?.find((candidate) => candidate.ns === this.spec.namespace);
				if (view === void 0) {
					this.store.update((draft) => {
						draft.status = "unavailable";
						draft.writable = writable === true;
					});
					this.keySet.set(false);
					this.secretSets.set({});
					return;
				}
				this.accept(view, writable);
			}
			async writeOps(ops) {
				const revision = this.getSnapshot().revision;
				let response;
				try {
					response = await this.api.mutate({
						ns: this.spec.namespace,
						ops,
						...revision === void 0 ? {} : { expectedRevision: revision }
					});
				} catch {
					await this.read();
					return;
				}
				if (!response.result.ok || this.disposed) {
					await this.read();
					return;
				}
				this.accept(response.result.value, void 0);
			}
			accept(view, writable) {
				this.store.update((draft) => {
					draft.revision = view.revision;
					draft.base = view.base;
					draft.user = view.user;
					if (writable !== void 0) draft.writable = writable;
					draft.status = "ready";
					draft.value = view.value;
				});
				const secretSets = Object.fromEntries((view.secrets ?? []).map((secret) => [secret.path.join("."), secret.set]));
				this.keySet.set(Object.values(secretSets).some(Boolean));
				this.secretSets.set(secretSets);
			}
		};
		/**
		* Bind the dsh-audiogen settings scope over the bridge routes and start its
		* initial read (the caller mounts nothing until the scope settles).
		* @param fetchFn - the fetch implementation (the global fetch on loopback).
		* @returns the scope; unavailable when the bridge is unreachable.
		*/
		function bindAudiogenScope(fetchFn = fetch) {
			const controller = new BridgeScopeController(createBridgeApi(fetchFn).settings, { namespace: "dsh-audiogen" });
			controller.load();
			return controller;
		}
		/**
		* Flatten the configured channels into the model options the panel lists
		* (aliases; the default channel's models first) plus the default channel id.
		* Falls back to the legacy flat allow-list while no channels exist (upgrade
		* path). Pure projection — no host calls.
		*/
		function audioModelOptions(config) {
			const channels = config?.channels ?? [];
			if (channels.length === 0) return { models: [] };
			const defaultId = config?.defaultChannelId !== void 0 && channels.some((channel) => channel.id === config.defaultChannelId) ? config.defaultChannelId : channels[0].id;
			const ordered = [defaultId, ...channels.filter((channel) => channel.id !== defaultId).map((channel) => channel.id)];
			const models = [];
			const seen = /* @__PURE__ */ new Set();
			for (const id of ordered) {
				const channel = channels.find((candidate) => candidate.id === id);
				for (const model of channel.models) {
					if (model.alias === "" || seen.has(model.alias)) continue;
					seen.add(model.alias);
					models.push({
						alias: model.alias,
						...model.category === void 0 ? {} : { category: model.category }
					});
				}
			}
			return models.length > 0 ? {
				models,
				defaultChannelId: defaultId
			} : {
				models: [],
				defaultChannelId: defaultId
			};
		}
		//#endregion
		//#region \0dsh-css:/Users/shimingming/Projects_code/dsh-audiogen/src/client/audio-panel.module.css.mjs
		const css$3 = ".Oo1fpq_panel{background:var(--dsw-alias-bg-base,#f7f7f8);height:100%;color:var(--dsw-alias-label-primary,#1f2328);font-family:var(--dsw-font-family,system-ui, sans-serif);flex-direction:column;gap:12px;padding:14px 16px;display:flex;overflow:hidden}.Oo1fpq_header{justify-content:space-between;align-items:center;display:flex}.Oo1fpq_title{margin:0;font-size:16px;font-weight:700}.Oo1fpq_layout{flex:1;gap:14px;min-height:0;display:flex}.Oo1fpq_form{flex-direction:column;flex:none;gap:12px;width:300px;min-width:260px;max-width:340px;display:flex;overflow-y:auto}.Oo1fpq_result{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:12px;flex-direction:column;flex:1;min-width:0;padding:14px;display:flex;overflow-y:auto}.Oo1fpq_label{color:var(--dsw-alias-label-secondary,#6b7280);flex-direction:column;gap:5px;font-size:12px;font-weight:600;display:flex}.Oo1fpq_textarea,.Oo1fpq_input,.Oo1fpq_select{border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);width:100%;min-height:36px;color:var(--dsw-alias-label-primary,#1f2328);font:inherit;border-radius:8px;outline:none;padding:7px 10px;font-size:13px}.Oo1fpq_textarea{resize:vertical;min-height:110px}.Oo1fpq_modeRow{gap:6px;display:flex}.Oo1fpq_modeButton{border:1px solid var(--dsw-alias-border-l2,#d1d5db);font:inherit;cursor:pointer;background:0 0;border-radius:8px;flex:1;padding:7px 8px;font-size:12px}.Oo1fpq_modeButton[data-active=true]{border-color:var(--dsw-alias-brand-primary,#2563eb);color:var(--dsw-alias-brand-primary,#2563eb);font-weight:600}.Oo1fpq_generate{background:var(--dsw-alias-label-primary,#1f2328);color:var(--dsw-alias-bg-layer-3,#fff);font:inherit;cursor:pointer;border:0;border-radius:10px;padding:9px 14px;font-size:13px}.Oo1fpq_generate:disabled{opacity:.5;cursor:default}.Oo1fpq_empty,.Oo1fpq_error,.Oo1fpq_hint{color:var(--dsw-alias-label-secondary,#6b7280);font-size:13px}.Oo1fpq_error{color:#b91c1c}.Oo1fpq_audioList{gap:10px;margin-top:8px;display:grid}.Oo1fpq_audioCard{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;flex-direction:column;gap:6px;padding:10px;display:flex}.Oo1fpq_audio{width:100%;height:36px}.Oo1fpq_download{color:#2563eb;font-size:12px;text-decoration:none}.Oo1fpq_history{border-left:1px solid var(--dsw-alias-border-l1,#e5e7eb);flex:none;width:260px;padding-left:12px;overflow-y:auto}.Oo1fpq_historyTitle{font-size:13px;font-weight:700}.Oo1fpq_historyEmpty{color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:12px}.Oo1fpq_historyItem{border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);padding:8px 0}.Oo1fpq_historyPrompt{text-overflow:ellipsis;white-space:nowrap;font-size:12px;overflow:hidden}.Oo1fpq_historyMeta{color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:11px}.Oo1fpq_historyAudio{width:100%;height:30px;margin-top:4px}";
		const tagId$3 = "dsh-audiogen/audio-panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-audiogen";
			tag.dataset.pluginCss = tagId$3;
			tag.textContent = css$3;
			document.head.appendChild(tag);
		}
		var audio_panel_module_css_default = {
			"audio": "Oo1fpq_audio",
			"generate": "Oo1fpq_generate",
			"download": "Oo1fpq_download",
			"modeButton": "Oo1fpq_modeButton",
			"result": "Oo1fpq_result",
			"empty": "Oo1fpq_empty",
			"historyItem": "Oo1fpq_historyItem",
			"modeRow": "Oo1fpq_modeRow",
			"historyPrompt": "Oo1fpq_historyPrompt",
			"hint": "Oo1fpq_hint",
			"historyMeta": "Oo1fpq_historyMeta",
			"panel": "Oo1fpq_panel",
			"form": "Oo1fpq_form",
			"layout": "Oo1fpq_layout",
			"error": "Oo1fpq_error",
			"input": "Oo1fpq_input",
			"audioCard": "Oo1fpq_audioCard",
			"label": "Oo1fpq_label",
			"textarea": "Oo1fpq_textarea",
			"historyTitle": "Oo1fpq_historyTitle",
			"select": "Oo1fpq_select",
			"header": "Oo1fpq_header",
			"historyEmpty": "Oo1fpq_historyEmpty",
			"title": "Oo1fpq_title",
			"history": "Oo1fpq_history",
			"audioList": "Oo1fpq_audioList",
			"historyAudio": "Oo1fpq_historyAudio"
		};
		//#endregion
		//#region src/client/AudioGenPanel.tsx
		/**
		* The AI 音频 panel: a compact audio-generation studio.
		* TTS / music / SFX / voice design are separated; each mode only lists
		* compatible models and shows its own parameters.
		*/
		function useConfig(scope) {
			const [value, setValue] = (0, react.useState)(scope.getSnapshot().value);
			(0, react.useEffect)(() => scope.subscribe(() => {
				setValue(scope.getSnapshot().value);
			}), [scope]);
			return value;
		}
		function useHistory() {
			const [entries, setEntries] = (0, react.useState)([]);
			const reload = () => {
				fetch(HISTORY_API.list, { method: "POST" }).then(async (response) => {
					const body = await response.json();
					if (body.ok === true) setEntries(body.history ?? []);
				}).catch(() => {});
			};
			(0, react.useEffect)(() => {
				reload();
			}, []);
			const clear = () => {
				fetch(HISTORY_API.clear, { method: "POST" }).then(() => reload()).catch(() => {});
			};
			return {
				entries,
				reload,
				clear
			};
		}
		function dataUrlOf(audio) {
			return `data:${audio.mime};base64,${audio.b64}`;
		}
		function AudioGenPanel(props) {
			const { api, scope } = props;
			const config = useConfig(scope);
			const enabled = config?.enabled ?? true;
			const modelOptions = audioModelOptions(config);
			const channels = config?.channels ?? [];
			const connected = enabled && channels.some((channel) => {
				const keyHeld = scope.getSecretSetSnapshot(`channelSecrets.${channel.id}`);
				return channel.apiUrl.trim() !== "" && keyHeld && (channel.models.length > 0 || channel.preset === "minimax");
			});
			const [mode, setMode] = (0, react.useState)("tts");
			const [prompt, setPrompt] = (0, react.useState)("");
			const [previewText, setPreviewText] = (0, react.useState)("");
			const [model, setModel] = (0, react.useState)("");
			const [voice, setVoice] = (0, react.useState)("");
			const [speed, setSpeed] = (0, react.useState)("");
			const [duration, setDuration] = (0, react.useState)("");
			const [format, setFormat] = (0, react.useState)("mp3");
			const [loading, setLoading] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [outputs, setOutputs] = (0, react.useState)([]);
			const { entries, reload, clear } = useHistory();
			const visibleModels = (0, react.useMemo)(() => {
				if (mode === "voice_design") return [];
				return modelOptions.models.filter((entry) => entry.category === void 0 || entry.category === "tts" && mode === "tts" || entry.category === mode).map((entry) => entry.alias);
			}, [modelOptions.models, mode]);
			(0, react.useEffect)(() => {
				if (visibleModels.length > 0 && !visibleModels.includes(model)) setModel(visibleModels[0]);
			}, [visibleModels, model]);
			const submit = async () => {
				if (prompt.trim() === "") {
					setError(tt("prompt.required"));
					return;
				}
				setLoading(true);
				setError(null);
				try {
					const response = await api.generate({
						mode,
						model: (model || visibleModels[0]) ?? "",
						prompt: prompt.trim(),
						...previewText.trim() !== "" ? { previewText: previewText.trim() } : {},
						...voice.trim() !== "" ? { voice: voice.trim() } : {},
						...speed.trim() !== "" ? { speed: Number(speed) } : {},
						...duration.trim() !== "" ? { duration: Number(duration) } : {},
						...format.trim() !== "" ? { format: format.trim() } : {}
					});
					if (!response.ok) {
						setError(response.message ?? "生成失败");
						return;
					}
					setOutputs(response.outputs ?? []);
					reload();
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setLoading(false);
				}
			};
			const modeLabel = (0, react.useMemo)(() => {
				if (mode === "tts") return tt("mode.tts");
				if (mode === "music") return tt("mode.music");
				if (mode === "sfx") return tt("mode.sfx");
				return tt("mode.voiceDesign");
			}, [mode]);
			const needModel = mode !== "voice_design";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: audio_panel_module_css_default.panel,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: audio_panel_module_css_default.header,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: audio_panel_module_css_default.title,
						children: tt("panel.title")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: audio_panel_module_css_default.hint,
						children: modeLabel
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: audio_panel_module_css_default.layout,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: audio_panel_module_css_default.form,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: audio_panel_module_css_default.modeRow,
									children: [
										"tts",
										"music",
										"sfx",
										"voice_design"
									].map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: audio_panel_module_css_default.modeButton,
										"data-active": mode === item ? "true" : "false",
										onClick: () => setMode(item),
										children: item === "tts" ? tt("mode.tts") : item === "music" ? tt("mode.music") : item === "sfx" ? tt("mode.sfx") : tt("mode.voiceDesign")
									}, item))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: mode === "voice_design" ? "音色描述" : mode === "tts" ? "文本" : "提示词" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										className: audio_panel_module_css_default.textarea,
										value: prompt,
										onChange: (event) => setPrompt(event.target.value),
										placeholder: tt("prompt.placeholder")
									})]
								}),
								mode === "voice_design" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "试听文本" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: audio_panel_module_css_default.input,
										value: previewText,
										onChange: (event) => setPreviewText(event.target.value),
										placeholder: "你好，这是新设计的音色试听。"
									})]
								}) : null,
								needModel ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tt("model.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: audio_panel_module_css_default.select,
										value: model,
										onChange: (event) => setModel(event.target.value),
										children: [visibleModels.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: "（当前模式暂无可用模型）"
										}) : null, visibleModels.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: item,
											children: item
										}, item))]
									})]
								}) : null,
								mode === "tts" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tt("voice.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: audio_panel_module_css_default.input,
										value: voice,
										onChange: (event) => setVoice(event.target.value),
										placeholder: "alloy / 自定义音色"
									})]
								}) : null,
								mode === "tts" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tt("speed.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: audio_panel_module_css_default.input,
										type: "number",
										step: "0.1",
										min: "0.5",
										max: "2",
										value: speed,
										onChange: (event) => setSpeed(event.target.value),
										placeholder: "1.0"
									})]
								}) : null,
								mode === "music" || mode === "sfx" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tt("duration.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: audio_panel_module_css_default.input,
										type: "number",
										step: "1",
										min: "1",
										max: "120",
										value: duration,
										onChange: (event) => setDuration(event.target.value),
										placeholder: "30"
									})]
								}) : null,
								needModel ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tt("format.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: audio_panel_module_css_default.select,
										value: format,
										onChange: (event) => setFormat(event.target.value),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "mp3",
												children: "mp3"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "wav",
												children: "wav"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "flac",
												children: "flac"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "ogg",
												children: "ogg"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "pcm",
												children: "pcm"
											})
										]
									})]
								}) : null,
								!connected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: audio_panel_module_css_default.hint,
									children: tt("config.missing")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: audio_panel_module_css_default.generate,
									disabled: loading || !connected || needModel && visibleModels.length === 0,
									onClick: () => void submit(),
									children: loading ? tt("generating") : tt("generate")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: audio_panel_module_css_default.result,
							children: [error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: audio_panel_module_css_default.error,
								children: error
							}) : null, outputs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: audio_panel_module_css_default.empty,
								children: tt("result.empty")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: audio_panel_module_css_default.hint,
								children: tt("result.done", { count: outputs.length })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: audio_panel_module_css_default.audioList,
								children: outputs.map((audio, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: audio_panel_module_css_default.audioCard,
									children: [
										audio.voiceId !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											className: audio_panel_module_css_default.hint,
											children: ["新音色 ID：", audio.voiceId]
										}) : null,
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("audio", {
											className: audio_panel_module_css_default.audio,
											controls: true,
											preload: "metadata",
											src: dataUrlOf(audio)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
											className: audio_panel_module_css_default.download,
											href: dataUrlOf(audio),
											download: `generated-${index + 1}.${audio.mime.split("/")[1]?.replace("mpeg", "mp3") ?? "mp3"}`,
											children: "下载"
										})
									]
								}, audio.id))
							})] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
							className: audio_panel_module_css_default.history,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: audio_panel_module_css_default.historyHeader,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									className: audio_panel_module_css_default.historyTitle,
									children: tt("history.title")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: clear,
									style: {
										border: 0,
										background: "none",
										cursor: "pointer",
										color: "inherit",
										fontSize: 12
									},
									children: "清空"
								})]
							}), entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: audio_panel_module_css_default.historyEmpty,
								children: tt("history.empty")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: entries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: audio_panel_module_css_default.historyItem,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: audio_panel_module_css_default.historyPrompt,
										children: entry.prompt
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: audio_panel_module_css_default.historyMeta,
										children: [
											entry.mode,
											" · ",
											entry.model,
											entry.channel ? ` · ${entry.channel}` : ""
										]
									}),
									entry.audio.map((audio, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("audio", {
										className: audio_panel_module_css_default.historyAudio,
										controls: true,
										preload: "none",
										src: audio.url
									}, index))
								]
							}, entry.id)) })]
						})
					]
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/shimingming/Projects_code/dsh-audiogen/src/client/panel.module.css.mjs
		const css$2 = "[data-pane=conversation],[class*=centerCol]{position:relative}[data-dsh-audiogen-view]{z-index:60;background:var(--dsw-alias-bg-base);display:none;position:absolute;inset:0}html[data-dsh-audiogen-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-audiogen-view]{display:block}html[data-dsh-audiogen-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane=conversation]>:not([data-dsh-audiogen-view]),html[data-dsh-audiogen-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*=centerCol]>:not([data-dsh-audiogen-view]){display:none!important}.rwa6qG_entry{width:100%;height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:0 12px;font-size:13px;display:flex}.rwa6qG_entry:hover{background:var(--dsw-specific-sidebar-nav-item-hover);color:var(--dsw-alias-label-primary)}.rwa6qG_entry[data-active]{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary);font-weight:600}.rwa6qG_entryIcon{flex:none;justify-content:center;align-items:center;display:inline-flex}.rwa6qG_entryLabel{text-overflow:ellipsis;overflow:hidden}[data-dsh-frame][data-sidebar-collapsed] .rwa6qG_entry{justify-content:center;width:100%;padding:0}[data-dsh-frame][data-sidebar-collapsed] .rwa6qG_entryLabel{display:none}.rwa6qG_view{overflow:hidden}.rwa6qG_panel,.rwa6qG_panel *,.rwa6qG_panel :before,.rwa6qG_panel :after{box-sizing:border-box}.rwa6qG_panel{background:var(--dsw-alias-bg-base);min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);flex-direction:column;gap:10px;padding:14px 16px 16px;display:flex;position:relative;overflow:hidden}.rwa6qG_panelHeader{flex:none;justify-content:space-between;align-items:center;gap:12px;display:flex}.rwa6qG_panelHeading{align-items:baseline;gap:10px;min-width:0;display:flex}.rwa6qG_panelTitle{color:var(--dsw-alias-label-primary);white-space:nowrap;margin:0;font-size:16px;font-weight:700}.rwa6qG_githubLink{width:22px;height:22px;color:var(--dsw-alias-label-secondary);border-radius:6px;flex:none;justify-content:center;align-items:center;text-decoration:none;transition:color .12s,background .12s;display:inline-flex}.rwa6qG_githubLink:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}.rwa6qG_connectionStatus{border:1px solid var(--dsw-alias-label-error);height:28px;color:var(--dsw-alias-label-error);font:inherit;white-space:nowrap;background:0 0;border-radius:8px;flex:none;align-items:center;gap:6px;padding:0 10px;font-size:12px;line-height:1;display:inline-flex}.rwa6qG_connectionStatus[data-connected=true]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}.rwa6qG_connectionDot{background:currentColor;border-radius:50%;width:6px;height:6px}.rwa6qG_updateBanner{border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);overflow-wrap:anywhere;border-radius:10px;flex:none;justify-content:space-between;align-items:center;gap:12px;padding:7px 10px 7px 12px;font-size:12px;line-height:1.5;display:flex}.rwa6qG_updateBanner[data-kind=ok]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}.rwa6qG_updateText{min-width:0}.rwa6qG_updateActions{flex:none;align-items:center;gap:10px;display:inline-flex}.rwa6qG_updateRelease{color:inherit;text-underline-offset:2px;white-space:nowrap;text-decoration:underline}@media (width<=700px){.rwa6qG_panelHeader{align-items:flex-start}.rwa6qG_panelHeading{flex-direction:column;align-items:flex-start;gap:2px}.rwa6qG_updateBanner{flex-direction:column;align-items:flex-start}.rwa6qG_updateActions{justify-content:space-between;width:100%}}.rwa6qG_studio{flex:1;gap:14px;min-width:0;min-height:0;display:flex}.rwa6qG_config{flex-direction:column;flex:none;gap:12px;width:300px;min-width:260px;max-width:340px;height:100%;min-height:0;display:flex;overflow:hidden}.rwa6qG_configScroll{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;flex-direction:column;flex:1;gap:12px;min-height:0;padding-right:2px;display:flex;overflow-y:auto}.rwa6qG_configScroll::-webkit-scrollbar{width:8px}.rwa6qG_configScroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}.rwa6qG_canvas{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;flex-direction:column;flex:1;min-width:0;min-height:0;display:flex;position:relative;overflow:hidden}.rwa6qG_taskTray{z-index:6;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent);backdrop-filter:blur(10px);border-radius:9px;flex-direction:column;width:min(360px,100% - 24px);max-height:calc(100% - 24px);display:flex;position:absolute;top:12px;right:12px;overflow:hidden;box-shadow:0 8px 24px #0000001f}.rwa6qG_taskTray[data-open=false]{width:auto;max-width:calc(100% - 24px)}.rwa6qG_taskTrayHeader{min-height:34px;color:var(--dsw-alias-label-primary);border-bottom:1px solid var(--dsw-alias-border-l1);align-items:stretch;font-size:12px;font-weight:600;display:flex}.rwa6qG_taskTray[data-open=false] .rwa6qG_taskTrayHeader{border-bottom:0}.rwa6qG_taskTrayToggle{min-width:0;color:inherit;cursor:pointer;font:inherit;font-size:inherit;font-weight:inherit;text-align:left;background:0 0;border:0;flex:1;align-items:center;gap:8px;padding:8px 10px;display:flex}.rwa6qG_taskTrayToggle:hover{background:var(--dsw-alias-bg-layer-2)}.rwa6qG_taskTrayCount{min-width:18px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);text-align:center;border-radius:999px;padding:1px 5px;font-size:11px;font-weight:500}.rwa6qG_taskTrayChevron{color:var(--dsw-alias-label-tertiary);margin-left:auto;font-size:12px;font-weight:400}.rwa6qG_taskTrayClose{border:0;border-left:1px solid var(--dsw-alias-border-l1);width:32px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;background:0 0;font-size:17px}.rwa6qG_taskTrayClose:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}.rwa6qG_taskTray[data-open=false] .rwa6qG_taskTrayToggle{min-height:34px}.rwa6qG_taskRows{min-height:0;overflow-y:auto}.rwa6qG_taskTray[data-open=false] .rwa6qG_taskRows{display:none}.rwa6qG_taskRow{border-top:1px solid var(--dsw-alias-border-l1);grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:7px;padding:7px 10px;display:grid}.rwa6qG_taskRow:first-of-type{border-top:0}.rwa6qG_taskStatus{color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:11px}.rwa6qG_taskRow[data-status=running] .rwa6qG_taskStatus{color:var(--dsw-alias-brand-primary)}.rwa6qG_taskRow[data-status=failed] .rwa6qG_taskStatus{color:var(--dsw-alias-label-error)}.rwa6qG_taskPrompt{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;overflow:hidden}.rwa6qG_taskRow button{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);cursor:pointer;font:inherit;border:0;border-radius:5px;padding:2px 7px;font-size:11px}.rwa6qG_taskRow button:hover{color:var(--dsw-alias-brand-primary)}.rwa6qG_configGuide{z-index:1100;background:#00000059;place-items:center;padding:20px;display:grid;position:fixed;inset:0}.rwa6qG_configGuideBody{border:1px solid var(--dsw-alias-border-l2);width:min(360px,100%);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border-radius:10px;flex-direction:column;gap:12px;padding:18px;display:flex;box-shadow:0 14px 40px #0003}.rwa6qG_configGuideBody span{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}.rwa6qG_configGuideBody button{min-height:30px;color:var(--dsw-alias-bg-layer-1);background:var(--dsw-alias-brand-primary);cursor:pointer;font:inherit;border:0;border-radius:7px;align-self:flex-end;padding:0 12px;font-size:12px}.rwa6qG_history{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;flex-direction:column;flex:none;width:240px;min-width:200px;max-width:280px;min-height:0;display:flex;overflow:hidden}.rwa6qG_historyHeader{border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;display:flex}.rwa6qG_historyFilters{border-bottom:1px solid var(--dsw-alias-border-l1);grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px;display:grid}.rwa6qG_historySearch,.rwa6qG_historyFilters select,.rwa6qG_gallerySearch{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);min-width:0;min-height:29px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font:inherit;border-radius:7px;padding:0 8px;font-size:11px}.rwa6qG_historySearch{grid-column:1/-1}.rwa6qG_gallerySearch{width:156px}.rwa6qG_galleryTagInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:130px;min-height:29px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font:inherit;border-radius:7px;padding:0 8px;font-size:11px}.rwa6qG_galleryBulkButton{border:1px solid var(--dsw-alias-border-l2);min-height:29px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);cursor:pointer;font:inherit;border-radius:7px;padding:0 8px;font-size:11px}.rwa6qG_galleryBulkButton:hover:not(:disabled){color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}.rwa6qG_galleryBulkButton:disabled{opacity:.45;cursor:default}.rwa6qG_historyTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}.rwa6qG_historyClear{font:inherit;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;background:0 0;border-radius:999px;padding:2px 8px;font-size:11.5px}.rwa6qG_historyClear:hover{color:var(--dsw-alias-label-error);border-color:var(--dsw-alias-label-error)}.rwa6qG_historyList{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;flex-direction:column;flex:1;gap:8px;min-height:0;padding:10px;display:flex;overflow-y:auto}.rwa6qG_historyList::-webkit-scrollbar{width:8px}.rwa6qG_historyList::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}.rwa6qG_historyEmpty{text-align:center;color:var(--dsw-alias-label-tertiary);flex:1;justify-content:center;align-items:center;padding:20px;font-size:12px;line-height:1.6;display:flex}.rwa6qG_historyItem{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:10px;flex-direction:column;flex:none;gap:6px;padding:8px;display:flex}.rwa6qG_historyItem:hover{border-color:var(--dsw-alias-border-l2)}.rwa6qG_historyItem[data-active]{border-color:var(--dsw-alias-brand-primary)}.rwa6qG_historyMain{font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;align-items:flex-start;gap:8px;min-width:0;padding:0;display:flex}.rwa6qG_historyThumb{object-fit:cover;background:var(--dsw-alias-bg-base);border-radius:8px;flex:none;width:52px;height:52px}.rwa6qG_historyThumbPlaceholder{background:var(--dsw-alias-bg-layer-3);border-radius:8px;flex:none;width:52px;height:52px}.rwa6qG_historyInfo{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.rwa6qG_historyPrompt{color:var(--dsw-alias-label-primary);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:12px;line-height:1.4;display:-webkit-box;overflow:hidden}.rwa6qG_historyMeta{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:11px;overflow:hidden}.rwa6qG_historyActions{justify-content:flex-end;gap:6px;display:flex}.rwa6qG_historyAction{font:inherit;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;background:0 0;border-radius:999px;padding:2px 8px;font-size:11.5px}.rwa6qG_historyAction:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.rwa6qG_historyAction[data-danger]:hover{color:var(--dsw-alias-label-error);border-color:var(--dsw-alias-label-error)}.rwa6qG_card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;flex-direction:column;flex:none;gap:10px;padding:12px;display:flex}.rwa6qG_modeRow{align-items:center;gap:8px;display:flex}.rwa6qG_modePill{flex:1;justify-content:center;height:28px;font-size:13px}.rwa6qG_uploadBox{min-height:128px;color:var(--dsw-alias-label-secondary);border:1.5px dashed var(--dsw-alias-border-l2);cursor:pointer;font:inherit;text-align:center;background:0 0;border-radius:12px;flex-direction:column;justify-content:center;align-items:center;gap:6px;padding:16px;font-size:12.5px;display:flex}.rwa6qG_uploadBox:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}.rwa6qG_uploadBox:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.rwa6qG_uploadIcon{color:var(--dsw-alias-label-tertiary);display:inline-flex}.rwa6qG_uploadHint{color:var(--dsw-alias-label-tertiary);font-size:11px}.rwa6qG_reference{flex-direction:column;gap:8px;display:flex}.rwa6qG_referenceImage{object-fit:contain;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;width:100%;max-height:176px}.rwa6qG_referenceActions{gap:8px;display:flex}.rwa6qG_hiddenFile{display:none}.rwa6qG_prompt{width:100%;min-height:120px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);resize:vertical;box-sizing:border-box;border-radius:10px;outline:none;padding:10px 12px;font-family:inherit;font-size:13px;line-height:1.6}.rwa6qG_prompt:focus-visible{border-color:var(--dsw-alias-brand-primary)}.rwa6qG_prompt::placeholder{color:var(--dsw-alias-label-tertiary)}.rwa6qG_promptFooter{justify-content:space-between;align-items:center;gap:8px;margin-top:-6px;display:flex}.rwa6qG_templatesButton{border:1px solid var(--dsw-alias-brand-primary);background:linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent), color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent));height:26px;color:var(--dsw-alias-brand-primary);cursor:pointer;box-shadow:0 1px 0 color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent);border-radius:999px;align-items:center;gap:6px;padding:0 12px;font-family:inherit;font-size:12px;font-weight:600;transition:transform .12s,box-shadow .12s,background .12s;display:inline-flex}.rwa6qG_templatesButton svg{flex:none}.rwa6qG_templatesButton:hover{background:linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent), color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent));color:var(--dsw-alias-brand-primary);box-shadow:0 2px 6px color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent);transform:translateY(-1px)}.rwa6qG_templatesButton:active{transform:translateY(0)}.rwa6qG_enhanceButton{border:1px solid var(--dsw-alias-border-l2);height:26px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font:inherit;cursor:pointer;border-radius:999px;margin-left:auto;padding:0 11px;font-size:12px}.rwa6qG_enhanceButton:hover:not(:disabled){color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}.rwa6qG_enhanceButton:disabled{opacity:.5;cursor:default}.rwa6qG_promptCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px}.rwa6qG_paramGroup{flex-direction:column;gap:8px;display:flex}.rwa6qG_paramLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}.rwa6qG_optionRow{flex-wrap:wrap;gap:6px;display:flex}.rwa6qG_optionGrid{grid-template-columns:repeat(3,1fr);gap:6px;display:grid}.rwa6qG_optionPill{justify-content:center}.rwa6qG_paramHint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.45}.rwa6qG_footer{border-top:1px solid var(--dsw-alias-border-l1);flex-direction:column;flex:none;align-items:stretch;gap:8px;padding:10px 2px 0 0;display:flex}.rwa6qG_modelWrap{flex-direction:column;gap:5px;min-width:0;display:flex}.rwa6qG_modelLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}.rwa6qG_modelSelect{width:100%;height:36px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;text-align:left;border-radius:18px;outline:none;justify-content:space-between;align-items:center;gap:8px;padding:0 12px;font-family:inherit;font-size:13px;display:flex}.rwa6qG_modelSelect:focus-visible{border-color:var(--dsw-alias-brand-primary)}.rwa6qG_modelSelect:disabled{opacity:.55;cursor:default}.rwa6qG_modelMenu{min-width:0;display:block;position:relative}.rwa6qG_modelMenuList{z-index:40;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;padding:4px;display:flex;position:absolute;bottom:calc(100% + 6px);left:0;right:0;overflow:hidden;box-shadow:0 -8px 24px #0000002e}.rwa6qG_modelMenuItem{width:100%;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;white-space:nowrap;text-overflow:ellipsis;background:0 0;border:none;border-radius:8px;padding:7px 10px;font-size:13px;display:block;overflow:hidden}.rwa6qG_modelMenuItem:hover{background:var(--dsw-alias-bg-hover)}.rwa6qG_modelMenuItem[data-selected]{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);font-weight:600}.rwa6qG_generateButton{width:100%}.rwa6qG_generateInner{align-items:center;gap:7px;display:inline-flex}.rwa6qG_canvasState{text-align:center;color:var(--dsw-alias-label-tertiary);flex-direction:column;flex:1;justify-content:center;align-items:center;gap:8px;padding:24px;display:flex}.rwa6qG_canvasStateTitle{color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600}.rwa6qG_canvasStateHint{max-width:380px;font-size:12px;line-height:1.6}.rwa6qG_canvasEmptyIcon{color:var(--dsw-alias-label-tertiary);margin-bottom:4px;display:inline-flex}.rwa6qG_canvasError{color:var(--dsw-alias-label-error);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-label-error);overflow-wrap:anywhere;border-radius:10px;flex:none;margin:14px;padding:10px 14px;font-size:12.5px;line-height:1.6}.rwa6qG_canvasBody{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;flex-direction:column;flex:1;gap:10px;min-height:0;padding:14px;display:flex;overflow-y:auto}.rwa6qG_canvasBody::-webkit-scrollbar{width:8px}.rwa6qG_canvasBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}.rwa6qG_canvasMeta{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:8px;font-size:12px;display:flex}.rwa6qG_canvasHistoryTag{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px}.rwa6qG_grid{flex:1;grid-template-rows:repeat(2,minmax(0,1fr));grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;min-height:0;display:grid}.rwa6qG_grid[data-count=\"1\"] .rwa6qG_imageCard{grid-area:1/1/3/3}.rwa6qG_imageCard{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);cursor:zoom-in;border-radius:12px;flex-direction:column;min-height:0;margin:0;display:flex;position:relative;overflow:hidden}.rwa6qG_imageCard:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.rwa6qG_image{object-fit:cover;background:var(--dsw-alias-bg-base);flex:1;width:100%;min-height:0;display:block}.rwa6qG_imageCaption{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;border-top:1px solid var(--dsw-alias-border-l1);padding:7px 10px;font-size:11px;line-height:1.5;overflow:hidden}.rwa6qG_download{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-mask-1);border:1px solid var(--dsw-alias-border-l2);opacity:0;backdrop-filter:blur(4px);border-radius:999px;padding:2px 10px;font-size:12px;font-weight:500;line-height:20px;text-decoration:none;transition:opacity .12s;position:absolute;top:8px;right:8px}.rwa6qG_imageCard:hover .rwa6qG_download{opacity:1}.rwa6qG_download:hover{background:var(--dsw-alias-bg-base)}.rwa6qG_galleryAdd{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-mask-1);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;opacity:0;backdrop-filter:blur(4px);border-radius:999px;align-items:center;gap:5px;padding:2px 10px;font-size:12px;font-weight:500;line-height:20px;transition:opacity .12s;display:inline-flex;position:absolute;top:8px;left:8px}.rwa6qG_imageCard:hover .rwa6qG_galleryAdd{opacity:1}.rwa6qG_galleryAdd:hover{background:var(--dsw-alias-bg-base)}.rwa6qG_galleryAdd:disabled{opacity:.4;cursor:default}.rwa6qG_zoomHint{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-mask-1);border:1px solid var(--dsw-alias-border-l2);opacity:0;backdrop-filter:blur(4px);pointer-events:none;border-radius:999px;align-items:center;gap:5px;padding:2px 10px;font-size:12px;font-weight:500;line-height:20px;transition:opacity .12s;display:inline-flex;position:absolute;bottom:8px;left:8px}.rwa6qG_imageCard:hover .rwa6qG_zoomHint{opacity:1}.rwa6qG_spinner,.rwa6qG_bigSpinner{border:2px solid;border-top-color:#0000;border-radius:50%;flex:none;animation:.8s linear infinite rwa6qG_dshImageGenSpin;display:inline-block}.rwa6qG_spinner{width:11px;height:11px}.rwa6qG_bigSpinner{width:30px;height:30px;color:var(--dsw-alias-state-business-primary);border-width:3px;margin-bottom:6px}.rwa6qG_lightbox{z-index:1000;backdrop-filter:blur(6px);background:#000000b8;justify-content:center;align-items:center;padding:24px;display:flex;position:fixed;inset:0}.rwa6qG_lightboxClose{color:#fff;cursor:pointer;background:#ffffff24;border:1px solid #ffffff47;border-radius:50%;justify-content:center;align-items:center;width:38px;height:38px;display:inline-flex;position:absolute;top:16px;right:16px}.rwa6qG_lightboxClose:hover{background:#ffffff42}.rwa6qG_lightboxNav{color:#fff;cursor:pointer;background:#ffffff24;border:1px solid #ffffff47;border-radius:50%;justify-content:center;align-items:center;width:42px;height:42px;display:inline-flex;position:absolute;top:50%;transform:translateY(-50%)}.rwa6qG_lightboxNav:hover{background:#ffffff42}.rwa6qG_lightboxNav[data-dir=prev]{left:max(20px,50% - 640px)}.rwa6qG_lightboxNav[data-dir=next]{right:max(20px,50% - 640px)}.rwa6qG_lightboxFigure{flex-direction:column;gap:10px;width:min(1100px,100vw - 160px);max-width:min(1100px,100vw - 160px);height:min(820px,100vh - 48px);min-height:0;margin:0;display:flex}.rwa6qG_lightboxStage{background:#ffffff0a;border-radius:10px;flex:1;min-height:0;position:relative;overflow:auto}.rwa6qG_lightboxScaleFrame{justify-content:center;align-items:center;min-width:100%;min-height:100%;display:flex}.rwa6qG_lightboxImage{object-fit:contain;border-radius:10px;max-width:100%;max-height:100%;display:block;box-shadow:0 24px 80px #00000080}.rwa6qG_lightboxTools{justify-content:center;align-items:center;gap:6px;display:flex}.rwa6qG_lightboxTool,.rwa6qG_lightboxZoomLevel,.rwa6qG_lightboxCopy{color:#fff;cursor:pointer;background:#ffffff24;border:1px solid #ffffff47;justify-content:center;align-items:center;display:inline-flex}.rwa6qG_lightboxTool,.rwa6qG_lightboxZoomLevel{height:32px}.rwa6qG_lightboxTool{border-radius:50%;width:32px}.rwa6qG_lightboxZoomLevel{min-width:58px;font:inherit;font-variant-numeric:tabular-nums;border-radius:999px;padding:0 9px;font-size:12px}.rwa6qG_lightboxTool:hover,.rwa6qG_lightboxZoomLevel:hover,.rwa6qG_lightboxCopy:hover{background:#ffffff42}.rwa6qG_lightboxCaptionRow{align-items:flex-start;gap:8px;min-width:0;display:flex}.rwa6qG_lightboxCaption{color:#ffffffe6;-webkit-line-clamp:3;-webkit-box-orient:vertical;flex:1;min-width:0;font-size:12px;line-height:1.6;display:-webkit-box;overflow:hidden}.rwa6qG_lightboxCopy{min-height:28px;font:inherit;white-space:nowrap;border-radius:999px;flex:none;gap:5px;padding:4px 9px;font-size:12px}.rwa6qG_lightboxMeta{justify-content:space-between;align-items:center;gap:12px;display:flex}.rwa6qG_lightboxIndex{color:#fffc;font-variant-numeric:tabular-nums;font-size:12px}.rwa6qG_lightboxActions{align-items:center;gap:8px;display:inline-flex}.rwa6qG_lightboxDownload,.rwa6qG_lightboxEdit{font:inherit;color:#fff;cursor:pointer;background:#ffffff24;border:1px solid #ffffff47;border-radius:999px;padding:4px 14px;font-size:12.5px;font-weight:500;text-decoration:none}.rwa6qG_lightboxDownload:hover,.rwa6qG_lightboxEdit:hover{background:#ffffff42}.rwa6qG_lightboxEdit{color:#fff;background:#ffffff24;border:1px solid #ffffff47;border-radius:999px}@media (width<=720px){.rwa6qG_lightbox{padding:16px}.rwa6qG_lightboxFigure{width:calc(100vw - 32px);max-width:none}.rwa6qG_lightboxNav[data-dir=prev]{left:20px}.rwa6qG_lightboxNav[data-dir=next]{right:20px}.rwa6qG_lightboxCaptionRow,.rwa6qG_lightboxMeta{flex-direction:column;align-items:stretch}.rwa6qG_lightboxCopy,.rwa6qG_lightboxActions{align-self:flex-end}}@keyframes rwa6qG_dshImageGenSpin{to{transform:rotate(360deg)}}.rwa6qG_galleryToast{z-index:30;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-mask-1);border:1px solid var(--dsw-alias-border-l2);backdrop-filter:blur(6px);pointer-events:none;border-radius:999px;align-items:center;gap:7px;padding:6px 16px;font-size:13px;font-weight:500;animation:.16s ease-out rwa6qG_dshImageGenToastIn;display:inline-flex;position:absolute;bottom:24px;left:50%;transform:translate(-50%);box-shadow:0 8px 24px #00000038}@keyframes rwa6qG_dshImageGenToastIn{0%{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%)}}@media (prefers-reduced-motion:reduce){.rwa6qG_download,.rwa6qG_spinner,.rwa6qG_bigSpinner{transition:none;animation-duration:1.5s}}.rwa6qG_config[data-gallery=true] .rwa6qG_configScroll>:not(:first-child),.rwa6qG_config[data-gallery=true] .rwa6qG_footer,.rwa6qG_canvas[data-gallery=true]>.rwa6qG_canvasState,.rwa6qG_canvas[data-gallery=true]>.rwa6qG_canvasError,.rwa6qG_canvas[data-gallery=true]>.rwa6qG_canvasBody,.rwa6qG_studio:has(.rwa6qG_config[data-gallery=true])>.rwa6qG_history{display:none}.rwa6qG_config[data-gallery=true] .rwa6qG_configScroll{flex:none;order:1;display:flex;overflow:visible}.rwa6qG_config[data-gallery=true] .rwa6qG_galleryFilters{flex:1;order:2;min-height:0}.rwa6qG_galleryFilters{padding:18px 14px;overflow:hidden auto}.rwa6qG_galleryFilterHeading{color:var(--dsw-alias-label-tertiary);margin:0 4px 10px;font-size:12px;font-weight:600}.rwa6qG_galleryFilter{width:100%;min-height:34px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;background:0 0;border:0;border-radius:9px;justify-content:space-between;align-items:center;padding:0 10px;display:flex}.rwa6qG_galleryFilter:hover,.rwa6qG_galleryFilter[data-active]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)}.rwa6qG_galleryFilterCount{min-width:20px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);text-align:center;border-radius:999px;padding:1px 6px;font-size:11px}.rwa6qG_galleryFilterDivider{background:var(--dsw-alias-border-l1);height:1px;margin:18px 4px}.rwa6qG_galleryRatioList{flex-wrap:wrap;gap:6px;display:flex}.rwa6qG_galleryRatio{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);cursor:pointer;border:0;border-radius:999px;padding:6px 10px;font-size:12px}.rwa6qG_galleryRatio[data-active]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent)}.rwa6qG_galleryTagFilterList{flex-wrap:wrap;gap:6px;display:flex}.rwa6qG_galleryTagFilter{border:1px solid var(--dsw-alias-border-l1);min-width:0;max-width:100%;min-height:27px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);cursor:pointer;font:inherit;border-radius:6px;align-items:center;gap:5px;padding:0 8px;font-size:11px;display:inline-flex}.rwa6qG_galleryTagFilter span:first-child{text-overflow:ellipsis;white-space:nowrap;max-width:112px;overflow:hidden}.rwa6qG_galleryTagFilter span:last-child{color:var(--dsw-alias-label-tertiary);font-size:10px}.rwa6qG_galleryTagFilter:hover,.rwa6qG_galleryTagFilter[data-active]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)}.rwa6qG_galleryFilterNote{color:var(--dsw-alias-label-quaternary);margin:20px 4px 0;font-size:11px;line-height:1.5}.rwa6qG_galleryWorkspace{box-sizing:border-box;flex-direction:column;width:100%;min-width:0;height:100%;min-height:0;padding:22px 24px 26px;display:flex;position:absolute;inset:0;overflow:hidden}.rwa6qG_galleryToolbar{flex:none;justify-content:space-between;align-items:center;gap:16px;min-width:0;margin-bottom:18px;display:flex}.rwa6qG_galleryHeading{color:var(--dsw-alias-label-primary);margin:0;font-size:20px;font-weight:700;display:inline}.rwa6qG_galleryCount{color:var(--dsw-alias-label-tertiary);margin-left:8px;font-size:13px}.rwa6qG_galleryToolbarActions{flex-wrap:wrap;align-items:center;gap:10px;min-width:0;display:flex}.rwa6qG_gallerySelectMode,.rwa6qG_galleryBulkButton,.rwa6qG_gallerySelectionClear{border:1px solid var(--dsw-alias-border-l1);min-height:30px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);cursor:pointer;font:inherit;border-radius:7px;padding:0 10px;font-size:12px}.rwa6qG_gallerySelectMode:hover,.rwa6qG_gallerySelectMode[data-active],.rwa6qG_galleryBulkButton:hover:not(:disabled){color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, var(--dsw-alias-border-l1));background:color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, transparent)}.rwa6qG_galleryBulkButton:disabled{cursor:not-allowed;opacity:.45}.rwa6qG_gallerySelectionBar{border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, var(--dsw-alias-border-l1));background:color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, var(--dsw-alias-bg-layer-1));border-radius:9px;flex:none;align-items:center;gap:10px;min-width:0;margin:-4px 0 16px;padding:10px 12px;display:flex}.rwa6qG_gallerySelectionBar strong{color:var(--dsw-alias-brand-primary);flex:none;font-size:12px}.rwa6qG_gallerySelectionClear{margin-left:auto}.rwa6qG_gallerySelectionClear:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}.rwa6qG_galleryTagInput,.rwa6qG_gallerySearch{border:1px solid var(--dsw-alias-border-l1);min-width:0;height:30px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit;border-radius:7px;outline:none;padding:0 10px;font-size:12px}.rwa6qG_galleryTagInput{flex:190px}.rwa6qG_galleryTagInput:focus,.rwa6qG_gallerySearch:focus{border-color:var(--dsw-alias-brand-primary)}.rwa6qG_galleryViewToggle{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:9px;padding:3px;display:flex}.rwa6qG_galleryViewToggle button,.rwa6qG_gallerySort,.rwa6qG_galleryClear{min-height:30px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;background:0 0;border:0;border-radius:7px;padding:0 10px;font-size:12px}.rwa6qG_galleryViewToggle button[data-active],.rwa6qG_galleryViewToggle button:hover,.rwa6qG_gallerySort:hover,.rwa6qG_galleryClear:hover{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, transparent)}.rwa6qG_gallerySort{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.rwa6qG_galleryClear{border:1px solid var(--dsw-alias-border-l1)}.rwa6qG_compareControl{flex-direction:column;gap:6px;margin:0 0 10px;display:flex}.rwa6qG_compareToggle,.rwa6qG_compareModelChoices label{color:var(--dsw-alias-label-secondary);cursor:pointer;align-items:center;gap:6px;font-size:12px;display:flex}.rwa6qG_compareToggle input,.rwa6qG_compareModelChoices input{accent-color:var(--dsw-alias-brand-primary)}.rwa6qG_compareModelChoices{flex-wrap:wrap;gap:6px;display:flex}.rwa6qG_compareModelChoices label{border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:4px 6px;font-size:10px}.rwa6qG_comparisonBoard{z-index:4;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;flex-direction:column;display:flex;position:absolute;inset:14px;overflow:hidden;box-shadow:0 8px 24px #0000001f}.rwa6qG_comparisonBoard>header{border-bottom:1px solid var(--dsw-alias-border-l1);justify-content:space-between;align-items:center;padding:10px 12px;display:flex}.rwa6qG_comparisonBoard>header div{align-items:baseline;gap:7px;display:flex}.rwa6qG_comparisonBoard>header strong{color:var(--dsw-alias-label-primary);font-size:13px}.rwa6qG_comparisonBoard>header span{color:var(--dsw-alias-label-tertiary);font-size:11px}.rwa6qG_comparisonBoard>header button{border:1px solid var(--dsw-alias-border-l1);min-height:28px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);cursor:pointer;font:inherit;border-radius:5px;padding:0 9px;font-size:11px}.rwa6qG_comparisonGrid{flex:1;grid-template-rows:minmax(0,1fr);grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;min-height:0;padding:12px;display:grid;overflow:auto}.rwa6qG_comparisonGrid article{flex-direction:column;gap:7px;min-width:0;height:100%;min-height:0;display:flex}.rwa6qG_comparisonGrid article>strong{color:var(--dsw-alias-label-primary);font-size:12px}.rwa6qG_comparisonImageButton{cursor:zoom-in;background:var(--dsw-alias-bg-base);border:0;flex:1;width:100%;min-height:0;padding:0;display:flex;overflow:hidden}.rwa6qG_comparisonImageButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.rwa6qG_comparisonGrid article>span{min-height:0;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);flex:1;place-items:center;font-size:12px;display:grid}.rwa6qG_comparisonGrid img{object-fit:contain;background:var(--dsw-alias-bg-base);flex:1;width:100%;height:100%;min-height:0;max-height:none;display:block}.rwa6qG_comparisonFullscreen{z-index:1200;background:#000000eb;padding:54px 24px 24px;position:fixed;inset:0;overflow:auto}.rwa6qG_comparisonFullscreenGrid{grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start;gap:18px;min-height:100%;display:grid}.rwa6qG_comparisonFullscreen figure{min-width:0;margin:0}.rwa6qG_comparisonFullscreen figcaption{color:#fff;margin-bottom:8px;font-size:13px;font-weight:600}.rwa6qG_comparisonFullscreen img{background:#111;width:100%;margin-bottom:10px;display:block}.rwa6qG_historyItem[data-comparison]{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1))}.rwa6qG_galleryMasonry{box-sizing:border-box;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;flex:auto;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:max-content;align-content:start;gap:16px;width:100%;min-width:0;max-width:100%;height:0;min-height:0;padding:2px 8px 16px 2px;display:grid;overflow:hidden scroll}.rwa6qG_galleryMasonry::-webkit-scrollbar{width:8px}.rwa6qG_galleryMasonry::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}.rwa6qG_galleryCard{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:14px;width:100%;margin:0;display:block;position:relative;overflow:hidden;box-shadow:0 5px 18px #18203612}.rwa6qG_galleryCard[data-selected]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent), 0 5px 18px #18203612}.rwa6qG_gallerySelect{z-index:2;cursor:pointer;background:#00000094;border:1px solid #ffffffbf;border-radius:7px;place-items:center;width:26px;height:26px;display:grid;position:absolute;top:9px;right:9px}.rwa6qG_gallerySelect input{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;margin:0}.rwa6qG_galleryImageButton{background:var(--dsw-alias-bg-base);cursor:zoom-in;border:0;width:100%;padding:0;display:block;position:relative}.rwa6qG_galleryImageButton[data-selecting]{cursor:pointer}.rwa6qG_galleryImage{aspect-ratio:4/3;object-fit:cover;width:100%;display:block}.rwa6qG_galleryMasonry[data-view=masonry] .rwa6qG_galleryCard:nth-child(3n+1) .rwa6qG_galleryImage{aspect-ratio:4/5}.rwa6qG_galleryMasonry[data-view=masonry] .rwa6qG_galleryCard:nth-child(3n+2) .rwa6qG_galleryImage{aspect-ratio:4/3}.rwa6qG_galleryMasonry[data-view=masonry] .rwa6qG_galleryCard:nth-child(3n) .rwa6qG_galleryImage{aspect-ratio:3/4}.rwa6qG_galleryBadge{color:#fff;backdrop-filter:blur(4px);background:#121724c2;border-radius:999px;padding:4px 9px;font-size:11px;position:absolute;top:10px;left:10px}.rwa6qG_galleryCardFooter{align-items:center;gap:9px;min-width:0;padding:10px 12px;display:flex}.rwa6qG_galleryAvatar{color:#fff;background:var(--dsw-alias-brand-primary);border-radius:50%;flex:none;place-items:center;width:27px;height:27px;font-size:12px;font-weight:700;display:grid}.rwa6qG_galleryCardInfo{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.rwa6qG_galleryCardInfo strong,.rwa6qG_galleryCardInfo small{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.rwa6qG_galleryCardInfo strong{color:var(--dsw-alias-label-primary);font-size:12px}.rwa6qG_galleryCardInfo small{color:var(--dsw-alias-label-tertiary);font-size:10px}.rwa6qG_galleryTags{flex-wrap:wrap;gap:4px;margin-top:4px;display:flex}.rwa6qG_galleryTags button{max-width:96px;min-height:19px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);cursor:pointer;font:inherit;text-overflow:ellipsis;white-space:nowrap;border:0;border-radius:4px;padding:1px 6px;font-size:10px;line-height:1.35;overflow:hidden}.rwa6qG_galleryTags button:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 17%, transparent)}.rwa6qG_galleryTags .rwa6qG_galleryTagEdit{color:var(--dsw-alias-label-tertiary);background:0 0;flex:none}.rwa6qG_galleryTagEditor{align-items:center;gap:6px;padding:0 12px 10px 48px;display:flex}.rwa6qG_galleryTagEditor input{border:1px solid var(--dsw-alias-border-l2);min-width:0;height:27px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font:inherit;border-radius:6px;outline:none;flex:1;padding:0 8px;font-size:11px}.rwa6qG_galleryTagEditor input:focus{border-color:var(--dsw-alias-brand-primary)}.rwa6qG_galleryTagEditor button{border:1px solid var(--dsw-alias-border-l2);height:27px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);cursor:pointer;font:inherit;border-radius:6px;padding:0 8px;font-size:11px}.rwa6qG_galleryTagEditor button[type=submit]{color:var(--dsw-alias-brand-primary)}.rwa6qG_galleryRemove{width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:50%;flex:none;padding:0;font-size:18px}.rwa6qG_galleryRemove:hover{color:var(--dsw-alias-state-error);background:var(--dsw-alias-bg-layer-2)}@media (width<=1100px){.rwa6qG_galleryMasonry{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (width<=760px){.rwa6qG_studio{flex-direction:column;overflow:auto}.rwa6qG_config{width:auto;max-width:none;height:auto;min-height:0}.rwa6qG_config[data-gallery=true]{flex:none}.rwa6qG_canvas{min-height:560px}.rwa6qG_galleryToolbar{flex-direction:column;align-items:flex-start}.rwa6qG_galleryToolbarActions{flex-wrap:wrap;width:100%}.rwa6qG_galleryMasonry{grid-template-columns:1fr}}";
		const tagId$2 = "dsh-audiogen/panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-audiogen";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var panel_module_css_default = {
			"lightboxEdit": "rwa6qG_lightboxEdit",
			"canvas": "rwa6qG_canvas",
			"historyMain": "rwa6qG_historyMain",
			"studio": "rwa6qG_studio",
			"galleryTagFilterList": "rwa6qG_galleryTagFilterList",
			"taskTrayCount": "rwa6qG_taskTrayCount",
			"galleryAvatar": "rwa6qG_galleryAvatar",
			"canvasStateTitle": "rwa6qG_canvasStateTitle",
			"lightboxIndex": "rwa6qG_lightboxIndex",
			"paramHint": "rwa6qG_paramHint",
			"imageCard": "rwa6qG_imageCard",
			"galleryMasonry": "rwa6qG_galleryMasonry",
			"download": "rwa6qG_download",
			"gallerySelect": "rwa6qG_gallerySelect",
			"modelWrap": "rwa6qG_modelWrap",
			"configScroll": "rwa6qG_configScroll",
			"modelMenuList": "rwa6qG_modelMenuList",
			"entry": "rwa6qG_entry",
			"historyTitle": "rwa6qG_historyTitle",
			"generateInner": "rwa6qG_generateInner",
			"entryLabel": "rwa6qG_entryLabel",
			"uploadIcon": "rwa6qG_uploadIcon",
			"canvasState": "rwa6qG_canvasState",
			"galleryRatio": "rwa6qG_galleryRatio",
			"galleryWorkspace": "rwa6qG_galleryWorkspace",
			"compareToggle": "rwa6qG_compareToggle",
			"taskTrayToggle": "rwa6qG_taskTrayToggle",
			"galleryImage": "rwa6qG_galleryImage",
			"paramGroup": "rwa6qG_paramGroup",
			"spinner": "rwa6qG_spinner",
			"canvasEmptyIcon": "rwa6qG_canvasEmptyIcon",
			"modePill": "rwa6qG_modePill",
			"historyHeader": "rwa6qG_historyHeader",
			"canvasHistoryTag": "rwa6qG_canvasHistoryTag",
			"galleryFilterDivider": "rwa6qG_galleryFilterDivider",
			"comparisonGrid": "rwa6qG_comparisonGrid",
			"galleryToolbar": "rwa6qG_galleryToolbar",
			"galleryBulkButton": "rwa6qG_galleryBulkButton",
			"historyClear": "rwa6qG_historyClear",
			"galleryTagEditor": "rwa6qG_galleryTagEditor",
			"historyList": "rwa6qG_historyList",
			"modeRow": "rwa6qG_modeRow",
			"referenceActions": "rwa6qG_referenceActions",
			"comparisonBoard": "rwa6qG_comparisonBoard",
			"optionPill": "rwa6qG_optionPill",
			"historyActions": "rwa6qG_historyActions",
			"compareModelChoices": "rwa6qG_compareModelChoices",
			"modelMenuItem": "rwa6qG_modelMenuItem",
			"galleryImageButton": "rwa6qG_galleryImageButton",
			"prompt": "rwa6qG_prompt",
			"updateActions": "rwa6qG_updateActions",
			"lightbox": "rwa6qG_lightbox",
			"galleryTags": "rwa6qG_galleryTags",
			"historyEmpty": "rwa6qG_historyEmpty",
			"lightboxNav": "rwa6qG_lightboxNav",
			"galleryToolbarActions": "rwa6qG_galleryToolbarActions",
			"image": "rwa6qG_image",
			"historyFilters": "rwa6qG_historyFilters",
			"lightboxDownload": "rwa6qG_lightboxDownload",
			"optionGrid": "rwa6qG_optionGrid",
			"config": "rwa6qG_config",
			"taskPrompt": "rwa6qG_taskPrompt",
			"hiddenFile": "rwa6qG_hiddenFile",
			"canvasMeta": "rwa6qG_canvasMeta",
			"historyAction": "rwa6qG_historyAction",
			"galleryHeading": "rwa6qG_galleryHeading",
			"galleryCard": "rwa6qG_galleryCard",
			"galleryCardInfo": "rwa6qG_galleryCardInfo",
			"galleryTagInput": "rwa6qG_galleryTagInput",
			"gallerySort": "rwa6qG_gallerySort",
			"modelLabel": "rwa6qG_modelLabel",
			"templatesButton": "rwa6qG_templatesButton",
			"updateBanner": "rwa6qG_updateBanner",
			"comparisonFullscreen": "rwa6qG_comparisonFullscreen",
			"referenceImage": "rwa6qG_referenceImage",
			"configGuide": "rwa6qG_configGuide",
			"lightboxCaption": "rwa6qG_lightboxCaption",
			"comparisonImageButton": "rwa6qG_comparisonImageButton",
			"comparisonFullscreenGrid": "rwa6qG_comparisonFullscreenGrid",
			"lightboxImage": "rwa6qG_lightboxImage",
			"modelMenu": "rwa6qG_modelMenu",
			"optionRow": "rwa6qG_optionRow",
			"lightboxStage": "rwa6qG_lightboxStage",
			"lightboxCaptionRow": "rwa6qG_lightboxCaptionRow",
			"galleryCount": "rwa6qG_galleryCount",
			"gallerySelectionClear": "rwa6qG_gallerySelectionClear",
			"grid": "rwa6qG_grid",
			"galleryCardFooter": "rwa6qG_galleryCardFooter",
			"panelHeader": "rwa6qG_panelHeader",
			"paramLabel": "rwa6qG_paramLabel",
			"entryIcon": "rwa6qG_entryIcon",
			"taskRow": "rwa6qG_taskRow",
			"historyInfo": "rwa6qG_historyInfo",
			"galleryBadge": "rwa6qG_galleryBadge",
			"uploadBox": "rwa6qG_uploadBox",
			"historyItem": "rwa6qG_historyItem",
			"historyThumb": "rwa6qG_historyThumb",
			"lightboxClose": "rwa6qG_lightboxClose",
			"connectionDot": "rwa6qG_connectionDot",
			"galleryClear": "rwa6qG_galleryClear",
			"galleryRatioList": "rwa6qG_galleryRatioList",
			"panelTitle": "rwa6qG_panelTitle",
			"history": "rwa6qG_history",
			"historySearch": "rwa6qG_historySearch",
			"compareControl": "rwa6qG_compareControl",
			"galleryFilter": "rwa6qG_galleryFilter",
			"galleryFilterCount": "rwa6qG_galleryFilterCount",
			"galleryAdd": "rwa6qG_galleryAdd",
			"promptCount": "rwa6qG_promptCount",
			"promptFooter": "rwa6qG_promptFooter",
			"galleryTagFilter": "rwa6qG_galleryTagFilter",
			"lightboxMeta": "rwa6qG_lightboxMeta",
			"galleryFilterNote": "rwa6qG_galleryFilterNote",
			"gallerySelectionBar": "rwa6qG_gallerySelectionBar",
			"galleryTagEdit": "rwa6qG_galleryTagEdit",
			"lightboxScaleFrame": "rwa6qG_lightboxScaleFrame",
			"taskStatus": "rwa6qG_taskStatus",
			"gallerySearch": "rwa6qG_gallerySearch",
			"dshImageGenSpin": "rwa6qG_dshImageGenSpin",
			"taskTrayChevron": "rwa6qG_taskTrayChevron",
			"lightboxTool": "rwa6qG_lightboxTool",
			"updateText": "rwa6qG_updateText",
			"historyMeta": "rwa6qG_historyMeta",
			"dshImageGenToastIn": "rwa6qG_dshImageGenToastIn",
			"configGuideBody": "rwa6qG_configGuideBody",
			"bigSpinner": "rwa6qG_bigSpinner",
			"canvasStateHint": "rwa6qG_canvasStateHint",
			"lightboxCopy": "rwa6qG_lightboxCopy",
			"lightboxFigure": "rwa6qG_lightboxFigure",
			"taskRows": "rwa6qG_taskRows",
			"footer": "rwa6qG_footer",
			"galleryRemove": "rwa6qG_galleryRemove",
			"lightboxZoomLevel": "rwa6qG_lightboxZoomLevel",
			"connectionStatus": "rwa6qG_connectionStatus",
			"taskTrayHeader": "rwa6qG_taskTrayHeader",
			"lightboxActions": "rwa6qG_lightboxActions",
			"card": "rwa6qG_card",
			"githubLink": "rwa6qG_githubLink",
			"reference": "rwa6qG_reference",
			"galleryToast": "rwa6qG_galleryToast",
			"galleryFilterHeading": "rwa6qG_galleryFilterHeading",
			"lightboxTools": "rwa6qG_lightboxTools",
			"gallerySelectMode": "rwa6qG_gallerySelectMode",
			"taskTrayClose": "rwa6qG_taskTrayClose",
			"uploadHint": "rwa6qG_uploadHint",
			"panel": "rwa6qG_panel",
			"imageCaption": "rwa6qG_imageCaption",
			"canvasBody": "rwa6qG_canvasBody",
			"canvasError": "rwa6qG_canvasError",
			"galleryFilters": "rwa6qG_galleryFilters",
			"updateRelease": "rwa6qG_updateRelease",
			"zoomHint": "rwa6qG_zoomHint",
			"generateButton": "rwa6qG_generateButton",
			"panelHeading": "rwa6qG_panelHeading",
			"view": "rwa6qG_view",
			"historyPrompt": "rwa6qG_historyPrompt",
			"historyThumbPlaceholder": "rwa6qG_historyThumbPlaceholder",
			"enhanceButton": "rwa6qG_enhanceButton",
			"taskTray": "rwa6qG_taskTray",
			"modelSelect": "rwa6qG_modelSelect",
			"galleryViewToggle": "rwa6qG_galleryViewToggle"
		};
		//#endregion
		//#region src/client/mount.tsx
		/**
		* Panel view mounting for the AI 音频 panel.
		*
		* Like dsh-imagegen, the panel takes over the center column at the DOM level:
		* a container is appended inside the conversation grid item and a data
		* attribute on <html> hides/shows it.
		*/
		const CONVERSATION_COLUMN_SELECTOR = "[data-pane=\"conversation\"], [class*=\"centerCol\"]";
		const ACTIVE_ATTR = "data-dsh-audiogen-active";
		const OTHER_ACTIVE_ATTRS = [
			"data-dsh-taskboard-active",
			"data-dsh-ssh-active",
			"data-dsh-imagegen-active"
		];
		const ACTIVATE_EVENT = "dsh-panel-activate";
		const PANEL_NAME = "audiogen";
		function conversationColumn() {
			return document.querySelector(CONVERSATION_COLUMN_SELECTOR) ?? void 0;
		}
		function mountPanel(controller, api, scope) {
			let root;
			let container;
			const ensure = () => {
				if (container !== void 0) {
					if (container.isConnected) return;
					root?.unmount();
					root = void 0;
					container.remove();
					container = void 0;
				}
				const column = conversationColumn();
				if (column === void 0) return;
				container = document.createElement("div");
				container.dataset.dshAudiogenView = "";
				container.className = panel_module_css_default.view;
				column.appendChild(container);
				root = (0, react_dom_client.createRoot)(container);
				root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AudioGenPanel, {
					api,
					scope
				}));
			};
			const waitObserver = new MutationObserver(() => {
				ensure();
			});
			waitObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			const applyActive = () => {
				if (controller.getSnapshot().panelOpen) {
					for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr);
					document.documentElement.setAttribute(ACTIVE_ATTR, "");
					document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }));
				} else document.documentElement.removeAttribute(ACTIVE_ATTR);
			};
			const onOtherActivate = (event) => {
				const detail = event.detail;
				if ((detail === "ssh" || detail === "taskboard" || detail === "imagegen") && controller.getSnapshot().panelOpen) controller.close();
			};
			const SIDEBAR_ROW_SELECTOR = "[class*=\"sessionRow\"], [class*=\"projectRow\"], [class*=\"searchResultRow\"], [class*=\"searchResultWorkspace\"], [class*=\"newSession\"]";
			const onClickSidebarRow = (event) => {
				if (!controller.getSnapshot().panelOpen) return;
				const target = event.target;
				if (target === null) return;
				if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close();
			};
			document.addEventListener("click", onClickSidebarRow, true);
			document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
			const unsubscribe = controller.subscribe(applyActive);
			applyActive();
			ensure();
			return () => {
				document.removeEventListener("click", onClickSidebarRow, true);
				document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
				waitObserver.disconnect();
				unsubscribe();
				document.documentElement.removeAttribute(ACTIVE_ATTR);
				root?.unmount();
				root = void 0;
				container?.remove();
				container = void 0;
			};
		}
		//#endregion
		//#region src/client/sidebar-entry.ts
		const FAMILY_ENTRY_SELECTOR = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-imagegen-entry], [data-dsh-audiogen-entry]";
		function sidebarRoot() {
			const column = document.querySelector("[data-pane=\"sidebar\"], [class*=\"sidebarCol\"]");
			if (column === null) return void 0;
			return column.querySelector("[class*=\"logoRow\"]")?.parentElement ?? column.firstElementChild;
		}
		function newSessionButton(root) {
			const nested = root.querySelector("button[class*=\"newSession\"]");
			if (nested !== null) return nested;
			for (const child of root.children) if (child.tagName === "BUTTON") return child;
		}
		function createEntry(controller, label, tooltip) {
			const entry = document.createElement("button");
			entry.type = "button";
			entry.dataset.dshAudiogenEntry = "";
			entry.className = panel_module_css_default.entry;
			entry.setAttribute("aria-label", label);
			entry.setAttribute("title", tooltip);
			entry.innerHTML = "<span class=\"" + panel_module_css_default.entryIcon + "\"><svg viewBox=\"0 0 16 16\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 3.5h10v9H3z\"/><path d=\"M1.5 5.5v5\"/><path d=\"M14.5 5.5v5\"/><path d=\"M6 6.5l4 1.5-4 1.5z\"/></svg></span><span class=\"" + panel_module_css_default.entryLabel + "\">" + label + "</span>";
			entry.addEventListener("click", () => {
				controller.toggle();
			});
			return entry;
		}
		function placeEntry(root, entry) {
			const button = newSessionButton(root);
			if (button === void 0) return false;
			if (entry.parentElement !== root) {
				const row = button.closest("[class*=\"logoRow\"]");
				const base = row !== null && row.parentElement === root ? row : button;
				const family = Array.from(root.children).filter((el) => el instanceof HTMLElement && el.matches(FAMILY_ENTRY_SELECTOR));
				const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling;
				root.insertBefore(entry, anchor);
			}
			return true;
		}
		function mountSidebarEntry(controller, label, tooltip) {
			const entry = createEntry(controller, label, tooltip);
			let root;
			let placed = false;
			const tryPlace = () => {
				if (root !== void 0 && !root.isConnected) {
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				if (placed) {
					if (document.body.contains(entry)) return;
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				root ??= sidebarRoot();
				if (root === void 0) return;
				placed = placeEntry(root, entry);
				if (placed) rootObserver.observe(root, {
					childList: true,
					subtree: true
				});
			};
			const waitObserver = new MutationObserver(() => {
				tryPlace();
			});
			waitObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			const rootObserver = new MutationObserver(() => {
				if (root === void 0 || !root.isConnected) {
					placed = false;
					tryPlace();
					return;
				}
				if (!root.contains(entry)) placed = placeEntry(root, entry);
			});
			const syncActive = () => {
				if (controller.getSnapshot().panelOpen) entry.dataset.active = "true";
				else delete entry.dataset.active;
			};
			const unsubscribe = controller.subscribe(syncActive);
			syncActive();
			tryPlace();
			return () => {
				waitObserver.disconnect();
				rootObserver.disconnect();
				unsubscribe();
				entry.remove();
			};
		}
		//#endregion
		//#region src/client/settings-form.ts
		/**
		* Staged form model behind the plugin settings card. A card stages what the
		* user types and writes it only when they save — the settings write is a
		* durable, revision-fenced document mutation, so staging keeps what is on
		* screen exactly what a save would store. Self-contained slice of the same
		* pattern the dsh-web-ui family cards use (this package must not depend on a
		* sibling UI package).
		*/
		/** A free-text field. An empty draft clears the field. */
		function textField(field) {
			return {
				field,
				format: (value) => typeof value === "string" ? value : "",
				parse: (text) => {
					const trimmed = text.trim();
					return trimmed === "" ? { kind: "clear" } : {
						kind: "set",
						value: trimmed
					};
				}
			};
		}
		/** A boolean field, edited through true/false draft text. */
		function booleanField(field) {
			return {
				field,
				format: (value) => typeof value === "boolean" ? String(value) : "",
				parse: (text) => {
					if (text === "true") return {
						kind: "set",
						value: true
					};
					if (text === "false") return {
						kind: "set",
						value: false
					};
				}
			};
		}
		/**
		* Stages one card's edits over one settings scope and writes them on save.
		*
		* The Host is the only authority on whether a value was accepted — its
		* validators own the constraints no schema can express — so the outcome is
		* read back from the section rather than predicted here. A save that did not
		* land keeps its drafts, so the user can correct them instead of retyping.
		*/
		var CardForm = class {
			scope;
			options;
			specs;
			staged = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			saving = false;
			failed = false;
			/**
			* @param scope - the bound settings scope for this card's namespace.
			* @param specs - the fields this card edits.
			* @param options.secretSettled - for secret fields, whether the namespace
			*   currently holds a stored secret (the redacted view never round-trips the
			*   value, so a write's outcome is read from the secrets sidecar instead).
			*/
			constructor(scope, specs, options = {}) {
				this.scope = scope;
				this.options = options;
				this.specs = new Map(specs.map((spec) => [spec.field, spec]));
				scope.subscribe(() => {
					this.publish();
				});
			}
			/** Publish a projection of this form, rebuilt whenever the scope or a draft changes. */
			bind(project) {
				const store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(project());
				this.listeners.add(() => {
					store.set(project());
				});
				return store;
			}
			/** Read the card-level state: what the Host serves, and what a save would do. */
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status !== "loading",
					exposed: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: plan.length > 0,
					invalid: plan.some((item) => item.run === void 0),
					saving: this.saving,
					failed: this.failed
				};
			}
			/** Read one field's state from the effective section and its staged draft. */
			field(field) {
				const spec = this.specOf(field);
				const staged = this.staged.get(field);
				if (staged === void 0) return {
					text: spec.format(this.sectionValue(field)),
					overridden: this.stored(field),
					invalid: false
				};
				const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
				return {
					text: staged.text,
					overridden: write?.kind === "set",
					invalid: write === void 0 && !(spec.secret === true && staged.text.trim() === "")
				};
			}
			/** The actions the card's slot registration injects. */
			actions() {
				return {
					edit: (field, text) => {
						this.stage(field, {
							text,
							clear: false
						});
					},
					resetField: (field) => {
						this.stage(field, {
							text: this.specOf(field).format(this.baseValue(field)),
							clear: true
						});
					},
					save: () => {
						this.save();
					},
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.publish();
					}
				};
			}
			/**
			* Write every staged edit, then re-seed from what the Host accepted.
			* @returns settlement after every write and the read-back.
			*/
			async save() {
				const plan = this.plan();
				const writes = plan.flatMap((item) => item.run === void 0 ? [] : [item.run]);
				if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				for (const write of writes) landed = await write() && landed;
				if (landed) this.staged.clear();
				this.saving = false;
				this.failed = !landed;
				this.publish();
			}
			/**
			* Every staged edit a save would write. An entry whose draft is not a value
			* its field accepts carries no write: the form is still dirty, and the save
			* refuses rather than dropping the edit. A staged edit that matches the
			* effective section is not a write at all.
			*/
			plan() {
				const plan = [];
				for (const [field, staged] of this.staged) {
					const spec = this.specOf(field);
					if (staged.clear) {
						if (spec.secret === true ? this.options.secretSettled?.(field) ?? false : this.stored(field)) plan.push({
							field,
							run: () => this.clear(field)
						});
						continue;
					}
					if (staged.text === spec.format(this.sectionValue(field))) continue;
					const write = spec.parse(staged.text);
					if (write === void 0) plan.push({
						field,
						run: void 0
					});
					else if (write.kind === "clear") plan.push({
						field,
						run: () => this.clear(field)
					});
					else plan.push({
						field,
						run: () => this.store(field, write.value)
					});
				}
				return plan;
			}
			async clear(field) {
				await this.scope.unset(field);
				if (this.specOf(field).secret === true) return !(this.options.secretSettled?.(field) ?? false);
				return !this.stored(field);
			}
			async store(field, value) {
				await this.scope.set(field, value);
				if (this.specOf(field).secret === true) return this.options.secretSettled?.(field) ?? true;
				return this.userLayer()?.[field] === value;
			}
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.publish();
			}
			specOf(field) {
				const spec = this.specs.get(field);
				if (spec === void 0) throw new Error(`settings card has no field ${field}`);
				return spec;
			}
			snapshotOf() {
				return this.scope.getSnapshot();
			}
			sectionValue(field) {
				return this.snapshotOf().value?.[field];
			}
			baseValue(field) {
				return this.snapshotOf().base?.[field];
			}
			userLayer() {
				return this.snapshotOf().user;
			}
			stored(field) {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, field);
			}
			publish() {
				for (const listener of [...this.listeners]) listener();
			}
		};
		//#endregion
		//#region src/client/channels-form.ts
		/**
		* Staged form model for the channel list of the settings card. Mirrors the
		* CardForm staging pattern (dirty → one save) but for a structured value, so
		* the card can edit N channels, per-channel keys, and the default-channel
		* flag, then persist everything in one revision-fenced mutate call.
		*
		* Storage rules (dictated by dsh-settings semantics):
		*  - the whole `channels` array is written wholesale via `path: ['channels']`;
		*  - every channel's API key lives at `channelSecrets.<channelId>` (a secret
		*    dict), written per-key so untouched keys are never clobbered by a save
		*    the reader could not see (keys are redacted out of the wire view);
		*  - path ops never navigate *inside* the channels array.
		*/
		/** Deep equality over JSON-compatible data (the change predicate). */
		function deepEqualJson(a, b) {
			if (a === b) return true;
			if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
			if (Array.isArray(a) || Array.isArray(b)) {
				if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
				return a.every((entry, index) => deepEqualJson(entry, b[index]));
			}
			const left = a;
			const right = b;
			const keys = Object.keys(left);
			if (keys.length !== Object.keys(right).length) return false;
			return keys.every((key) => key in right && deepEqualJson(left[key], right[key]));
		}
		/** Trim and normalize a draft channel (models never carry empty aliases). */
		function stripChannel(channel) {
			const models = channel.models.map((model) => ({
				alias: model.alias.trim(),
				id: model.id.trim() === "" ? model.alias.trim() : model.id.trim(),
				...model.category === void 0 ? {} : { category: model.category }
			})).filter((model) => model.alias !== "");
			return {
				id: channel.id,
				preset: channel.preset,
				name: channel.name.trim(),
				apiUrl: channel.apiUrl.trim(),
				models: [...new Map(models.map((model) => [model.alias, model])).values()]
			};
		}
		var ChannelsForm = class {
			scope;
			stagedChannels = null;
			stagedKeys = /* @__PURE__ */ new Map();
			stagedDefault = null;
			listeners = /* @__PURE__ */ new Set();
			saving = false;
			failed = false;
			constructor(scope) {
				this.scope = scope;
				scope.subscribe(() => {
					this.publish();
				});
				scope.subscribeSecretSets(() => {
					this.publish();
				});
			}
			/** Publish a projection of this form, rebuilt on every scope or draft change. */
			bind(project) {
				const store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(project());
				this.listeners.add(() => {
					store.set(project());
				});
				return store;
			}
			/** Subscribe to staged and persisted channel changes. */
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			/** The staged channel list, or the scope value when nothing is staged. */
			channelsValue() {
				const view = this.scope.getSnapshot().value;
				return this.stagedChannels ?? (Array.isArray(view?.channels) ? view.channels.map(toDraft) : []);
			}
			/** Whether a channel currently holds a stored or staged secret. */
			keyHeld(id) {
				const edit = this.stagedKeys.get(id);
				if (edit !== void 0) return edit.kind === "set" && edit.value !== "";
				return this.scope.getSecretSetSnapshot(`channelSecrets.${id}`);
			}
			defaultValue() {
				if (this.stagedDefault !== null) return this.stagedDefault;
				const view = this.scope.getSnapshot().value;
				const channels = this.channelsValue();
				if (view?.defaultChannelId !== void 0 && channels.some((channel) => channel.id === view.defaultChannelId)) return view.defaultChannelId;
				return channels[0]?.id ?? "";
			}
			dirtyValue() {
				const channels = this.channelsValue();
				const stagedChanged = this.stagedChannels !== null && !deepEqualJson(this.stagedChannels, scopeChannelsOf(this.scope));
				const scopeDefault = this.scope.getSnapshot().value?.defaultChannelId ?? channels[0]?.id ?? "";
				const defaultChanged = this.stagedDefault !== null && this.stagedDefault !== scopeDefault;
				return stagedChanged || defaultChanged || this.stagedKeys.size > 0;
			}
			/** The card-facing snapshot. */
			snapshot() {
				const channels = this.channelsValue();
				const keySet = {};
				for (const channel of channels) keySet[channel.id] = this.keyHeld(channel.id);
				return {
					channels,
					keySet,
					defaultChannelId: this.defaultValue(),
					dirty: this.dirtyValue(),
					writable: this.scope.getSnapshot().writable !== false,
					saving: this.saving,
					failed: this.failed
				};
			}
			/** The actions the card's slot registration injects. */
			actions() {
				return {
					setChannels: (channels) => {
						this.stageChannels(channels);
					},
					setChannelKey: (id, value) => {
						this.stageKey(id, value);
					},
					setDefaultChannel: (id) => {
						this.stagedDefault = id;
						this.failed = false;
						this.publish();
					},
					commit: () => this.commit(),
					discard: () => {
						if (this.stagedChannels === null && this.stagedKeys.size === 0 && this.stagedDefault === null && !this.failed) return;
						this.stagedChannels = null;
						this.stagedKeys.clear();
						this.stagedDefault = null;
						this.failed = false;
						this.publish();
					}
				};
			}
			stageChannels(channels) {
				const cleaned = channels.map(stripChannel);
				this.stagedChannels = cleaned;
				this.failed = false;
				this.publish();
			}
			stageKey(id, value) {
				if (value === void 0 || value.trim() === "") {
					if (this.keyHeld(id)) this.stagedKeys.set(id, { kind: "clear" });
				} else this.stagedKeys.set(id, {
					kind: "set",
					value: value.trim()
				});
				this.failed = false;
				this.publish();
			}
			/** Build the single batch of path ops a save performs. */
			planOps() {
				const ops = [];
				if (this.stagedChannels !== null) {
					ops.push({
						op: "set",
						path: ["channels"],
						value: this.stagedChannels
					});
					ops.push({
						op: "unset",
						path: ["apiUrl"]
					});
					ops.push({
						op: "unset",
						path: ["apiKey"]
					});
					ops.push({
						op: "unset",
						path: ["imageModels"]
					});
				}
				for (const [id, edit] of this.stagedKeys) if (edit.kind === "set") ops.push({
					op: "set",
					path: ["channelSecrets", id],
					value: edit.value
				});
				else ops.push({
					op: "unset",
					path: ["channelSecrets", id]
				});
				if (this.stagedDefault !== null) ops.push({
					op: "set",
					path: ["defaultChannelId"],
					value: this.stagedDefault
				});
				return ops;
			}
			/**
			* Write every staged edit, then re-seed from what the Host accepted.
			* @returns settlement after the write settles.
			*/
			async commit() {
				if (this.saving) return;
				const ops = this.planOps();
				if (ops.length === 0) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				try {
					await this.scope.mutateOps(ops);
					this.stagedChannels = null;
					this.stagedKeys.clear();
					this.stagedDefault = null;
					this.failed = false;
				} catch {
					this.failed = true;
				} finally {
					this.saving = false;
					this.publish();
				}
			}
			publish() {
				for (const listener of [...this.listeners]) listener();
			}
		};
		/** Project a stored channel into a draft (secrets never travel in channels). */
		function toDraft(channel) {
			return {
				id: channel.id,
				preset: channel.preset,
				name: channel.name,
				apiUrl: channel.apiUrl,
				models: channel.models.map((model) => ({ ...model }))
			};
		}
		/** The scope's current channels value (a plain array), for change detection. */
		function scopeChannelsOf(scope) {
			const view = scope.getSnapshot().value;
			return Array.isArray(view?.channels) ? view.channels : [];
		}
		//#endregion
		//#region \0dsh-css:/Users/shimingming/Projects_code/dsh-audiogen/src/client/settings-card.module.css.mjs
		const css$1 = ".zmjoSq_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.zmjoSq_card:hover{border-color:var(--dsw-alias-label-dimmed)}.zmjoSq_card:has(.zmjoSq_body){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.zmjoSq_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.zmjoSq_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.zmjoSq_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.zmjoSq_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.zmjoSq_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.zmjoSq_chevron,.zmjoSq_chevronOpen{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.zmjoSq_chevronOpen{transform:rotate(180deg)}.zmjoSq_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.zmjoSq_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.zmjoSq_versionRow{border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:12px;padding:12px 0;display:flex}.zmjoSq_versionLabel{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}.zmjoSq_versionValue{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family-mono,monospace);border-radius:999px;padding:1px 8px;font-size:12px;line-height:1.5}.zmjoSq_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.zmjoSq_field+.zmjoSq_field{border-top:1px solid var(--dsw-alias-border-l2)}.zmjoSq_head{align-items:center;gap:8px;display:flex}.zmjoSq_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.zmjoSq_badges{align-items:center;gap:8px;display:inline-flex}.zmjoSq_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.zmjoSq_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.zmjoSq_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.zmjoSq_reset:disabled{cursor:default;opacity:.5}.zmjoSq_input,.zmjoSq_select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;outline:none;padding:0 12px;font-size:13px;line-height:1.5}.zmjoSq_input:focus-visible,.zmjoSq_select:focus-visible{border-color:var(--dsw-alias-brand-primary)}.zmjoSq_input:disabled,.zmjoSq_select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.zmjoSq_inputInvalid{border:1px solid var(--dsw-alias-label-error);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;outline:none;padding:0 12px;font-size:13px;line-height:1.5}.zmjoSq_textarea,.zmjoSq_textareaInvalid{resize:vertical;background:var(--dsw-alias-bg-layer-3);min-height:70px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;outline:none;padding:8px 12px;font-size:13px;line-height:1.5}.zmjoSq_textarea{border:1px solid var(--dsw-alias-border-l2)}.zmjoSq_textareaInvalid{border:1px solid var(--dsw-alias-label-error)}.zmjoSq_textarea:focus-visible{border-color:var(--dsw-alias-brand-primary)}.zmjoSq_textarea:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.zmjoSq_hint,.zmjoSq_invalid{margin:0;font-size:12px;line-height:1.5}.zmjoSq_hint{color:var(--dsw-alias-label-tertiary)}.zmjoSq_invalid{color:var(--dsw-alias-label-error)}.zmjoSq_readOnly,.zmjoSq_notExposed{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}.zmjoSq_sectionDivider{background:var(--dsw-alias-border-l2);height:1px;margin:18px 0 14px}.zmjoSq_sectionTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;line-height:1.4}.zmjoSq_sectionHint{color:var(--dsw-alias-label-tertiary);margin:-4px 0 2px;font-size:12px;line-height:1.5}.zmjoSq_modelSection{padding:2px 0 14px}.zmjoSq_sectionHeader{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.zmjoSq_sectionHeader .zmjoSq_sectionHint{max-width:430px}.zmjoSq_modelSummary{flex-wrap:wrap;align-items:center;gap:6px;margin-top:12px;display:flex}.zmjoSq_modelChip{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);max-width:100%;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-mono,monospace);border-radius:6px;align-items:center;gap:5px;padding:3px 5px 3px 8px;font-size:12px;line-height:1.5;display:inline-flex}.zmjoSq_modelChip>span{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.zmjoSq_modelChip button{appearance:none;width:18px;height:18px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:4px;padding:0;line-height:18px}.zmjoSq_modelChip button:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform)}.zmjoSq_modelChip button:disabled{cursor:default;opacity:.45}.zmjoSq_addModel{appearance:none;border:1px dashed var(--dsw-alias-border-l2);min-height:28px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:6px;padding:0 9px;font-size:12px}.zmjoSq_addModel:hover:not(:disabled){color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}.zmjoSq_addModel:disabled{opacity:.45;cursor:default}.zmjoSq_manualModelRow{gap:8px;margin-top:10px;display:flex}.zmjoSq_manualModelRow .zmjoSq_input{flex:1;min-width:0}.zmjoSq_disclosure{appearance:none;border:0;border-top:1px solid var(--dsw-alias-border-l2);width:100%;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;background:0 0;align-items:center;gap:8px;padding:13px 0;font-size:13px;font-weight:500;display:flex}.zmjoSq_disclosure>span:nth-child(2){color:var(--dsw-alias-label-tertiary);margin-left:auto;font-size:12px;font-weight:400}.zmjoSq_disclosure>span:last-child{color:var(--dsw-alias-label-tertiary)}.zmjoSq_disclosure:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.zmjoSq_optionalContent{padding:0 0 8px}.zmjoSq_inlineDisclosure{appearance:none;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;align-items:center;gap:6px;margin-top:12px;padding:0;font-size:12px;display:inline-flex}.zmjoSq_inlineDisclosure:hover{color:var(--dsw-alias-label-primary)}.zmjoSq_modelFetchRow{align-items:center;gap:8px;display:flex}.zmjoSq_modelFetch,.zmjoSq_modelChoices{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);min-height:32px;color:var(--dsw-alias-label-secondary);font:inherit;border-radius:7px;font-size:12px}.zmjoSq_modelFetch{cursor:pointer;padding:0 10px}.zmjoSq_modelFetch:hover:not(:disabled){color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}.zmjoSq_modelFetch:disabled{opacity:.5;cursor:default}.zmjoSq_modelChoices{flex:1;min-width:0;padding:0 8px}.zmjoSq_modelCandidateList{flex-wrap:wrap;gap:6px 10px;margin-top:10px;display:flex}.zmjoSq_modelCandidateLabel{width:100%;color:var(--dsw-alias-label-tertiary);font-size:12px}.zmjoSq_modelCandidate{appearance:none;min-width:0;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-3);font-size:12px;line-height:1.5;font:inherit;border:1px solid #0000;border-radius:5px;align-items:center;gap:5px;padding:3px 6px;display:inline-flex}.zmjoSq_modelCandidate input{margin:0}.zmjoSq_modelCandidate[data-selected]{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}.zmjoSq_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.zmjoSq_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}.zmjoSq_discard,.zmjoSq_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.zmjoSq_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.zmjoSq_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.zmjoSq_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.zmjoSq_discard:disabled,.zmjoSq_save:disabled{opacity:.4;cursor:default}.zmjoSq_discard:focus-visible,.zmjoSq_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}@media (prefers-reduced-motion:reduce){.zmjoSq_card,.zmjoSq_chevron,.zmjoSq_chevronOpen{transition:none}}.zmjoSq_channelSection{padding:6px 0 2px}.zmjoSq_channelEmpty{color:var(--dsw-alias-label-tertiary);margin:10px 0 0;font-size:12px;line-height:1.5}.zmjoSq_channelList{flex-direction:column;gap:6px;margin:10px 0 0;padding:0;list-style:none;display:flex}.zmjoSq_channelRow{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;align-items:center;gap:10px;padding:8px 10px;display:flex}.zmjoSq_channelRow[data-action]{flex-wrap:wrap}.zmjoSq_channelDotReady,.zmjoSq_channelDotWarn{border-radius:50%;flex:none;width:9px;height:9px}.zmjoSq_channelDotReady{background:var(--dsw-color-success,#2fbf71)}.zmjoSq_channelDotWarn{background:var(--dsw-color-danger,#e5484d)}.zmjoSq_channelMain{appearance:none;min-width:0;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;flex-direction:column;flex:1;gap:3px;padding:0;display:flex}.zmjoSq_channelName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:1.4;overflow:hidden}.zmjoSq_channelMeta{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}.zmjoSq_channelHost{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;font-family:var(--dsw-font-family-mono,monospace);text-overflow:ellipsis;white-space:nowrap;max-width:180px;overflow:hidden}.zmjoSq_channelBadge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:0 7px;font-size:11px;font-weight:500;line-height:17px}.zmjoSq_channelBadge[data-warn]{color:var(--dsw-alias-label-error)}.zmjoSq_channelBadge[data-default]{background:var(--dsw-alias-bg-module-poped,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-brand-primary)}.zmjoSq_channelAction{appearance:none;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;flex:none;padding:4px 8px;font-size:12px;line-height:1.5}.zmjoSq_channelAction:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform)}.zmjoSq_channelAction[data-danger]{color:var(--dsw-alias-label-error)}.zmjoSq_channelAction:disabled{opacity:.45;cursor:default}.zmjoSq_channelDanger{appearance:none;border:1px solid var(--dsw-alias-label-error);color:var(--dsw-alias-label-error);font:inherit;cursor:pointer;background:0 0;border-radius:6px;flex:none;padding:3px 10px;font-size:12px}.zmjoSq_channelDanger:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-label-error) 12%, transparent)}.zmjoSq_channelDanger:disabled{opacity:.45;cursor:default}.zmjoSq_deleteConfirmText{min-width:0;color:var(--dsw-alias-label-error);flex:1;font-size:12px;line-height:1.5}.zmjoSq_channelAddRow{gap:8px;margin-top:10px;display:flex}.zmjoSq_channelAdd{appearance:none;border:1px dashed var(--dsw-alias-border-l2);min-height:30px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;padding:0 12px;font-size:12px}.zmjoSq_channelAdd:hover:not(:disabled){color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}.zmjoSq_channelAdd:disabled{opacity:.45;cursor:default}.zmjoSq_spacer{flex:1}.zmjoSq_editorBackdrop{z-index:120;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#000) 45%, transparent);justify-content:center;align-items:flex-start;padding:9vh 16px 16px;display:flex;position:fixed;inset:0}.zmjoSq_editorPanel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:14px;width:min(560px,100%);max-height:82vh;padding:16px;overflow-y:auto;box-shadow:0 18px 50px #00000059}.zmjoSq_editorHeader{border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:10px;display:flex}.zmjoSq_editorClose{appearance:none;width:26px;height:26px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:6px;flex:none;font-size:16px;line-height:26px}.zmjoSq_editorClose:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform)}.zmjoSq_editorField{flex-direction:column;gap:6px;padding:12px 0 0;display:flex}.zmjoSq_editorDivider{background:var(--dsw-alias-border-l2);height:1px;margin:14px 0 4px}.zmjoSq_editorSectionHeader{justify-content:space-between;align-items:center;gap:12px;padding:10px 0 4px;display:flex}.zmjoSq_editorSectionHeader .zmjoSq_label{flex:1}.zmjoSq_editorTools{flex-direction:column;gap:8px;margin-top:10px;display:flex}.zmjoSq_editorFooter{border-top:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding-top:12px;display:flex}.zmjoSq_detectOk{color:var(--dsw-color-success,var(--dsw-alias-label-secondary));margin:0;font-size:12px;line-height:1.5}.zmjoSq_modelRows{flex-direction:column;gap:8px;margin:8px 0 0;padding:0;list-style:none;display:flex}.zmjoSq_modelRow{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;display:flex}.zmjoSq_modelRowInputs{flex:1;align-items:center;gap:6px;min-width:0;display:flex}.zmjoSq_modelRowInputs .zmjoSq_input{flex:1;min-width:0}.zmjoSq_modelArrow{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px}.zmjoSq_modelRowBadges{flex:none;align-items:center;gap:6px;display:flex}.zmjoSq_modelBadge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:0 7px;font-size:11px;line-height:17px}.zmjoSq_modelBadge[data-verified]{color:var(--dsw-color-success,var(--dsw-alias-label-secondary))}.zmjoSq_modelBadge[data-warn]{color:var(--dsw-alias-label-error)}.zmjoSq_modelRowRemove{appearance:none;width:20px;height:20px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:4px;flex:none;padding:0;line-height:20px}.zmjoSq_modelRowRemove:hover:not(:disabled){color:var(--dsw-alias-label-error);background:var(--dsw-alias-bg-module-platform)}.zmjoSq_modelRowRemove:disabled{opacity:.45;cursor:default}.zmjoSq_modelCandidate>.zmjoSq_modelBadge{flex:none}.zmjoSq_channelControls{position:relative}.zmjoSq_presetInline{z-index:10;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;width:min(420px,100vw - 48px);max-height:min(440px,60vh);margin:0;padding:12px;position:absolute;bottom:calc(100% + 8px);left:0;overflow-y:auto;box-shadow:0 12px 30px #0000004d}.zmjoSq_presetInlineHeader{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.zmjoSq_presetList{flex-direction:column;gap:8px;margin-top:12px;display:flex}.zmjoSq_presetRow{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:10px;flex-direction:column;align-items:flex-start;gap:3px;padding:10px 12px;display:flex}.zmjoSq_presetRow:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}.zmjoSq_presetRow[data-custom]{border-style:dashed}.zmjoSq_presetRow:disabled{opacity:.5;cursor:default}.zmjoSq_presetName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:1.4}.zmjoSq_presetMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;font-family:var(--dsw-font-family-mono,monospace)}.zmjoSq_presetHint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}";
		const tagId$1 = "dsh-audiogen/settings-card.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-audiogen";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var settings_card_module_css_default = {
			"head": "zmjoSq_head",
			"sectionHint": "zmjoSq_sectionHint",
			"modelRow": "zmjoSq_modelRow",
			"body": "zmjoSq_body",
			"modelArrow": "zmjoSq_modelArrow",
			"modelRowRemove": "zmjoSq_modelRowRemove",
			"channelAction": "zmjoSq_channelAction",
			"channelControls": "zmjoSq_channelControls",
			"presetInline": "zmjoSq_presetInline",
			"presetMeta": "zmjoSq_presetMeta",
			"presetName": "zmjoSq_presetName",
			"modelRows": "zmjoSq_modelRows",
			"reset": "zmjoSq_reset",
			"addModel": "zmjoSq_addModel",
			"sectionHeader": "zmjoSq_sectionHeader",
			"deleteConfirmText": "zmjoSq_deleteConfirmText",
			"input": "zmjoSq_input",
			"channelAddRow": "zmjoSq_channelAddRow",
			"hint": "zmjoSq_hint",
			"disclosure": "zmjoSq_disclosure",
			"editorPanel": "zmjoSq_editorPanel",
			"editorTools": "zmjoSq_editorTools",
			"modelBadge": "zmjoSq_modelBadge",
			"sectionDivider": "zmjoSq_sectionDivider",
			"field": "zmjoSq_field",
			"channelDotReady": "zmjoSq_channelDotReady",
			"presetInlineHeader": "zmjoSq_presetInlineHeader",
			"channelDotWarn": "zmjoSq_channelDotWarn",
			"presetList": "zmjoSq_presetList",
			"inputInvalid": "zmjoSq_inputInvalid",
			"spacer": "zmjoSq_spacer",
			"detectOk": "zmjoSq_detectOk",
			"card": "zmjoSq_card",
			"chevronOpen": "zmjoSq_chevronOpen",
			"invalid": "zmjoSq_invalid",
			"channelList": "zmjoSq_channelList",
			"textareaInvalid": "zmjoSq_textareaInvalid",
			"channelEmpty": "zmjoSq_channelEmpty",
			"channelRow": "zmjoSq_channelRow",
			"select": "zmjoSq_select",
			"badges": "zmjoSq_badges",
			"presetRow": "zmjoSq_presetRow",
			"editorClose": "zmjoSq_editorClose",
			"name": "zmjoSq_name",
			"versionRow": "zmjoSq_versionRow",
			"readOnly": "zmjoSq_readOnly",
			"manualModelRow": "zmjoSq_manualModelRow",
			"inlineDisclosure": "zmjoSq_inlineDisclosure",
			"pending": "zmjoSq_pending",
			"modelFetchRow": "zmjoSq_modelFetchRow",
			"badge": "zmjoSq_badge",
			"channelName": "zmjoSq_channelName",
			"editorBackdrop": "zmjoSq_editorBackdrop",
			"channelHost": "zmjoSq_channelHost",
			"modelRowInputs": "zmjoSq_modelRowInputs",
			"header": "zmjoSq_header",
			"modelCandidateLabel": "zmjoSq_modelCandidateLabel",
			"save": "zmjoSq_save",
			"channelBadge": "zmjoSq_channelBadge",
			"channelAdd": "zmjoSq_channelAdd",
			"footer": "zmjoSq_footer",
			"modelChip": "zmjoSq_modelChip",
			"modelCandidateList": "zmjoSq_modelCandidateList",
			"modelSummary": "zmjoSq_modelSummary",
			"editorField": "zmjoSq_editorField",
			"headText": "zmjoSq_headText",
			"editorDivider": "zmjoSq_editorDivider",
			"discard": "zmjoSq_discard",
			"modelFetch": "zmjoSq_modelFetch",
			"presetHint": "zmjoSq_presetHint",
			"description": "zmjoSq_description",
			"editorSectionHeader": "zmjoSq_editorSectionHeader",
			"optionalContent": "zmjoSq_optionalContent",
			"editorFooter": "zmjoSq_editorFooter",
			"channelMain": "zmjoSq_channelMain",
			"modelChoices": "zmjoSq_modelChoices",
			"label": "zmjoSq_label",
			"modelCandidate": "zmjoSq_modelCandidate",
			"notExposed": "zmjoSq_notExposed",
			"modelSection": "zmjoSq_modelSection",
			"modelRowBadges": "zmjoSq_modelRowBadges",
			"versionValue": "zmjoSq_versionValue",
			"sectionTitle": "zmjoSq_sectionTitle",
			"channelDanger": "zmjoSq_channelDanger",
			"channelSection": "zmjoSq_channelSection",
			"versionLabel": "zmjoSq_versionLabel",
			"textarea": "zmjoSq_textarea",
			"channelMeta": "zmjoSq_channelMeta",
			"editorHeader": "zmjoSq_editorHeader",
			"chevron": "zmjoSq_chevron",
			"failed": "zmjoSq_failed"
		};
		//#endregion
		//#region src/client/SettingsCard.tsx
		/**
		* The dsh-audiogen settings card.
		*
		* Registers into the official `settings.plugin.item` slot. It manages a list
		* of audio channels (each with API URL, per-channel secret, and model/voice
		* catalog), plus master switches.
		*/
		var AudioGenSettingsCardController = class {
			scope;
			form;
			channelsForm;
			constructor(scope) {
				this.scope = scope;
				this.form = new CardForm(scope, [
					booleanField("enabled"),
					booleanField("announceToAgent"),
					booleanField("allowAgentAudioGeneration"),
					textField("defaultModel")
				]);
				this.channelsForm = new ChannelsForm(scope);
			}
			projection() {
				const shell = this.form.shell();
				return {
					...shell,
					dirty: shell.dirty || this.channelsForm.snapshot().dirty,
					channels: this.channelsForm.snapshot(),
					enabled: this.form.field("enabled"),
					announceToAgent: this.form.field("announceToAgent"),
					allowAgentAudioGeneration: this.form.field("allowAgentAudioGeneration"),
					defaultModel: this.form.field("defaultModel")
				};
			}
			inject() {
				const cardStore = this.form.bind(() => this.projection());
				this.channelsForm.subscribe(() => {
					cardStore.set(this.projection());
				});
				return {
					hooks: { audioGenSettingsCard: cardStore },
					channels: this.channelsForm.actions(),
					...this.form.actions()
				};
			}
		};
		function newChannelDraft(preset, existing) {
			const id = `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
			if (preset === void 0) return {
				id,
				preset: "",
				name: "",
				apiUrl: "",
				models: []
			};
			return {
				id,
				preset: preset.id,
				name: preset.name,
				apiUrl: preset.apiUrl,
				models: preset.models.map((model) => ({ ...model }))
			};
		}
		function modelsToText(models) {
			return models.map((model) => `${model.alias}=${model.id}${model.category === void 0 ? "" : ` @${model.category}`}`).join("\n");
		}
		function textToModels(text) {
			return text.split(/\n|,/).map((line) => line.trim()).filter(Boolean).map((line) => {
				const at = line.lastIndexOf(" @");
				const category = at >= 0 ? line.slice(at + 2).trim() : void 0;
				const body = at >= 0 ? line.slice(0, at).trim() : line;
				const eq = body.indexOf("=");
				const alias = eq >= 0 ? body.slice(0, eq).trim() : body.trim();
				const id = eq >= 0 ? body.slice(eq + 1).trim() : alias;
				return {
					alias,
					id: id === "" ? alias : id,
					...category === void 0 || category === "" ? {} : { category }
				};
			}).filter((model) => model.alias !== "");
		}
		function AudioGenSettingsCard(props) {
			const { t } = props;
			const state = props.useAudioGenSettingsCard((snapshot) => snapshot);
			const [open, setOpen] = (0, react.useState)(false);
			const [editingId, setEditingId] = (0, react.useState)(null);
			const [presetPickerOpen, setPresetPickerOpen] = (0, react.useState)(false);
			const [presets, setPresets] = (0, react.useState)([]);
			const [presetError, setPresetError] = (0, react.useState)(null);
			const [confirmDeleteId, setConfirmDeleteId] = (0, react.useState)(null);
			const [discovering, setDiscovering] = (0, react.useState)(false);
			const [discoverError, setDiscoverError] = (0, react.useState)(null);
			const [editName, setEditName] = (0, react.useState)("");
			const [editUrl, setEditUrl] = (0, react.useState)("");
			const [editKey, setEditKey] = (0, react.useState)("");
			const [editModels, setEditModels] = (0, react.useState)("");
			const [editDefault, setEditDefault] = (0, react.useState)(false);
			const channels = state.channels.channels;
			const editing = editingId === null ? void 0 : channels.find((channel) => channel.id === editingId);
			(0, react.useEffect)(() => {
				if (editing === void 0) return;
				setEditName(editing.name);
				setEditUrl(editing.apiUrl);
				setEditKey("");
				setEditModels(modelsToText(editing.models));
				setEditDefault(editing.id === state.channels.defaultChannelId);
			}, [editingId, editing?.id]);
			if (!state.available) return null;
			const blocked = !state.dirty || state.invalid || state.saving || state.channels.saving;
			const saveEdit = () => {
				if (editingId === null) return;
				const existing = channels.find((channel) => channel.id === editingId);
				const models = textToModels(editModels);
				const updated = {
					id: editingId,
					preset: existing?.preset ?? "",
					name: editName.trim(),
					apiUrl: editUrl.trim(),
					models
				};
				const next = existing === void 0 ? [...channels, updated] : channels.map((channel) => channel.id === editingId ? updated : channel);
				props.channels.setChannels(next);
				if (editKey.trim() !== "") props.channels.setChannelKey(editingId, editKey.trim());
				if (editDefault) props.channels.setDefaultChannel(editingId);
				setEditingId(null);
			};
			const discoverModels = async () => {
				if (editingId === null) return;
				setDiscovering(true);
				setDiscoverError(null);
				try {
					channels.find((channel) => channel.id === editingId);
					const response = await fetch(MODEL_API.discover, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							channelId: editingId,
							...editUrl.trim() !== "" ? { apiUrl: editUrl.trim() } : {},
							...editKey.trim() !== "" ? { apiKey: editKey.trim() } : {}
						})
					});
					const body = await response.json();
					if (body.ok !== true || body.models === void 0) throw new Error(body.message ?? `HTTP ${response.status}`);
					setEditModels(modelsToText([...body.models, ...textToModels(editModels).filter((existingModel) => !body.models.some((model) => model.id === existingModel.id))]));
				} catch (error) {
					setDiscoverError(error instanceof Error ? error.message : String(error));
				} finally {
					setDiscovering(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: settings_card_module_css_default.card,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: settings_card_module_css_default.header,
					"aria-expanded": open,
					"aria-label": `${t(open ? "settings.collapse" : "settings.expand")}: ${t("settings.title")}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: settings_card_module_css_default.headText,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: settings_card_module_css_default.name,
								children: t("settings.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: settings_card_module_css_default.description,
								children: t("settings.description")
							})]
						}),
						state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.pending,
							children: t("settings.unsaved")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: open ? settings_card_module_css_default.chevronOpen : settings_card_module_css_default.chevron,
							children: "▾"
						})
					]
				}), !open ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: settings_card_module_css_default.body,
					children: [
						!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: settings_card_module_css_default.readOnly,
							role: "status",
							children: t("settings.readOnly")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: settings_card_module_css_default.channelSection,
							"aria-label": t("channels.title"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: settings_card_module_css_default.sectionHeader,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										className: settings_card_module_css_default.sectionTitle,
										children: t("channels.title")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: settings_card_module_css_default.sectionHint,
										children: t("channels.hint")
									})] })
								}),
								channels.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: settings_card_module_css_default.channelEmpty,
									children: t("channels.empty")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: settings_card_module_css_default.channelList,
									children: channels.map((channel) => {
										const keyHeld = state.channels.keySet[channel.id] === true;
										const ready = keyHeld && channel.models.length > 0;
										const isDefault = channel.id === state.channels.defaultChannelId;
										if (confirmDeleteId === channel.id) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
											className: settings_card_module_css_default.channelRow,
											"data-action": true,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: settings_card_module_css_default.deleteConfirmText,
													children: [
														t("channels.confirm"),
														": ",
														channel.name || t("channels.untitled")
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: settings_card_module_css_default.channelDanger,
													disabled: !state.writable,
													onClick: () => {
														props.channels.setChannels(channels.filter((candidate) => candidate.id !== channel.id));
														if (isDefault && channels.length > 1) {
															const next = channels.find((candidate) => candidate.id !== channel.id);
															if (next !== void 0) props.channels.setDefaultChannel(next.id);
														}
														setConfirmDeleteId(null);
														if (editingId === channel.id) setEditingId(null);
													},
													children: t("channels.confirm")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: settings_card_module_css_default.channelAction,
													onClick: () => setConfirmDeleteId(null),
													children: t("channels.cancel")
												})
											]
										}, channel.id);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
											className: settings_card_module_css_default.channelRow,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ready ? settings_card_module_css_default.channelDotReady : settings_card_module_css_default.channelDotWarn,
													"aria-hidden": "true",
													title: t(ready ? "channels.statusReady" : "channels.statusIncomplete")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: settings_card_module_css_default.channelMain,
													disabled: !state.writable,
													onClick: () => setEditingId(channel.id),
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: settings_card_module_css_default.channelName,
														children: isDefault ? `★ ${channel.name || t("channels.untitled")}` : channel.name || t("channels.untitled")
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: settings_card_module_css_default.channelMeta,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: settings_card_module_css_default.channelHost,
															children: channel.apiUrl || "(no url)"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
															className: settings_card_module_css_default.channelBadge,
															"data-warn": !keyHeld || channel.models.length === 0 ? "" : void 0,
															children: [
																keyHeld ? t("channels.keySet") : t("channels.keyMissing"),
																" · ",
																channel.models.length > 0 ? t("channels.modelCount", { n: channel.models.length }) : t("channels.noModels")
															]
														})]
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: settings_card_module_css_default.channelAction,
													onClick: () => setEditingId(channel.id),
													children: t("channels.edit")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: settings_card_module_css_default.channelAction,
													"data-danger": true,
													onClick: () => setConfirmDeleteId(channel.id),
													children: t("channels.delete")
												})
											]
										}, channel.id);
									})
								}),
								presetPickerOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: settings_card_module_css_default.channelControls,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: settings_card_module_css_default.sectionHint,
											children: t("presets.title")
										}),
										presetError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: settings_card_module_css_default.failed,
											children: presetError
										}) : null,
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: settings_card_module_css_default.channelAddRow,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: settings_card_module_css_default.channelAdd,
													onClick: () => {
														setPresets([]);
														setPresetError(null);
														fetch(PRESETS_API, { method: "POST" }).then(async (response) => {
															const body = await response.json();
															if (!response.ok || body.ok !== true || body.presets === void 0) throw new Error(body.message ?? `HTTP ${response.status}`);
															setPresets(body.presets);
														}).catch((error) => setPresetError(error instanceof Error ? error.message : String(error)));
													},
													children: t("channels.addProvider")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: settings_card_module_css_default.channelAdd,
													onClick: () => {
														const draft = newChannelDraft(void 0, channels);
														props.channels.setChannels([...channels, draft]);
														setPresetPickerOpen(false);
														setEditingId(draft.id);
													},
													children: t("channels.addCustom")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: settings_card_module_css_default.channelAction,
													onClick: () => setPresetPickerOpen(false),
													children: "×"
												})
											]
										}),
										presets.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: settings_card_module_css_default.channelAdd,
											onClick: () => {
												const draft = newChannelDraft(preset, channels);
												props.channels.setChannels([...channels, draft]);
												setPresetPickerOpen(false);
												setEditingId(draft.id);
											},
											children: [
												preset.name,
												" — ",
												preset.hint
											]
										}, preset.id))
									]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: settings_card_module_css_default.channelAddRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: settings_card_module_css_default.channelAdd,
										disabled: !state.writable,
										onClick: () => {
											setPresetError(null);
											setPresetPickerOpen(true);
										},
										children: t("channels.addProvider")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: settings_card_module_css_default.channelAdd,
										disabled: !state.writable,
										onClick: () => {
											const draft = newChannelDraft(void 0, channels);
											props.channels.setChannels([...channels, draft]);
											setEditingId(draft.id);
										},
										children: t("channels.addCustom")
									})]
								})
							]
						}),
						editing !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: settings_card_module_css_default.body,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: settings_card_module_css_default.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: settings_card_module_css_default.label,
										htmlFor: `audiogen-name-${editing.id}`,
										children: t("channel.name")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: `audiogen-name-${editing.id}`,
										className: settings_card_module_css_default.input,
										value: editName,
										onChange: (event) => setEditName(event.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: settings_card_module_css_default.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: settings_card_module_css_default.label,
										htmlFor: `audiogen-url-${editing.id}`,
										children: t("channel.apiUrl")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: `audiogen-url-${editing.id}`,
										className: settings_card_module_css_default.input,
										value: editUrl,
										onChange: (event) => setEditUrl(event.target.value),
										placeholder: "https://…"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: settings_card_module_css_default.field,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											className: settings_card_module_css_default.label,
											htmlFor: `audiogen-key-${editing.id}`,
											children: t("channel.apiKey")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											id: `audiogen-key-${editing.id}`,
											className: settings_card_module_css_default.input,
											type: "password",
											value: editKey,
											onChange: (event) => setEditKey(event.target.value),
											placeholder: state.channels.keySet[editing.id] ? "••••••" : ""
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: settings_card_module_css_default.sectionHint,
											children: t("channel.apiKeyHint")
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: settings_card_module_css_default.field,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											className: settings_card_module_css_default.label,
											htmlFor: `audiogen-models-${editing.id}`,
											children: t("channel.models")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
											id: `audiogen-models-${editing.id}`,
											className: settings_card_module_css_default.textarea,
											value: editModels,
											onChange: (event) => setEditModels(event.target.value)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: settings_card_module_css_default.sectionHint,
											children: t("channel.modelsHint")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: settings_card_module_css_default.channelAddRow,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: settings_card_module_css_default.channelAdd,
												disabled: discovering || !state.writable,
												onClick: () => void discoverModels(),
												children: discovering ? "获取中…" : "获取可用模型"
											})
										}),
										discoverError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: settings_card_module_css_default.failed,
											children: discoverError
										}) : null
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: settings_card_module_css_default.label,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: editDefault,
											onChange: (event) => setEditDefault(event.target.checked)
										}),
										" ",
										t("channel.default")
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: settings_card_module_css_default.footer,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: settings_card_module_css_default.discard,
										onClick: () => setEditingId(null),
										children: t("channel.cancel")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: settings_card_module_css_default.save,
										onClick: saveEdit,
										children: t("channel.save")
									})]
								})
							]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: settings_card_module_css_default.field,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: settings_card_module_css_default.label,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: state.enabled.text === "true" || state.enabled.text === "",
										disabled: !state.writable,
										onChange: (event) => props.edit("enabled", String(event.target.checked))
									}),
									" ",
									t("settings.enabled")
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: settings_card_module_css_default.field,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: settings_card_module_css_default.label,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: state.announceToAgent.text === "true" || state.announceToAgent.text === "",
										disabled: !state.writable,
										onChange: (event) => props.edit("announceToAgent", String(event.target.checked))
									}),
									" ",
									t("settings.announceToAgent")
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: settings_card_module_css_default.field,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: settings_card_module_css_default.label,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: state.allowAgentAudioGeneration.text === "true" || state.allowAgentAudioGeneration.text === "",
										disabled: !state.writable,
										onChange: (event) => props.edit("allowAgentAudioGeneration", String(event.target.checked))
									}),
									" ",
									t("settings.allowAgentAudio")
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: settings_card_module_css_default.footer,
							children: [
								state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: settings_card_module_css_default.failed,
									children: "保存失败"
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.discard,
									disabled: !state.dirty || state.saving,
									onClick: () => props.discard(),
									children: t("settings.discard")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.save,
									disabled: blocked,
									onClick: () => {
										props.save();
										props.channels.commit();
									},
									children: state.saving ? t("settings.saving") : t("settings.save")
								})
							]
						})
					]
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/shimingming/Projects_code/dsh-audiogen/src/client/audio-toolview.module.css.mjs
		const css = "._7K1QKa_root{border:1px solid var(--dsw-color-border,#e5e7eb);background:var(--dsw-color-surface,#fff);border-radius:10px;min-width:0;padding:10px 12px;display:block}._7K1QKa_header{align-items:center;gap:8px;font-weight:600;display:flex}._7K1QKa_icon{color:var(--dsw-alias-label-secondary,#6b7280)}._7K1QKa_status{color:var(--dsw-alias-label-caption,#9ca3af);margin-left:auto;font-size:12px;font-weight:400}._7K1QKa_message{color:var(--dsw-alias-label-secondary,#6b7280);white-space:pre-wrap;margin:6px 0 0;font-size:13px}._7K1QKa_error{color:#b91c1c;margin:6px 0 0}._7K1QKa_audios{gap:8px;margin-top:8px;display:grid}._7K1QKa_audioRow{align-items:center;gap:8px;display:flex}._7K1QKa_audio{flex:1;width:100%;min-width:0;height:36px}._7K1QKa_download{color:#2563eb;white-space:nowrap;font-size:12px;text-decoration:none}._7K1QKa_empty{color:var(--dsw-alias-label-caption,#9ca3af);font-size:13px}";
		const tagId = "dsh-audiogen/audio-toolview.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-audiogen";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var audio_toolview_module_css_default = {
			"root": "_7K1QKa_root",
			"message": "_7K1QKa_message",
			"audioRow": "_7K1QKa_audioRow",
			"download": "_7K1QKa_download",
			"error": "_7K1QKa_error",
			"audios": "_7K1QKa_audios",
			"audio": "_7K1QKa_audio",
			"empty": "_7K1QKa_empty",
			"status": "_7K1QKa_status",
			"icon": "_7K1QKa_icon",
			"header": "_7K1QKa_header"
		};
		//#endregion
		//#region src/client/audio-toolview.tsx
		function isSettled(block) {
			return typeof block === "object" && block !== null && "content" in block;
		}
		function textOf(block) {
			if (!isSettled(block)) return "";
			return (block.content ?? []).filter((content) => content.type === "text" && typeof content.text === "string").map((content) => content.text).join("\n");
		}
		function parseResult(block) {
			const text = textOf(block);
			if (text === "") return {
				status: "running",
				message: "正在生成音频…",
				audio: []
			};
			try {
				const parsed = JSON.parse(text);
				return {
					status: parsed.status ?? "completed",
					message: parsed.message ?? "",
					audio: Array.isArray(parsed.audio) ? parsed.audio.filter((item) => {
						return typeof item === "object" && item !== null && typeof item.url === "string";
					}) : [],
					...typeof parsed.error === "string" ? { error: parsed.error } : {}
				};
			} catch {
				return {
					status: "completed",
					message: text,
					audio: []
				};
			}
		}
		function statusLabel(status) {
			if (status === "running" || status === "queued") return "生成中";
			if (status === "failed") return "生成失败";
			if (status === "cancelled") return "已取消";
			return "音频结果";
		}
		function mimeExt(mime) {
			if (mime.includes("wav")) return "wav";
			if (mime.includes("flac")) return "flac";
			if (mime.includes("ogg")) return "ogg";
			if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
			return "mp3";
		}
		function registerAudioToolviews(ctx) {
			const AudioToolView = (props) => {
				const result = (0, react.useMemo)(() => parseResult(props.block), [props.block]);
				const [active, setActive] = (0, react.useState)(null);
				(0, react.useEffect)(() => {
					setActive(null);
				}, [props.callId]);
				const title = props.toolName === "generate_audio" ? "生成音频" : props.toolName;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: audio_toolview_module_css_default.root,
					"data-state": result.status,
					"data-tool": props.toolName,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: audio_toolview_module_css_default.header,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: audio_toolview_module_css_default.icon,
									"aria-hidden": "true",
									children: "♫"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: title }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: audio_toolview_module_css_default.status,
									children: statusLabel(result.status)
								})
							]
						}),
						result.message !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: audio_toolview_module_css_default.message,
							children: result.message
						}),
						result.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: audio_toolview_module_css_default.error,
							children: result.error
						}),
						result.audio.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: audio_toolview_module_css_default.audios,
							children: result.audio.map((audio, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: audio_toolview_module_css_default.audioRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("audio", {
									className: audio_toolview_module_css_default.audio,
									controls: true,
									preload: "metadata",
									src: audio.url,
									onPlay: () => setActive(audio.url)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									className: audio_toolview_module_css_default.download,
									href: audio.url,
									download: `generated-${index + 1}.${mimeExt(audio.mime)}`,
									children: "下载"
								})]
							}, audio.id ?? audio.url))
						}),
						result.audio.length === 0 && result.status !== "running" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: audio_toolview_module_css_default.empty,
							children: "未返回可播放的音频。"
						})
					]
				});
			};
			ctx.slots.inject("tool.call.toolview", function* () {
				yield ctx.slots.register({
					name: "tool.call.toolview",
					key: "generate_audio"
				}, AudioToolView);
			});
		}
		//#endregion
		//#region src/client/index.ts
		const NS = "dsh-audiogen";
		const inject = [
			"slots",
			"locale",
			"connection",
			"sessions"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-audiogen: dictionaries");
			registerAudioToolviews(ctx);
			const scope = bindAudiogenScope(ctx.get("connection")?.isLoopback === true ? (input, init) => fetch(input, init) : () => {
				throw new Error("settings bridge is loopback-only");
			});
			ctx.effect(() => {
				const disposers = [ctx.on("connection/reset", () => {
					scope.load();
				})];
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "dsh-audiogen: settings scope invalidation");
			const settingsCard = new AudioGenSettingsCardController(scope);
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "dsh-audiogen",
				locale: NS,
				inject: () => settingsCard.inject()
			}, AudioGenSettingsCard));
			let uiDisposer;
			const mountUi = () => {
				if (uiDisposer !== void 0) return;
				const controller = new AudioGenController();
				const api = new AudiogenApi();
				const disposers = [];
				try {
					disposers.push(mountSidebarEntry(controller, tt("entry.label"), tt("entry.tooltip")));
					disposers.push(mountPanel(controller, api, scope));
				} catch (error) {
					console.warn("[dsh-audiogen] mount failed:", error);
				}
				uiDisposer = () => {
					for (const dispose of disposers.splice(0)) dispose();
					uiDisposer = void 0;
				};
			};
			const syncEnabled = () => {
				const snapshot = scope.getSnapshot();
				if (snapshot.status === "ready" ? snapshot.value?.enabled ?? true : snapshot.status === "unavailable") mountUi();
				else uiDisposer?.();
			};
			scope.subscribe(syncEnabled);
			syncEnabled();
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map