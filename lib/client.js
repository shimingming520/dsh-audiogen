window.__ModuleLoader__.load({
	id: "dsh-audiogen",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_dom_client = require("react-dom/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		//#region src/protocol.ts
		/** Same-origin route family (loopback-only, mirroring dsh-imagegen). */
		const SETTINGS_API = {
			describe: "/api/dsh-audiogen/settings/describe",
			mutate: "/api/dsh-audiogen/settings/mutate"
		};
		/** The audio-generation proxy route. */
		const GENERATE_API = "/api/dsh-audiogen/generate";
		/** Loopback-only task cancellation route (aborts the host-side upstream call). */
		const TASK_API = { cancel: "/api/dsh-audiogen/task/cancel" };
		/** Loopback-only prompt enhancement route (uses the agent's default model). */
		const ENHANCE_API = "/api/dsh-audiogen/prompt/enhance";
		/** Host-mediated built-in provider catalog (channels the user can instantiate). */
		const PRESETS_API = "/api/dsh-audiogen/presets";
		/** LLM 模型目录：提示词增强模型的候选（来自「设置 → 模型」各提供方）。 */
		const LLM_MODELS_API = "/api/dsh-audiogen/llm/models";
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
		/** Host-persisted resource-library routes. */
		const LIBRARY_API = {
			list: "/api/dsh-audiogen/library/list",
			save: "/api/dsh-audiogen/library/save",
			update: "/api/dsh-audiogen/library/update",
			remove: "/api/dsh-audiogen/library/remove",
			audio: "/api/dsh-audiogen/library/audio"
		};
		//#endregion
		//#region src/client/api.ts
		/**
		* Browser-side API client for the audio generation, history and
		* resource-library routes.
		*/
		/** POST helper: the host API requires the JSON content type on every POST. */
		function postJson(path, body, signal) {
			return fetch(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				...signal === void 0 ? {} : { signal }
			});
		}
		var AudiogenApi = class {
			async generate(request, signal) {
				return await (await postJson(GENERATE_API, {
					...request,
					taskId: request.taskId
				}, signal)).json();
			}
			/** 取消进行中的任务：宿主侧中断全部在途上游调用，剩余模型跳过。 */
			async cancelTask(taskId) {
				await postJson(TASK_API.cancel, { taskId }).catch(() => {});
			}
			/** 提示词增强（复用 Agent 默认模型）。 */
			async enhancePrompt(prompt, mode) {
				const body = await (await postJson(ENHANCE_API, {
					prompt,
					mode
				})).json();
				return {
					ok: body.ok === true,
					...body.enhanced === void 0 ? {} : { enhanced: body.enhanced },
					...body.code === void 0 ? {} : { code: body.code },
					...body.message === void 0 ? {} : { message: body.message }
				};
			}
			async history() {
				const body = await (await postJson(HISTORY_API.list, {})).json();
				return body.ok === true ? body.history ?? [] : [];
			}
			/** 删除一条历史记录（返回删后的列表）。 */
			async removeHistory(id) {
				const body = await (await postJson(HISTORY_API.remove, { id })).json();
				return body.ok === true ? body.history ?? [] : [];
			}
			async clearHistory() {
				await postJson(HISTORY_API.clear, {});
			}
			async libraryList() {
				const body = await (await postJson(LIBRARY_API.list, {})).json();
				return body.ok === true ? body.entries ?? [] : [];
			}
			async librarySave(request) {
				const body = await (await postJson(LIBRARY_API.save, request)).json();
				return {
					ok: body.ok === true,
					...body.entry === void 0 ? {} : { entry: body.entry },
					...body.message === void 0 ? {} : { message: body.message }
				};
			}
			async libraryUpdate(request) {
				const body = await (await postJson(LIBRARY_API.update, request)).json();
				return {
					ok: body.ok === true,
					...body.entry === void 0 ? {} : { entry: body.entry },
					...body.message === void 0 ? {} : { message: body.message }
				};
			}
			async libraryRemove(ids) {
				return { ok: (await (await postJson(LIBRARY_API.remove, { ids })).json()).ok === true };
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
			"tab.studio": "生成",
			"tab.library": "资源库",
			"mode.tts": "文本转语音",
			"mode.music": "音乐生成",
			"mode.sfx": "音效生成",
			"mode.voiceDesign": "音色设计",
			"prompt.placeholder": "输入文本、音乐/音效描述，或音色设计描述…",
			"prompt.required": "请输入文本或提示词",
			"model.label": "模型",
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
			"settings.autoSaveLibrary": "生成后自动保存到资源库",
			"settings.maxConcurrent": "最大并发生成数（同时打到上游的请求数，默认 5）",
			"settings.enhanceModel": "提示词增强模型（LLM）",
			"settings.enhanceModelDefault": "跟随 Agent 默认模型（设置 → 模型）",
			"settings.enhanceModelHint": "用于「✨ 增强提示词」与 generate_audio 的 enhance_prompt 参数；留空则使用「设置 → 模型」中的默认模型。",
			"settings.enhanceModelFailed": "模型列表加载失败",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.discard": "放弃修改",
			"settings.unsaved": "有未保存的修改",
			"settings.readOnly": "当前设置为只读。",
			"channels.title": "音频渠道",
			"channels.hint": "每个渠道是一个独立的音频厂商/API 端点，可配置多个。",
			"channels.empty": "还没有渠道。",
			"channels.addProvider": "+ 添加提供方",
			"channels.addProviderLoading": "加载提供方…",
			"channels.addProviderFailed": "提供方目录加载失败，请点击重试。",
			"channels.addCustom": "+ 添加自定义提供方",
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
			"channel.title": "渠道设置",
			"channel.editTitle": "编辑渠道",
			"channel.provider": "提供方",
			"channel.providerCustom": "自定义渠道",
			"channel.providerCustomHint": "任意 OpenAI 兼容 TTS 或通用音频 POST 接口",
			"channel.site": "官网",
			"channel.name": "名称",
			"channel.namePlaceholder": "渠道名称（如：MiniMax 主渠道）",
			"channel.apiUrl": "API 地址",
			"channel.apiUrlPlaceholder": "提供方默认地址",
			"channel.apiUrlHint": "留空使用提供方默认地址。",
			"channel.apiKey": "API 密钥",
			"channel.apiKeyHint": "输入 API 密钥后即可使用该渠道。",
			"channel.apiKeyStoredHint": "已保存密钥；留空保持不变，输入新值可更换。",
			"channel.clearKey": "清除密钥",
			"channel.customSettings": "自定义设置",
			"channel.modelsTitle": "模型 / 音色目录",
			"channel.modelsCount": "{n} 个模型/音色",
			"channel.modelsNone": "未添加",
			"channel.modelsEmpty": "尚未添加模型/音色：面板与 Agent 将无可选模型；保存后仍可直接输入目录外的 ID 进行生成。",
			"channel.modelAlias": "显示名称",
			"channel.modelId": "上游 ID",
			"channel.modelCategory": "分类",
			"channel.category.auto": "自动",
			"channel.category.tts": "语音",
			"channel.category.music": "音乐",
			"channel.category.sfx": "音效",
			"channel.category.voice_design": "音色设计",
			"channel.category.voice_clone": "音色克隆",
			"channel.category.stableDual": "音乐 + 音效（自动）",
			"channel.category.stableDualHint": "Stable Audio 模型按模型名自动识别为音乐+音效，无需设置分类。",
			"channel.addModel": "添加模型",
			"channel.removeModel": "移除",
			"channel.fetchModels": "获取可用模型",
			"channel.fetchingModels": "获取中…",
			"channel.discoverNeedsUrlKey": "填写 API 地址与密钥后可获取模型",
			"channel.fetchEmpty": "未发现音频相关模型。",
			"channel.discoverSource": "来源：{source}",
			"channel.candidates": "发现 {n} 个可用模型/音色",
			"channel.stabilityHint": "Stable Audio 模型（stable-audio-*）同时适用于「音乐生成」与「音效生成」，面板按模型名自动识别；分类仅影响默认展示。官方不支持 TTS。",
			"channel.selectAll": "全选",
			"channel.clearSelection": "清空",
			"channel.adoptSelected": "添加所选（{n}）",
			"channel.default": "设为默认渠道",
			"channel.cancel": "取消",
			"channel.save": "保存渠道"
		};
		const en = {
			"entry.label": "AI Audio",
			"entry.tooltip": "AI audio panel (TTS / music / SFX)",
			"panel.title": "AI Audio",
			"tab.studio": "Studio",
			"tab.library": "Library",
			"mode.tts": "Text to speech",
			"mode.music": "Music",
			"mode.sfx": "Sound effects",
			"mode.voiceDesign": "Voice design",
			"prompt.placeholder": "Text to speak, or a music/SFX/voice-design description…",
			"prompt.required": "Prompt or text is required",
			"model.label": "Model",
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
			"settings.autoSaveLibrary": "Auto-save generated audio to the library",
			"settings.maxConcurrent": "Max concurrent generations (in-flight upstream calls, default 5)",
			"settings.enhanceModel": "Prompt enhance model (LLM)",
			"settings.enhanceModelDefault": "Follow the agent default model (Settings → Models)",
			"settings.enhanceModelHint": "Used by \"✨ Enhance prompt\" and the generate_audio enhance_prompt parameter; empty follows the default model in Settings → Models.",
			"settings.enhanceModelFailed": "Failed to load the model list",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.discard": "Discard",
			"settings.unsaved": "Unsaved changes",
			"settings.readOnly": "Settings are read-only.",
			"channels.title": "Audio channels",
			"channels.hint": "Each channel is an independent audio vendor/API endpoint.",
			"channels.empty": "No channels yet.",
			"channels.addProvider": "+ Add provider",
			"channels.addProviderLoading": "Loading providers…",
			"channels.addProviderFailed": "Failed to load the provider catalog. Click to retry.",
			"channels.addCustom": "+ Add custom provider",
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
			"channel.title": "Channel settings",
			"channel.editTitle": "Edit channel",
			"channel.provider": "Provider",
			"channel.providerCustom": "Custom provider",
			"channel.providerCustomHint": "Any OpenAI-compatible TTS or generic audio POST endpoint",
			"channel.site": "Website",
			"channel.name": "Name",
			"channel.namePlaceholder": "Channel name (e.g. MiniMax main)",
			"channel.apiUrl": "API URL",
			"channel.apiUrlPlaceholder": "Provider default",
			"channel.apiUrlHint": "Leave blank to use the provider default.",
			"channel.apiKey": "API key",
			"channel.apiKeyHint": "Enter the API key to use this channel.",
			"channel.apiKeyStoredHint": "A key is stored; leave blank to keep it, or enter a new one.",
			"channel.clearKey": "Clear key",
			"channel.customSettings": "Custom settings",
			"channel.modelsTitle": "Model / voice catalog",
			"channel.modelsCount": "{n} model(s)/voice(s)",
			"channel.modelsNone": "None",
			"channel.modelsEmpty": "No models yet: the panel and agents will have nothing to pick. You can still send an ID outside the catalog after saving.",
			"channel.modelAlias": "Display name",
			"channel.modelId": "Upstream ID",
			"channel.modelCategory": "Category",
			"channel.category.auto": "Auto",
			"channel.category.tts": "Speech",
			"channel.category.music": "Music",
			"channel.category.sfx": "SFX",
			"channel.category.voice_design": "Voice design",
			"channel.category.voice_clone": "Voice clone",
			"channel.category.stableDual": "Music + SFX (auto)",
			"channel.category.stableDualHint": "Stable Audio models are auto-detected as Music + SFX by model name; no category needed.",
			"channel.addModel": "Add model",
			"channel.removeModel": "Remove",
			"channel.fetchModels": "Fetch available models",
			"channel.fetchingModels": "Fetching…",
			"channel.discoverNeedsUrlKey": "Fill in the API URL and key to fetch models",
			"channel.fetchEmpty": "No audio-related models found.",
			"channel.discoverSource": "Source: {source}",
			"channel.candidates": "{n} available model(s)/voice(s) found",
			"channel.stabilityHint": "Stable Audio models (stable-audio-*) apply to both Music and SFX; the panel detects them by model name. The category only affects the default display. Official API does not support TTS.",
			"channel.selectAll": "Select all",
			"channel.clearSelection": "Clear",
			"channel.adoptSelected": "Add selected ({n})",
			"channel.default": "Set as default channel",
			"channel.cancel": "Cancel",
			"channel.save": "Save channel"
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
		//#region src/client/icons.tsx
		function Svg(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "1em",
				height: "1em",
				viewBox: props.viewBox ?? "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: props.children
			});
		}
		function PlayIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Svg, {
				viewBox: "0 0 16 16",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5 3.2v9.6a.6.6 0 0 0 .9.5l7.5-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z",
					fill: "currentColor",
					stroke: "none"
				})
			});
		}
		function PauseIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				viewBox: "0 0 16 16",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "4.2",
					y: "2.8",
					width: "2.6",
					height: "10.4",
					rx: "0.9",
					fill: "currentColor",
					stroke: "none"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "9.2",
					y: "2.8",
					width: "2.6",
					height: "10.4",
					rx: "0.9",
					fill: "currentColor",
					stroke: "none"
				})]
			});
		}
		function StarIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Svg, {
				viewBox: "0 0 16 16",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 1.9l1.8 3.7 4.1.6-3 2.9.7 4.1L8 11.2l-3.6 1.9.7-4.1-3-2.9 4.1-.6L8 1.9Z",
					fill: props.filled === true ? "currentColor" : "none"
				})
			});
		}
		function DownloadIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				viewBox: "0 0 16 16",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 2.5v7M8 9.5l-2.6-2.6M8 9.5l2.6-2.6" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2.8 10.8v1.7a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.7" })]
			});
		}
		function TrashIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Svg, {
				viewBox: "0 0 16 16",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 4.4h10M6.2 2.9h3.6M5.2 4.4l.5 8a1 1 0 0 0 1 .9h2.6a1 1 0 0 0 1-.9l.5-8" })
			});
		}
		function SearchIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				viewBox: "0 0 16 16",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "7",
					cy: "7",
					r: "4.2"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m10.2 10.2 3 3" })]
			});
		}
		function CopyIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				viewBox: "0 0 16 16",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "5.4",
					y: "5.4",
					width: "7.4",
					height: "7.4",
					rx: "1.2"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10.6 5.4V4a1.2 1.2 0 0 0-1.2-1.2H4A1.2 1.2 0 0 0 2.8 4v5.4A1.2 1.2 0 0 0 4 10.6h1.4" })]
			});
		}
		function CheckIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Svg, {
				viewBox: "0 0 16 16",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m3.2 8.4 3.1 3.1L12.8 4.9" })
			});
		}
		function VolumeIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				viewBox: "0 0 16 16",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2.8 6.2v3.6h2.4l3 2.6V3.6l-3 2.6H2.8Z",
					fill: "currentColor",
					stroke: "none"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12 4.2a5.6 5.6 0 0 1 0 7.6" })]
			});
		}
		function MuteIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				viewBox: "0 0 16 16",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2.8 6.2v3.6h2.4l3 2.6V3.6l-3 2.6H2.8Z",
					fill: "currentColor",
					stroke: "none"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m10.4 6.2 3.2 3.6M13.6 6.2l-3.2 3.6" })]
			});
		}
		function MicIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				viewBox: "0 0 16 16",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "5.8",
					y: "2",
					width: "4.4",
					height: "7.2",
					rx: "2.2"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.2 8a4.8 4.8 0 0 0 9.6 0M8 12.8V14" })]
			});
		}
		function MusicNoteIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				viewBox: "0 0 16 16",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6.2 12.6V4l6-1.4v8.6" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "4.7",
						cy: "12.6",
						r: "1.7"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "10.7",
						cy: "11.2",
						r: "1.7"
					})
				]
			});
		}
		function WaveIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Svg, {
				viewBox: "0 0 16 16",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2 6h1M4.5 3.5v9M7.2 2v12M9.9 4v8M12.6 5.5v5M14.5 6.5v3" })
			});
		}
		function GridIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				viewBox: "0 0 16 16",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "2.5",
						y: "2.5",
						width: "4.6",
						height: "4.6",
						rx: "1"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "8.9",
						y: "2.5",
						width: "4.6",
						height: "4.6",
						rx: "1"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "2.5",
						y: "8.9",
						width: "4.6",
						height: "4.6",
						rx: "1"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "8.9",
						y: "8.9",
						width: "4.6",
						height: "4.6",
						rx: "1"
					})
				]
			});
		}
		function ListIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Svg, {
				viewBox: "0 0 16 16",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5.4 4.2h8.2M5.4 8h8.2M5.4 11.8h8.2" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "2.8",
						cy: "4.2",
						r: "0.8",
						fill: "currentColor",
						stroke: "none"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "2.8",
						cy: "8",
						r: "0.8",
						fill: "currentColor",
						stroke: "none"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "2.8",
						cy: "11.8",
						r: "0.8",
						fill: "currentColor",
						stroke: "none"
					})
				]
			});
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
						...model.category === void 0 ? {} : { category: model.category },
						channelId: channel.id,
						channelName: channel.name,
						preset: channel.preset
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
		//#region src/client/field-specs.ts
		const PRESET_MINIMAX = "minimax";
		const PRESET_ELEVENLABS = "elevenlabs";
		const PRESET_STABILITY = "stability-audio";
		/** 各 preset 支持的音乐输出格式（交集用于全局字段）。 */
		const MUSIC_FORMATS = {
			[PRESET_MINIMAX]: [
				"mp3",
				"wav",
				"pcm"
			],
			[PRESET_ELEVENLABS]: ["mp3", "wav"],
			[PRESET_STABILITY]: ["mp3", "wav"]
		};
		const MUSIC_KEYS = [
			"duration",
			"format",
			"lyrics",
			"instrumental",
			"sampleRate",
			"bitrate"
		];
		const TTS_KEYS = [
			"voice",
			"speed",
			"format",
			"emotion",
			"vol",
			"pitch",
			"toneText",
			"sampleRate",
			"bitrate",
			"audioChannel",
			"subtitle"
		];
		const SFX_KEYS = [
			"duration",
			"format",
			"loop",
			"promptInfluence",
			"seed",
			"steps",
			"cfgScale"
		];
		function presetSupports(preset, key, mode) {
			const p = preset.toLowerCase();
			if (!(MUSIC_KEYS.includes(key) ? MUSIC_KEYS : TTS_KEYS.includes(key) ? TTS_KEYS : SFX_KEYS).includes(key)) return true;
			switch (key) {
				case "lyrics":
				case "instrumental": return p === PRESET_MINIMAX || p === PRESET_ELEVENLABS;
				case "sampleRate":
				case "bitrate":
				case "audioChannel": return p === PRESET_MINIMAX;
				case "emotion":
				case "vol":
				case "pitch":
				case "toneText":
				case "subtitle": return p === PRESET_MINIMAX;
				case "loop":
				case "promptInfluence": return p === PRESET_ELEVENLABS;
				case "seed":
				case "steps":
				case "cfgScale": return p === PRESET_STABILITY;
				default: return true;
			}
		}
		const SPECS = {
			duration: {
				label: "时长（秒）",
				type: "number",
				min: 1,
				max: 200,
				placeholder: "30",
				hint: "MiniMax 音乐最长 190 秒；ElevenLabs 音乐 3-600 秒（自动换算）；Stability 音频按模型 190 或 380 秒"
			},
			format: {
				label: "输出格式",
				type: "select",
				options: [
					"mp3",
					"wav",
					"pcm",
					"flac",
					"ogg"
				],
				hint: "可选格式：MiniMax 为 mp3 / wav / pcm；ElevenLabs 与 Stability 为 mp3 / wav"
			},
			lyrics: {
				label: "歌词（纯音乐模式可留空；多段用空行分隔）",
				type: "text",
				placeholder: "第一段歌词…\n\n第二段歌词…",
				hint: "歌词与提示词分开；勾选纯音乐后无需填写，适用于 MiniMax 与 ElevenLabs 音乐"
			},
			instrumental: {
				label: "纯音乐（无歌词/人声）",
				type: "checkbox",
				hint: "勾选后无需填写歌词即可生成；仅 MiniMax 与 ElevenLabs 音乐支持"
			},
			sampleRate: {
				label: "采样率",
				type: "select",
				options: [
					"16000",
					"24000",
					"32000",
					"44100"
				],
				placeholder: "默认（44100）",
				hint: "MiniMax 可选 16000 / 24000 / 32000 / 44100"
			},
			bitrate: {
				label: "码率",
				type: "select",
				options: [
					"32000",
					"64000",
					"128000",
					"256000"
				],
				placeholder: "默认（256000）",
				hint: "MiniMax 可选 32000 / 64000 / 128000 / 256000"
			},
			audioChannel: {
				label: "声道",
				type: "select",
				options: ["1", "2"],
				placeholder: "默认(1)",
				hint: "MiniMax 语音支持 1 或 2 声道"
			},
			voice: {
				label: "音色",
				type: "text",
				placeholder: "自定义音色",
				hint: "MiniMax 必填官方音色 ID；ElevenLabs 可填音色名"
			},
			speed: {
				label: "语速",
				type: "number",
				min: .5,
				max: 2,
				step: .1,
				placeholder: "1.0",
				hint: "MiniMax 语音语速，范围 0.5-2 倍，默认 1"
			},
			emotion: {
				label: "情绪",
				type: "text",
				placeholder: "happy / sad / angry / nervous…",
				hint: "MiniMax 语音情绪，如 happy / sad / angry / nervous / fearful / bored，默认按音色本身",
				advanced: true
			},
			vol: {
				label: "音量（0-10）",
				type: "number",
				min: 0,
				max: 10,
				step: .5,
				placeholder: "1",
				hint: "MiniMax 语音音量，范围 0-10，默认 1",
				advanced: true
			},
			pitch: {
				label: "音调（-12~12 半音）",
				type: "number",
				min: -12,
				max: 12,
				placeholder: "0",
				hint: "MiniMax 语音音调偏移，范围 -12~12 半音，默认 0",
				advanced: true
			},
			toneText: {
				label: "发音词典（每行一条：\"文字/读音\"）",
				type: "text",
				placeholder: "处理/(chu3)(li3)\n危险/dangerous",
				hint: "MiniMax 朗读读音定制，每行一条，如：危险/dangerous",
				advanced: true
			},
			subtitle: {
				label: "生成字幕",
				type: "checkbox",
				hint: "勾选后返回 MiniMax 语音的字幕内容/文件",
				advanced: true
			},
			loop: {
				label: "循环音效（无缝循环）",
				type: "checkbox",
				hint: "ElevenLabs 音效无缝循环，仅音效模型支持"
			},
			promptInfluence: {
				label: "提示词影响度（0-1）",
				type: "number",
				min: 0,
				max: 1,
				step: .1,
				placeholder: "0.3",
				hint: "ElevenLabs 音效提示词影响度，范围 0-1，越高越贴提示词；默认 0.3"
			},
			seed: {
				label: "随机种子",
				type: "number",
				min: 0,
				max: 4294967294,
				placeholder: "默认（随机）",
				hint: "Stability 音频随机种子，相同种子与参数可复现；默认 0（随机）"
			},
			steps: {
				label: "采样步数",
				type: "number",
				min: 4,
				max: 100,
				placeholder: "默认",
				hint: "Stability 音频采样步数：stable-audio-2 为 30-100；2.5 / 3 为 4-8"
			},
			cfgScale: {
				label: "提示词遵循度",
				type: "number",
				min: 1,
				max: 25,
				placeholder: "默认",
				hint: "Stability 音频提示词遵循度，范围 1-25；stable-audio-2 默认 7，2.5 / 3 默认 1"
			}
		};
		function specOf(key, presets) {
			return {
				key,
				...SPECS[key],
				...presets === void 0 ? {} : { presets }
			};
		}
		/** 当前模式 + 所选模型集合（渠道集合）对应的「全局字段」清单。 */
		function globalFieldSpecs(mode, presets) {
			const list = [];
			const all = (key, keys) => keys.includes(key) && presets.every((preset) => presetSupports(preset, key, mode));
			if (mode === "tts") {
				list.push(specOf("voice"), specOf("speed"));
				list.push({
					...specOf("format"),
					options: [
						"mp3",
						"wav",
						"flac",
						"ogg",
						"pcm"
					]
				});
				const advanced = [
					"emotion",
					"vol",
					"pitch",
					"toneText",
					"sampleRate",
					"bitrate",
					"audioChannel",
					"subtitle"
				].filter((key) => all(key, TTS_KEYS) && presets.length > 0);
				for (const key of advanced) list.push(specOf(key));
			} else if (mode === "music") {
				list.push(specOf("duration"));
				const supported = presets.length === 0 ? [[
					"mp3",
					"wav",
					"pcm"
				]] : presets.map((preset) => MUSIC_FORMATS[preset.toLowerCase()] ?? ["mp3", "wav"]);
				const intersect = supported.reduce((acc, cur) => acc.filter((item) => cur.includes(item)), supported[0] ?? ["mp3", "wav"]);
				list.push({
					...specOf("format"),
					options: intersect.length > 0 ? intersect : ["mp3", "wav"]
				});
				if (all("lyrics", MUSIC_KEYS) && presets.length > 0) list.push(specOf("lyrics"));
				if (all("instrumental", MUSIC_KEYS) && presets.length > 0) list.push(specOf("instrumental"));
				if (all("sampleRate", MUSIC_KEYS) && presets.length > 0) list.push(specOf("sampleRate"));
				if (all("bitrate", MUSIC_KEYS) && presets.length > 0) list.push(specOf("bitrate"));
			} else if (mode === "sfx") {
				list.push(specOf("duration"));
				list.push({
					...specOf("format"),
					options: [
						"mp3",
						"wav",
						"pcm"
					]
				});
				if (all("loop", SFX_KEYS) && presets.length > 0) list.push(specOf("loop"));
				if (all("promptInfluence", SFX_KEYS) && presets.length > 0) list.push(specOf("promptInfluence"));
				if (all("seed", SFX_KEYS) && presets.length > 0) list.push(specOf("seed"), specOf("steps"), specOf("cfgScale"));
			}
			return list;
		}
		/** 「每模型参数覆盖」矩阵的字段全集（含适用渠道标注）。 */
		function overrideRowSpecs(mode) {
			const rows = [];
			const presets = [
				["format", [
					PRESET_MINIMAX,
					PRESET_ELEVENLABS,
					PRESET_STABILITY
				]],
				["duration", [
					PRESET_MINIMAX,
					PRESET_ELEVENLABS,
					PRESET_STABILITY
				]],
				["voice", [PRESET_MINIMAX, PRESET_ELEVENLABS]],
				["speed", [PRESET_MINIMAX, PRESET_ELEVENLABS]],
				["lyrics", [PRESET_MINIMAX, PRESET_ELEVENLABS]],
				["instrumental", [PRESET_MINIMAX, PRESET_ELEVENLABS]],
				["sampleRate", [PRESET_MINIMAX]],
				["bitrate", [PRESET_MINIMAX]],
				["audioChannel", [PRESET_MINIMAX]],
				["emotion", [PRESET_MINIMAX]],
				["vol", [PRESET_MINIMAX]],
				["pitch", [PRESET_MINIMAX]],
				["toneText", [PRESET_MINIMAX]],
				["subtitle", [PRESET_MINIMAX]],
				["loop", [PRESET_ELEVENLABS]],
				["promptInfluence", [PRESET_ELEVENLABS]],
				["seed", [PRESET_STABILITY]],
				["steps", [PRESET_STABILITY]],
				["cfgScale", [PRESET_STABILITY]]
			];
			for (const [key, applicable] of presets) {
				const spec = specOf(key, applicable);
				rows.push({
					...spec,
					presets: applicable
				});
			}
			return rows;
		}
		/** 渠道 preset 的展示名。 */
		function presetLabel(preset) {
			if (preset === PRESET_MINIMAX) return "MiniMax";
			if (preset === PRESET_ELEVENLABS) return "ElevenLabs";
			if (preset === PRESET_STABILITY) return "Stability";
			if (preset === "openai-tts") return "OpenAI";
			return "自定义";
		}
		//#endregion
		//#region \0dsh-css:/Users/shimingming/Projects_code/dsh-audiogen/src/client/audio-panel.module.css.mjs
		const css$4 = ".Oo1fpq_panel{background:var(--dsw-alias-bg-base,#f7f7f8);min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary,#1f2328);font-family:var(--dsw-font-family,system-ui, sans-serif);flex-direction:column;gap:12px;padding:14px 16px 16px;display:flex;position:relative}.Oo1fpq_panel,.Oo1fpq_panel *,.Oo1fpq_panel :before,.Oo1fpq_panel :after{box-sizing:border-box}.Oo1fpq_header{flex:none;justify-content:space-between;align-items:center;gap:12px;display:flex}.Oo1fpq_title{color:var(--dsw-alias-label-primary,#1f2328);white-space:nowrap;margin:0;font-size:16px;font-weight:700}.Oo1fpq_tabs{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-radius:10px;align-items:center;gap:2px;padding:3px;display:inline-flex}.Oo1fpq_tab{min-height:27px;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;background:0 0;border:0;border-radius:8px;align-items:center;gap:6px;padding:0 12px;font-family:inherit;font-size:12.5px;transition:color .12s,background .12s;display:inline-flex}.Oo1fpq_tab:hover{color:var(--dsw-alias-label-primary,#1f2328)}.Oo1fpq_tab[data-active=true]{color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-layer-1,#fff);font-weight:600;box-shadow:0 1px 3px #0000001a}.Oo1fpq_studio{flex:1;gap:14px;min-width:0;min-height:0;display:flex}.Oo1fpq_formCol{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;flex-direction:column;flex:none;gap:11px;width:380px;min-width:320px;max-width:440px;min-height:0;padding:2px;display:flex;overflow-y:auto}.Oo1fpq_formCol::-webkit-scrollbar{width:8px}.Oo1fpq_formCol::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}.Oo1fpq_modeRow{flex-wrap:wrap;gap:6px;display:flex}.Oo1fpq_modeButton{border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-1,#fff);min-width:0;min-height:34px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;cursor:pointer;border-radius:9px;flex:auto;justify-content:center;align-items:center;padding:6px 10px;font-family:inherit;font-size:11.5px;transition:border-color .12s,color .12s,background .12s;display:flex}.Oo1fpq_modeButton:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af);color:var(--dsw-alias-label-primary,#1f2328)}.Oo1fpq_modeButton[data-active=true]{border-color:var(--dsw-alias-brand-primary,#2563eb);color:var(--dsw-alias-brand-primary,#2563eb);background:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 8%, transparent);font-weight:600}.Oo1fpq_label{color:var(--dsw-alias-label-secondary,#6b7280);flex-direction:column;gap:5px;font-size:12px;font-weight:600;display:flex}.Oo1fpq_input,.Oo1fpq_textarea{border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-2,#fff);width:100%;min-height:36px;color:var(--dsw-alias-label-primary,#1f2328);border-radius:9px;outline:none;padding:7px 10px;font-family:inherit;font-size:13px;transition:border-color .12s,box-shadow .12s}.Oo1fpq_input:focus,.Oo1fpq_textarea:focus{border-color:var(--dsw-alias-brand-primary,#2563eb);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 14%, transparent)}.Oo1fpq_textarea{resize:vertical;min-height:96px}.Oo1fpq_checkbox{color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;align-items:center;gap:7px;font-size:12px;font-weight:600;display:flex}.Oo1fpq_checkbox input{accent-color:var(--dsw-alias-brand-primary,#2563eb);margin:0}.Oo1fpq_hint{color:var(--dsw-alias-label-tertiary,#9ca3af);margin:0;font-size:11.5px;line-height:1.55}.Oo1fpq_row{align-items:flex-end;gap:8px;display:flex}.Oo1fpq_row .Oo1fpq_label{flex:1;min-width:0}.Oo1fpq_advanced{border:1px dashed var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;flex-direction:column;gap:9px;padding:9px 11px;display:flex}.Oo1fpq_advanced summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;font-weight:600}.Oo1fpq_generate{background:var(--dsw-alias-label-primary,#1f2328);color:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;border:0;border-radius:10px;padding:10px 14px;font-family:inherit;font-size:13px;font-weight:600;transition:opacity .12s,transform 80ms}.Oo1fpq_generate:hover:not(:disabled){opacity:.92}.Oo1fpq_generate:active:not(:disabled){transform:translateY(1px)}.Oo1fpq_generate:disabled{opacity:.5;cursor:default}.Oo1fpq_resultCol{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;border-radius:12px;flex-direction:column;flex:1;gap:10px;min-width:0;max-width:760px;padding:14px;display:flex;overflow-y:auto}.Oo1fpq_resultCol::-webkit-scrollbar{width:8px}.Oo1fpq_resultCol::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}.Oo1fpq_resultEmpty{text-align:center;color:var(--dsw-alias-label-secondary,#6b7280);flex-direction:column;flex:1;justify-content:center;align-items:center;gap:6px;font-size:13px;display:flex}.Oo1fpq_resultEmptyIcon{background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-radius:50%;justify-content:center;align-items:center;width:52px;height:52px;margin-bottom:4px;font-size:24px;display:inline-flex}.Oo1fpq_resultEmptyHint{color:var(--dsw-alias-label-tertiary,#9ca3af);margin:0;font-size:11.5px}.Oo1fpq_error{border:1px solid var(--dsw-alias-label-error,#b91c1c);background:color-mix(in srgb, var(--dsw-alias-label-error,#b91c1c) 6%, transparent);color:var(--dsw-alias-label-error,#b91c1c);border-radius:9px;flex:none;margin:0;padding:9px 12px;font-size:12.5px;line-height:1.55}.Oo1fpq_resultMeta{color:var(--dsw-alias-label-tertiary,#9ca3af);flex:none;align-items:center;gap:8px;font-size:12px;display:flex}.Oo1fpq_resultModeChip{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-secondary,#6b7280);border-radius:999px;padding:2px 9px;font-size:11px}.Oo1fpq_audioList{gap:10px;display:grid}.Oo1fpq_audioCard{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f7f8);border-radius:12px;flex-direction:column;gap:8px;padding:12px;transition:border-color .12s;display:flex}.Oo1fpq_audioCard[data-saved=true]{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 42%, var(--dsw-alias-border-l1,#e5e7eb));background:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 5%, var(--dsw-alias-bg-layer-2,#f7f7f8))}.Oo1fpq_audioCardHead{flex-wrap:wrap;align-items:center;gap:6px;min-width:0;display:flex}.Oo1fpq_voiceIdChip{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);max-width:100%;color:var(--dsw-alias-label-secondary,#6b7280);text-overflow:ellipsis;white-space:nowrap;border-radius:999px;padding:2px 9px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;overflow:hidden}.Oo1fpq_savedChip{background:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 12%, transparent);color:var(--dsw-alias-brand-primary,#2563eb);border-radius:999px;align-items:center;gap:5px;padding:2px 9px;font-size:11px;font-weight:600;display:inline-flex}.Oo1fpq_audioCardIndex{color:var(--dsw-alias-label-tertiary,#9ca3af);font-variant-numeric:tabular-nums;margin-left:auto;font-size:11px}.Oo1fpq_audioCardActions{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.Oo1fpq_ghostButton{border:1px solid var(--dsw-alias-border-l2,#d1d5db);min-height:27px;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;background:0 0;border-radius:999px;align-items:center;gap:5px;padding:3px 11px;font-family:inherit;font-size:12px;text-decoration:none;transition:color .12s,border-color .12s,background .12s;display:inline-flex}.Oo1fpq_ghostButton:hover{color:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb);background:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 8%, transparent)}.Oo1fpq_compareBox{border:1px dashed var(--dsw-alias-brand-primary,#2563eb);background:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 4%, var(--dsw-alias-bg-layer-1,#fff));border-radius:10px;flex-direction:column;gap:7px;padding:9px 11px;display:flex}.Oo1fpq_compareChips{flex-wrap:wrap;gap:6px;display:flex}.Oo1fpq_compareChip{border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-1,#fff);min-height:27px;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;border-radius:999px;align-items:center;padding:0 11px;font-family:inherit;font-size:12px;transition:color .12s,border-color .12s,background .12s;display:inline-flex}.Oo1fpq_compareChip:hover{color:var(--dsw-alias-label-primary,#1f2328);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}.Oo1fpq_compareChip[data-active=true]{color:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb);background:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 9%, transparent);font-weight:600}.Oo1fpq_compareBoard{flex-direction:column;gap:12px;display:flex}.Oo1fpq_compareGroup{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f7f8);border-radius:12px;flex-direction:column;gap:8px;padding:11px;display:flex}.Oo1fpq_compareGroup[data-state=running]{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 45%, var(--dsw-alias-border-l1,#e5e7eb))}.Oo1fpq_compareGroup[data-state=done]{border-color:color-mix(in srgb, #10b981 45%, var(--dsw-alias-border-l1,#e5e7eb))}.Oo1fpq_compareGroup[data-state=error]{border-color:color-mix(in srgb, var(--dsw-alias-label-error,#b91c1c) 45%, var(--dsw-alias-border-l1,#e5e7eb))}.Oo1fpq_compareGroupHead{justify-content:space-between;align-items:center;gap:10px;display:flex}.Oo1fpq_compareModelName{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,#e5e7eb);color:var(--dsw-alias-label-primary,#1f2328);text-overflow:ellipsis;white-space:nowrap;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600;overflow:hidden}.Oo1fpq_compareState{color:var(--dsw-alias-label-tertiary,#9ca3af);white-space:nowrap;align-items:center;gap:5px;font-size:11px;display:inline-flex}.Oo1fpq_compareGroup[data-state=running] .Oo1fpq_compareState{color:var(--dsw-alias-brand-primary,#2563eb)}.Oo1fpq_compareGroup[data-state=done] .Oo1fpq_compareState{color:#059669}.Oo1fpq_compareGroup[data-state=error] .Oo1fpq_compareState,.Oo1fpq_hint[data-error]{color:var(--dsw-alias-label-error,#b91c1c)}.Oo1fpq_historyCol{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:12px;flex-direction:column;flex:none;width:250px;min-width:210px;max-width:290px;min-height:0;display:flex;overflow:hidden}.Oo1fpq_historyHeader{border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);flex:none;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;display:flex}.Oo1fpq_historyTitle{color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;font-weight:700}.Oo1fpq_historyClear{border:1px solid var(--dsw-alias-border-l2,#d1d5db);color:var(--dsw-alias-label-tertiary,#9ca3af);cursor:pointer;background:0 0;border-radius:999px;padding:2px 9px;font-family:inherit;font-size:11px}.Oo1fpq_historyClear:hover{color:var(--dsw-alias-label-error,#b91c1c);border-color:var(--dsw-alias-label-error,#b91c1c)}.Oo1fpq_historyList{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;flex-direction:column;flex:1;gap:8px;min-height:0;padding:9px;display:flex;overflow-y:auto}.Oo1fpq_historyList::-webkit-scrollbar{width:8px}.Oo1fpq_historyList::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}.Oo1fpq_historyEmpty{text-align:center;color:var(--dsw-alias-label-tertiary,#9ca3af);flex:1;justify-content:center;align-items:center;padding:18px;font-size:12px;display:flex}.Oo1fpq_historyItem{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f7f8);border-radius:10px;flex-direction:column;gap:6px;padding:9px;display:flex}.Oo1fpq_historyPrompt{color:var(--dsw-alias-label-primary,#1f2328);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:12px;line-height:1.45;display:-webkit-box;overflow:hidden}.Oo1fpq_historyMeta{color:var(--dsw-alias-label-tertiary,#9ca3af);white-space:nowrap;text-overflow:ellipsis;font-size:10.5px;overflow:hidden}.Oo1fpq_historyActions{justify-content:flex-end;display:flex}.Oo1fpq_historyAction{border:1px solid var(--dsw-alias-border-l2,#d1d5db);color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;background:0 0;border-radius:999px;align-items:center;gap:4px;padding:2px 9px;font-family:inherit;font-size:11px;display:inline-flex}.Oo1fpq_historyAction:hover{color:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb)}.Oo1fpq_player{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;align-items:center;gap:9px;padding:8px 10px;display:flex}.Oo1fpq_playerCompact{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:9px;align-items:center;gap:8px;padding:6px 8px;display:flex}.Oo1fpq_playButton{background:var(--dsw-alias-label-primary,#1f2328);width:30px;height:30px;color:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;border:0;border-radius:50%;flex:none;justify-content:center;align-items:center;transition:opacity .12s,transform 80ms;display:inline-flex}.Oo1fpq_playerCompact .Oo1fpq_playButton{width:26px;height:26px}.Oo1fpq_playButton:hover{opacity:.9}.Oo1fpq_playButton:active{transform:scale(.94)}.Oo1fpq_track{background:var(--dsw-alias-border-l2,#d1d5db);cursor:pointer;border-radius:999px;flex:1;min-width:0;height:4px;position:relative}.Oo1fpq_trackFill{background:var(--dsw-alias-brand-primary,#2563eb);border-radius:999px;position:absolute;inset:0 auto 0 0}.Oo1fpq_trackKnob{background:var(--dsw-alias-brand-primary,#2563eb);border-radius:50%;width:11px;height:11px;transition:transform .1s;position:absolute;top:50%;transform:translate(-50%,-50%)}.Oo1fpq_time{font-variant-numeric:tabular-nums;min-width:62px;color:var(--dsw-alias-label-tertiary,#9ca3af);white-space:nowrap;text-align:right;flex:none;font-size:10.5px}.Oo1fpq_playerCompact .Oo1fpq_time{min-width:56px;font-size:10px}.Oo1fpq_muteButton{width:24px;height:24px;color:var(--dsw-alias-label-tertiary,#9ca3af);cursor:pointer;background:0 0;border:0;border-radius:6px;flex:none;justify-content:center;align-items:center;display:inline-flex}.Oo1fpq_muteButton:hover{color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-layer-2,#f3f4f6)}.Oo1fpq_modalMask{z-index:200;backdrop-filter:blur(3px);background:#0006;place-items:center;padding:20px;display:grid;position:fixed;inset:0}.Oo1fpq_modal{border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:14px;flex-direction:column;gap:12px;width:440px;max-width:100%;max-height:calc(100vh - 40px);padding:16px;display:flex;box-shadow:0 18px 50px #00000038}.Oo1fpq_modalHead{color:var(--dsw-alias-label-primary,#1f2328);justify-content:space-between;align-items:center;gap:10px;font-size:14px;display:flex}.Oo1fpq_modalBody{flex-direction:column;gap:11px;min-height:0;display:flex;overflow-y:auto}.Oo1fpq_formRow{grid-template-columns:1fr 1fr;gap:10px;display:grid}.Oo1fpq_modalFoot{justify-content:flex-end;align-items:center;gap:8px;display:flex}.Oo1fpq_primaryButton{background:var(--dsw-alias-label-primary,#1f2328);min-height:32px;color:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;border:0;border-radius:8px;align-items:center;gap:6px;padding:0 14px;font-family:inherit;font-size:12.5px;font-weight:600;display:inline-flex}.Oo1fpq_primaryButton:disabled{opacity:.5;cursor:default}.Oo1fpq_secondaryButton{border:1px solid var(--dsw-alias-border-l2,#d1d5db);min-height:32px;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;background:0 0;border-radius:8px;padding:0 14px;font-family:inherit;font-size:12.5px}.Oo1fpq_secondaryButton:hover{color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-layer-2,#f3f4f6)}.Oo1fpq_iconButton{width:26px;height:26px;color:var(--dsw-alias-label-tertiary,#9ca3af);cursor:pointer;background:0 0;border:0;border-radius:7px;flex:none;justify-content:center;align-items:center;font-size:16px;line-height:1;display:inline-flex}.Oo1fpq_iconButton:hover{color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-layer-2,#f3f4f6)}.Oo1fpq_toast{z-index:150;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-mask-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);backdrop-filter:blur(6px);pointer-events:none;border-radius:999px;align-items:center;gap:7px;padding:7px 16px;font-size:12.5px;animation:.16s ease-out Oo1fpq_audiogenToastIn;display:inline-flex;position:absolute;bottom:18px;left:50%;transform:translate(-50%);box-shadow:0 8px 24px #00000038}@keyframes Oo1fpq_audiogenToastIn{0%{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%)}}@media (prefers-reduced-motion:reduce){.Oo1fpq_toast{animation-duration:1ms}}.Oo1fpq_modelCheckList{border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);border-radius:8px;flex-direction:column;gap:4px;max-height:180px;padding:8px;display:flex;overflow-y:auto}.Oo1fpq_resultGroups{flex-direction:column;gap:16px;display:flex}.Oo1fpq_resultGroup{flex-direction:column;gap:8px;display:flex}.Oo1fpq_resultGroupHead{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.Oo1fpq_resultGroupChip{background:var(--dsw-alias-interactive-bg-hover-accent,#26314824);border:1px solid var(--dsw-alias-border-l2,#d1d5db);color:var(--dsw-alias-label-primary,#1f2328);border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}.Oo1fpq_resultGroupError{color:var(--dsw-alias-state-error-primary,#dc2626);font-size:12px}.Oo1fpq_resultGroupCount{color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:11px}.Oo1fpq_overrideTable{flex-direction:column;gap:6px;display:flex}.Oo1fpq_overrideRow{align-items:center;gap:6px;display:flex}.Oo1fpq_overrideCell{min-width:0;color:var(--dsw-alias-label-secondary,#6b7280);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:12px;font-weight:500;overflow:hidden}.Oo1fpq_overrideCell .Oo1fpq_input{min-height:30px;padding:5px 8px}.Oo1fpq_overrideCellHead{color:var(--dsw-alias-label-primary,#1f2328);white-space:normal;font-weight:700}.Oo1fpq_taskList{flex-direction:column;gap:14px;display:flex}.Oo1fpq_taskCard{border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-2,#fafafa);border-radius:10px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}.Oo1fpq_taskCard[data-state=failed]{border-color:var(--dsw-alias-state-error-primary,#dc2626)}.Oo1fpq_taskCard[data-state=cancelled]{opacity:.75}.Oo1fpq_taskHead{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.Oo1fpq_taskLabel{color:var(--dsw-alias-label-primary,#1f2328);text-overflow:ellipsis;white-space:nowrap;max-width:200px;font-size:13px;font-weight:600;overflow:hidden}.Oo1fpq_taskStatus{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px}.Oo1fpq_taskStatus[data-state=done]{color:var(--dsw-alias-state-success-primary,#16a34a)}.Oo1fpq_taskStatus[data-state=failed]{color:var(--dsw-alias-state-error-primary,#dc2626)}.Oo1fpq_taskActions{gap:6px;margin-left:auto;display:flex}.Oo1fpq_historyTabs{flex-wrap:wrap;gap:6px;margin-bottom:10px;display:flex}.Oo1fpq_historyTab{border:1px solid var(--dsw-alias-border-l2,#d1d5db);cursor:pointer;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-secondary,#6b7280);border-radius:999px;padding:3px 10px;font-size:12px}.Oo1fpq_historyTab[data-active=true]{background:var(--dsw-alias-interactive-bg-hover-accent,#26314824);color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}.Oo1fpq_historyTabCount{color:var(--dsw-alias-label-tertiary,#9ca3af);margin-left:4px;font-size:11px}.Oo1fpq_historyCompareSummary{cursor:pointer;flex-wrap:wrap;align-items:center;gap:8px;display:flex}.Oo1fpq_historyCompareBadge{color:var(--dsw-alias-label-secondary,#6b7280);border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600}.Oo1fpq_historyModelRow{border-top:1px dashed var(--dsw-alias-border-l1,#e5e7eb);flex-direction:column;gap:4px;margin-top:8px;padding-top:8px;display:flex}.Oo1fpq_overrideOnly{color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:10px;font-weight:500}.Oo1fpq_overrideDash{color:var(--dsw-alias-label-tertiary,#9ca3af);padding:0 6px}.Oo1fpq_historyTime{color:var(--dsw-alias-label-tertiary,#9ca3af);white-space:nowrap;margin:2px 0;font-size:11px}.Oo1fpq_formSection{letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9ca3af);border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);margin:10px 0 2px;padding-bottom:4px;font-size:11px;font-weight:700}.Oo1fpq_formFields{grid-template-columns:1fr 1fr;align-items:start;gap:10px 12px;display:grid}.Oo1fpq_fieldCell{flex-direction:column;min-width:0;display:flex}.Oo1fpq_fieldFull{flex-direction:column;grid-column:1/-1;min-width:0;display:flex}.Oo1fpq_fieldHint{color:var(--dsw-alias-label-tertiary,#9ca3af);margin:4px 0 0;font-size:11px;font-weight:400;line-height:1.5}.Oo1fpq_fieldCheck{flex-direction:column;gap:4px;min-width:0;display:flex}.Oo1fpq_fieldCheck .Oo1fpq_checkbox{min-height:36px}.Oo1fpq_textarea:disabled{opacity:.55;cursor:not-allowed;background:var(--dsw-alias-bg-layer-2,#f3f4f6)}.Oo1fpq_modeIcon{margin-right:4px;font-size:13px}.Oo1fpq_modeButton[data-active=true]{border-color:var(--dsw-alias-interactive-bg-hover-accent,#26314824);background:var(--dsw-alias-interactive-bg-hover-accent,#26314824);color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}.Oo1fpq_taskBar{background:var(--dsw-alias-border-l1,#e5e7eb);border-radius:999px;flex:1;min-width:60px;height:4px;display:block;overflow:hidden}.Oo1fpq_taskBar i{background:var(--dsw-alias-interactive-bg-hover-accent,#26314859);border-radius:999px;height:100%;transition:width .3s;display:block}.Oo1fpq_historyIcon{width:26px;height:26px;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;background:0 0;border:1px solid #0000;border-radius:8px;justify-content:center;align-items:center;font-size:14px;display:inline-flex}.Oo1fpq_historyIcon:hover{background:var(--dsw-alias-interactive-bg-hover-accent,#26314824);color:var(--dsw-alias-label-primary,#1f2328)}.Oo1fpq_historyIcon[title^=删除]:hover{color:var(--dsw-alias-state-error-primary,#dc2626)}.Oo1fpq_historyPrompt{-webkit-line-clamp:2;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}.Oo1fpq_input:focus-visible,.Oo1fpq_select:focus-visible,.Oo1fpq_textarea:focus-visible,.Oo1fpq_modeButton:focus-visible,.Oo1fpq_ghostButton:focus-visible,.Oo1fpq_historyAction:focus-visible,.Oo1fpq_historyIcon:focus-visible{outline:2px solid var(--dsw-alias-interactive-bg-hover-accent,#26314859);outline-offset:1px}.Oo1fpq_generate:focus-visible{outline:2px solid var(--dsw-alias-interactive-bg-hover-accent,#26314859);outline-offset:2px}@media (width<=1100px){.Oo1fpq_studio{flex-wrap:wrap}.Oo1fpq_historyCol{width:100%;min-width:0;max-width:none}}@media (width<=720px){.Oo1fpq_formCol{width:100%;min-width:0;max-width:none}.Oo1fpq_resultCol{min-height:320px}}.Oo1fpq_formSectionRow{justify-content:space-between;align-items:flex-end;gap:8px;display:flex}.Oo1fpq_formSectionRow .Oo1fpq_formSection{flex:1}.Oo1fpq_enhanceCard{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#fafafa);border-radius:10px;flex-direction:column;gap:8px;padding:10px;display:flex}.Oo1fpq_enhanceCardHead{color:var(--dsw-alias-label-secondary,#6b7280);justify-content:space-between;align-items:center;gap:8px;font-size:12px;display:flex}.Oo1fpq_enhanceActions{gap:6px;display:flex}.Oo1fpq_enhanceActionsRow{justify-content:flex-end;margin-top:-4px;display:flex}";
		const tagId$4 = "dsh-audiogen/audio-panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$4) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-audiogen";
			tag.dataset.pluginCss = tagId$4;
			tag.textContent = css$4;
			document.head.appendChild(tag);
		}
		var audio_panel_module_css_default = {
			"taskList": "Oo1fpq_taskList",
			"historyTabs": "Oo1fpq_historyTabs",
			"historyTabCount": "Oo1fpq_historyTabCount",
			"resultGroupHead": "Oo1fpq_resultGroupHead",
			"overrideTable": "Oo1fpq_overrideTable",
			"historyCompareSummary": "Oo1fpq_historyCompareSummary",
			"historyCompareBadge": "Oo1fpq_historyCompareBadge",
			"playButton": "Oo1fpq_playButton",
			"compareGroup": "Oo1fpq_compareGroup",
			"resultGroupError": "Oo1fpq_resultGroupError",
			"player": "Oo1fpq_player",
			"modalBody": "Oo1fpq_modalBody",
			"historyMeta": "Oo1fpq_historyMeta",
			"trackFill": "Oo1fpq_trackFill",
			"historyTime": "Oo1fpq_historyTime",
			"row": "Oo1fpq_row",
			"compareBoard": "Oo1fpq_compareBoard",
			"fieldFull": "Oo1fpq_fieldFull",
			"historyActions": "Oo1fpq_historyActions",
			"audiogenToastIn": "Oo1fpq_audiogenToastIn",
			"audioList": "Oo1fpq_audioList",
			"historyClear": "Oo1fpq_historyClear",
			"audioCardIndex": "Oo1fpq_audioCardIndex",
			"resultGroup": "Oo1fpq_resultGroup",
			"taskStatus": "Oo1fpq_taskStatus",
			"formSection": "Oo1fpq_formSection",
			"formSectionRow": "Oo1fpq_formSectionRow",
			"enhanceCardHead": "Oo1fpq_enhanceCardHead",
			"checkbox": "Oo1fpq_checkbox",
			"historyEmpty": "Oo1fpq_historyEmpty",
			"header": "Oo1fpq_header",
			"playerCompact": "Oo1fpq_playerCompact",
			"resultMeta": "Oo1fpq_resultMeta",
			"iconButton": "Oo1fpq_iconButton",
			"overrideCell": "Oo1fpq_overrideCell",
			"audioCardActions": "Oo1fpq_audioCardActions",
			"historyHeader": "Oo1fpq_historyHeader",
			"muteButton": "Oo1fpq_muteButton",
			"compareModelName": "Oo1fpq_compareModelName",
			"formRow": "Oo1fpq_formRow",
			"hint": "Oo1fpq_hint",
			"taskHead": "Oo1fpq_taskHead",
			"trackKnob": "Oo1fpq_trackKnob",
			"historyCol": "Oo1fpq_historyCol",
			"tab": "Oo1fpq_tab",
			"taskActions": "Oo1fpq_taskActions",
			"resultGroupCount": "Oo1fpq_resultGroupCount",
			"fieldCell": "Oo1fpq_fieldCell",
			"fieldCheck": "Oo1fpq_fieldCheck",
			"taskBar": "Oo1fpq_taskBar",
			"historyIcon": "Oo1fpq_historyIcon",
			"overrideCellHead": "Oo1fpq_overrideCellHead",
			"enhanceActionsRow": "Oo1fpq_enhanceActionsRow",
			"historyList": "Oo1fpq_historyList",
			"taskLabel": "Oo1fpq_taskLabel",
			"select": "Oo1fpq_select",
			"error": "Oo1fpq_error",
			"panel": "Oo1fpq_panel",
			"compareBox": "Oo1fpq_compareBox",
			"compareState": "Oo1fpq_compareState",
			"resultCol": "Oo1fpq_resultCol",
			"label": "Oo1fpq_label",
			"enhanceActions": "Oo1fpq_enhanceActions",
			"overrideOnly": "Oo1fpq_overrideOnly",
			"historyPrompt": "Oo1fpq_historyPrompt",
			"compareGroupHead": "Oo1fpq_compareGroupHead",
			"title": "Oo1fpq_title",
			"modalMask": "Oo1fpq_modalMask",
			"taskCard": "Oo1fpq_taskCard",
			"formFields": "Oo1fpq_formFields",
			"resultGroups": "Oo1fpq_resultGroups",
			"studio": "Oo1fpq_studio",
			"textarea": "Oo1fpq_textarea",
			"audioCard": "Oo1fpq_audioCard",
			"audioCardHead": "Oo1fpq_audioCardHead",
			"savedChip": "Oo1fpq_savedChip",
			"historyTab": "Oo1fpq_historyTab",
			"fieldHint": "Oo1fpq_fieldHint",
			"modalFoot": "Oo1fpq_modalFoot",
			"historyModelRow": "Oo1fpq_historyModelRow",
			"primaryButton": "Oo1fpq_primaryButton",
			"voiceIdChip": "Oo1fpq_voiceIdChip",
			"toast": "Oo1fpq_toast",
			"resultEmptyIcon": "Oo1fpq_resultEmptyIcon",
			"overrideDash": "Oo1fpq_overrideDash",
			"modal": "Oo1fpq_modal",
			"resultEmptyHint": "Oo1fpq_resultEmptyHint",
			"modeRow": "Oo1fpq_modeRow",
			"enhanceCard": "Oo1fpq_enhanceCard",
			"compareChip": "Oo1fpq_compareChip",
			"formCol": "Oo1fpq_formCol",
			"ghostButton": "Oo1fpq_ghostButton",
			"modalHead": "Oo1fpq_modalHead",
			"tabs": "Oo1fpq_tabs",
			"generate": "Oo1fpq_generate",
			"historyTitle": "Oo1fpq_historyTitle",
			"modeIcon": "Oo1fpq_modeIcon",
			"time": "Oo1fpq_time",
			"input": "Oo1fpq_input",
			"track": "Oo1fpq_track",
			"resultGroupChip": "Oo1fpq_resultGroupChip",
			"historyAction": "Oo1fpq_historyAction",
			"resultModeChip": "Oo1fpq_resultModeChip",
			"compareChips": "Oo1fpq_compareChips",
			"advanced": "Oo1fpq_advanced",
			"modelCheckList": "Oo1fpq_modelCheckList",
			"secondaryButton": "Oo1fpq_secondaryButton",
			"modeButton": "Oo1fpq_modeButton",
			"overrideRow": "Oo1fpq_overrideRow",
			"historyItem": "Oo1fpq_historyItem",
			"resultEmpty": "Oo1fpq_resultEmpty"
		};
		//#endregion
		//#region src/client/audio-player.tsx
		/**
		* Custom audio player: play/pause, seekable progress and time readout.
		* Replaces the native `<audio controls>` look with a themed control so the
		* panel matches the DSH design tokens in light and dark modes.
		*/
		function format(seconds) {
			if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
			const whole = Math.floor(seconds);
			const minutes = Math.floor(whole / 60);
			const rest = whole % 60;
			return `${minutes}:${rest < 10 ? `0${rest}` : String(rest)}`;
		}
		function AudioPlayer(props) {
			const ref = (0, react.useRef)(null);
			const [playing, setPlaying] = (0, react.useState)(false);
			const [muted, setMuted] = (0, react.useState)(false);
			const [current, setCurrent] = (0, react.useState)(0);
			const [duration, setDuration] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				setPlaying(false);
				setCurrent(0);
				setDuration(0);
			}, [props.src]);
			const toggle = (0, react.useCallback)(() => {
				const el = ref.current;
				if (el === null) return;
				if (el.paused) el.play().catch(() => {});
				else el.pause();
			}, []);
			const seek = (0, react.useCallback)((event) => {
				const el = ref.current;
				if (el === null || duration <= 0) return;
				const rect = event.currentTarget.getBoundingClientRect();
				el.currentTime = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * duration;
			}, [duration]);
			const toggleMute = (0, react.useCallback)(() => {
				const el = ref.current;
				if (el === null) return;
				el.muted = !el.muted;
				setMuted(el.muted);
			}, []);
			const percent = duration > 0 ? Math.min(100, current / duration * 100) : 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: props.compact === true ? audio_panel_module_css_default.playerCompact : audio_panel_module_css_default.player,
				"data-playing": playing ? "true" : "false",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("audio", {
						ref,
						src: props.src,
						preload: "metadata",
						onPlay: () => setPlaying(true),
						onPause: () => setPlaying(false),
						onEnded: () => setPlaying(false),
						onTimeUpdate: (event) => setCurrent(event.currentTarget.currentTime),
						onLoadedMetadata: (event) => setDuration(event.currentTarget.duration)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: audio_panel_module_css_default.playButton,
						"aria-label": playing ? "暂停" : "播放",
						onClick: toggle,
						children: playing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PauseIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlayIcon, {})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: audio_panel_module_css_default.track,
						role: "slider",
						"aria-label": "播放进度",
						"aria-valuemin": 0,
						"aria-valuemax": Math.round(duration),
						"aria-valuenow": Math.round(current),
						onClick: seek,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: audio_panel_module_css_default.trackFill,
							style: { width: `${percent}%` }
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: audio_panel_module_css_default.trackKnob,
							style: { left: `${percent}%` }
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: audio_panel_module_css_default.time,
						children: [format(current), duration > 0 ? ` / ${format(duration)}` : ""]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: audio_panel_module_css_default.muteButton,
						"aria-label": muted ? "取消静音" : "静音",
						onClick: toggleMute,
						children: muted ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MuteIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VolumeIcon, {})
					})
				]
			});
		}
		//#endregion
		//#region src/client/library-save-dialog.tsx
		/**
		* «保存到资源库» dialog: pick type/category, set name/tags/note, then save.
		* Built from either freshly generated audio or a history entry.
		*/
		function typeOfMode(mode) {
			if (mode === "voice_design") return "voice";
			return mode;
		}
		const LIBRARY_TYPE_LABELS = {
			voice: "音色",
			music: "音乐",
			sfx: "音效",
			tts: "TTS 语音"
		};
		function parseTags(text) {
			return [...new Set(text.split(/[,，、\n]/).map((tag) => tag.trim()).filter((tag) => tag !== ""))].slice(0, 20);
		}
		function guessCategory(type, context) {
			if (type === "voice") {
				const probe = `${context.voiceId ?? ""} ${context.voice ?? ""}`.toLowerCase();
				if (/male|男/.test(probe)) return "male";
				if (/female|女/.test(probe)) return "female";
				return "custom";
			}
			if (type === "tts") return (context.voice ?? context.voiceId ?? "default").replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, "_");
			return "";
		}
		function LibrarySaveDialog(props) {
			const { api, files, context } = props;
			const [type, setType] = (0, react.useState)(typeOfMode(context.mode));
			const [category, setCategory] = (0, react.useState)(() => guessCategory(typeOfMode(context.mode), context));
			const [name, setName] = (0, react.useState)("");
			const [tags, setTags] = (0, react.useState)("");
			const [note, setNote] = (0, react.useState)("");
			const [saving, setSaving] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const isVoice = type === "voice";
			const isTts = type === "tts";
			const defaultName = (0, react.useMemo)(() => {
				const flat = context.prompt.replace(/\s+/g, " ").trim();
				return flat === "" ? "未命名音频" : flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
			}, [context.prompt]);
			const switchType = (next) => {
				setType(next);
				setCategory(guessCategory(next, context));
			};
			const save = async () => {
				setSaving(true);
				setError(null);
				try {
					const result = await api.librarySave({
						audioFiles: files.map((file) => ({
							id: file.id,
							file: file.file,
							mime: file.mime,
							...file.voiceId === void 0 ? {} : { voiceId: file.voiceId },
							...file.duration === void 0 ? {} : { duration: file.duration }
						})),
						type,
						...category.trim() !== "" && (isVoice || isTts) ? { category: category.trim() } : {},
						...name.trim() !== "" ? { name: name.trim() } : {},
						...parseTags(tags).length > 0 ? { tags: parseTags(tags) } : {},
						...note.trim() !== "" ? { note: note.trim() } : {},
						provenance: {
							mode: context.mode,
							prompt: context.prompt,
							...context.channel === void 0 ? {} : { channel: context.channel },
							...context.channelId === void 0 ? {} : { channelId: context.channelId },
							...context.model === void 0 ? {} : { model: context.model },
							...context.voice === void 0 ? {} : { voice: context.voice },
							...context.voiceId === void 0 ? {} : { voiceId: context.voiceId },
							...context.params === void 0 ? {} : { params: context.params }
						}
					});
					if (!result.ok || result.entry === void 0) {
						setError(result.message ?? "保存失败");
						return;
					}
					props.onSaved(result.entry);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setSaving(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: audio_panel_module_css_default.modalMask,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: audio_panel_module_css_default.modal,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": "保存到资源库",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: audio_panel_module_css_default.modalHead,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: files.length > 1 ? `保存 ${files.length} 段音频到资源库` : "保存到资源库" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: audio_panel_module_css_default.iconButton,
								"aria-label": "关闭",
								onClick: props.onClose,
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: audio_panel_module_css_default.modalBody,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: audio_panel_module_css_default.formRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: audio_panel_module_css_default.label,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "资源类型" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
											className: audio_panel_module_css_default.input,
											value: type,
											onChange: (event) => switchType(event.target.value),
											children: [
												"voice",
												"music",
												"sfx",
												"tts"
											].map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: item,
												children: LIBRARY_TYPE_LABELS[item]
											}, item))
										})]
									}), isVoice || isTts ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: audio_panel_module_css_default.label,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: isVoice ? "音色分级（男 / 女）" : "按音色归档（voice 键）" }), isVoice ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											className: audio_panel_module_css_default.input,
											value: category,
											onChange: (event) => setCategory(event.target.value),
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "male",
													children: "男声 male"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "female",
													children: "女声 female"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "custom",
													children: "未分级 custom"
												})
											]
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: audio_panel_module_css_default.input,
											value: category,
											onChange: (event) => setCategory(event.target.value),
											placeholder: context.voice ?? "default"
										})]
									}) : null]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "名称（留空则使用提示词）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: audio_panel_module_css_default.input,
										value: name,
										onChange: (event) => setName(event.target.value),
										placeholder: defaultName
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "标签（逗号分隔，可多个）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: audio_panel_module_css_default.input,
										value: tags,
										onChange: (event) => setTags(event.target.value),
										placeholder: "温暖, 男声, 复古…"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "备注（可选）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										className: audio_panel_module_css_default.textarea,
										rows: 2,
										value: note,
										onChange: (event) => setNote(event.target.value),
										placeholder: "用途、风格备注…"
									})]
								}),
								error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: audio_panel_module_css_default.error,
									children: error
								}) : null
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: audio_panel_module_css_default.modalFoot,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: audio_panel_module_css_default.secondaryButton,
								onClick: props.onClose,
								children: "取消"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: audio_panel_module_css_default.primaryButton,
								disabled: saving || files.length === 0,
								onClick: () => void save(),
								children: saving ? "保存中…" : "保存到资源库"
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/studio-view.tsx
		/**
		* Studio view: the generation form (left), result cards (center) and the
		* compact generation history (right). Owns the «加入资源库» interactions —
		* a pre-generation checkbox, a per-card save dialog, and a history star —
		* plus a model-comparison mode that runs the same prompt across several
		* models and shows one result group per model.
		*/
		/**
		* 模型是否适用于当前模式。
		* - stable-audio-*（Stable Audio 系列）：官方 text-to-audio 协议对音乐与音效是同一接口，
		*   因此同时适用于「音乐生成」与「音效生成」；官方不支持 TTS（语音合成），故不出现在 TTS。
		* - 其余模型：按设置中的分类（category）匹配，auto（未分类）适用于全部模式。
		*/
		function modelSuitableForMode(entry, mode) {
			if (mode === "voice_design") return false;
			if (/^stable-audio-/i.test(entry.alias)) return mode === "music" || mode === "sfx";
			if (entry.category === void 0) return true;
			if (entry.category === mode) return true;
			return entry.category === "tts" && mode === "tts";
		}
		/** 每模型覆盖值 → 请求字段的数值/类型转换（空值跳过）。 */
		function overrideSpread(override) {
			const out = {};
			const val = (override.format ?? "").trim();
			if (val !== "") out.format = val;
			const num = (key) => {
				const raw = (override[key] ?? "").trim();
				if (raw === "") return void 0;
				const parsed = Number(raw);
				return Number.isFinite(parsed) ? parsed : void 0;
			};
			const duration = num("duration");
			if (duration !== void 0) out.duration = duration;
			const voice = (override.voice ?? "").trim();
			if (voice !== "") out.voice = voice;
			const speed = num("speed");
			if (speed !== void 0) out.speed = speed;
			const emotion = (override.emotion ?? "").trim();
			if (emotion !== "") out.emotion = emotion;
			const sampleRate = num("sample_rate");
			if (sampleRate !== void 0) out.sampleRate = sampleRate;
			const bitrate = num("bitrate");
			if (bitrate !== void 0) out.bitrate = bitrate;
			const lyrics = (override.lyrics ?? "").trim();
			if (lyrics !== "") out.lyrics = lyrics;
			const seed = num("seed");
			if (seed !== void 0) out.seed = seed;
			const steps = num("steps");
			if (steps !== void 0) out.steps = steps;
			const cfgScale = num("cfg_scale");
			if (cfgScale !== void 0) out.cfgScale = cfgScale;
			return out;
		}
		function taskIdOf(entry) {
			const params = entry.params;
			return typeof params?.taskId === "string" && params.taskId !== "" ? params.taskId : "";
		}
		function modeLabelOf(mode) {
			if (mode === "tts") return tt("mode.tts");
			if (mode === "music") return tt("mode.music");
			if (mode === "sfx") return tt("mode.sfx");
			return tt("mode.voiceDesign");
		}
		/** 历史时间显示（YYYY-MM-DD HH:mm）。 */
		function formatClock(timestamp) {
			const date = new Date(timestamp);
			if (Number.isNaN(date.getTime())) return "";
			const pad = (n) => String(n).padStart(2, "0");
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}
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
				fetch(HISTORY_API.list, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}"
				}).then(async (response) => {
					const body = await response.json();
					if (body.ok === true) setEntries(body.history ?? []);
				}).catch(() => {});
			};
			(0, react.useEffect)(() => {
				reload();
			}, []);
			const clear = () => {
				fetch(HISTORY_API.clear, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}"
				}).then(() => reload()).catch(() => {});
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
		/** 结果卡片音频源：优先同源 URL（历史恢复的音频只有 URL 没有 b64），无 URL 再回退 data URL。 */
		function srcOf(audio) {
			return audio.url !== "" ? audio.url : dataUrlOf(audio);
		}
		function fileNameOf(url) {
			try {
				return decodeURIComponent(new URL(url, "http://localhost").pathname.split("/").pop() ?? "");
			} catch {
				return "";
			}
		}
		/** Turn a history entry's audio refs into GeneratedAudio-shaped inputs. */
		function audioRefsOfEntry(entry) {
			return entry.audio.map((audio) => {
				const file = fileNameOf(audio.url);
				return {
					id: file.replace(/\.[a-z0-9]+$/i, ""),
					file,
					url: audio.url,
					mime: audio.mime,
					bytes: 0,
					b64: "",
					...audio.duration === void 0 ? {} : { duration: audio.duration },
					...audio.voiceId === void 0 ? {} : { voiceId: audio.voiceId }
				};
			});
		}
		function contextOfEntry(entry) {
			return {
				mode: entry.mode,
				prompt: entry.prompt,
				...entry.voice === void 0 ? {} : { voice: entry.voice },
				...entry.voiceId === void 0 ? {} : { voiceId: entry.voiceId },
				...entry.model === void 0 ? {} : { model: entry.model },
				...entry.channel === void 0 ? {} : { channel: entry.channel },
				...entry.channelId === void 0 ? {} : { channelId: entry.channelId },
				...entry.params === void 0 ? {} : { params: entry.params }
			};
		}
		function StudioView(props) {
			const { api, scope, config, reuse } = props;
			const effectiveConfig = useConfig(scope);
			const cfg = config ?? effectiveConfig;
			const enabled = cfg?.enabled ?? true;
			const modelOptions = audioModelOptions(cfg);
			const channels = cfg?.channels ?? [];
			const connected = enabled && channels.some((channel) => {
				const keyHeld = scope.getSecretSetSnapshot(`channelSecrets.${channel.id}`);
				return channel.apiUrl.trim() !== "" && keyHeld && (channel.models.length > 0 || channel.preset === "minimax");
			});
			const [mode, setMode] = (0, react.useState)("tts");
			/** 每个模式独立的输入内容（TTS 文本 / 音乐·音效提示词 / 音色描述），切模式互不干扰。 */
			const [promptByMode, setPromptByMode] = (0, react.useState)({
				tts: "",
				music: "",
				sfx: "",
				voice_design: ""
			});
			const prompt = promptByMode[mode] ?? "";
			const setPrompt = (next) => {
				const target = mode;
				setPromptByMode((current) => current[target] === next ? current : {
					...current,
					[target]: next
				});
			};
			const [previewText, setPreviewText] = (0, react.useState)("");
			const [model, setModel] = (0, react.useState)("");
			const [voice, setVoice] = (0, react.useState)("");
			const [speed, setSpeed] = (0, react.useState)("");
			const [duration, setDuration] = (0, react.useState)("");
			const [lyrics, setLyrics] = (0, react.useState)("");
			const [instrumental, setInstrumental] = (0, react.useState)(false);
			const [loop, setLoop] = (0, react.useState)(false);
			const [promptInfluence, setPromptInfluence] = (0, react.useState)("");
			const [format, setFormat] = (0, react.useState)("mp3");
			const [emotion, setEmotion] = (0, react.useState)("");
			const [vol, setVol] = (0, react.useState)("");
			const [pitch, setPitch] = (0, react.useState)("");
			const [toneText, setToneText] = (0, react.useState)("");
			const [sampleRate, setSampleRate] = (0, react.useState)("");
			const [bitrate, setBitrate] = (0, react.useState)("");
			const [audioChannel, setAudioChannel] = (0, react.useState)("");
			const [subtitle, setSubtitle] = (0, react.useState)(false);
			const [enhancing, setEnhancing] = (0, react.useState)(false);
			const [enhancePreview, setEnhancePreview] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setEnhancePreview(null);
			}, [mode]);
			const [seed, setSeed] = (0, react.useState)("");
			const [steps, setSteps] = (0, react.useState)("");
			const [cfgScale, setCfgScale] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)(null);
			const [tasks, setTasks] = (0, react.useState)([]);
			const tasksRef = (0, react.useRef)([]);
			(0, react.useEffect)(() => {
				tasksRef.current = tasks;
			}, [tasks]);
			const taskControllers = (0, react.useRef)(/* @__PURE__ */ new Map());
			const [saveToLibrary, setSaveToLibrary] = (0, react.useState)(cfg?.autoSaveToLibrary === true);
			const [savedIds, setSavedIds] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [saveDialog, setSaveDialog] = (0, react.useState)(null);
			const [historyTab, setHistoryTab] = (0, react.useState)("all");
			/** 对比模式与对比模型选择按模式独立保存：恢复对比任务或切换模式时不会串到其他模块。 */
			const [compareModeByMode, setCompareModeByMode] = (0, react.useState)({
				tts: false,
				music: false,
				sfx: false,
				voice_design: false
			});
			const compareMode = compareModeByMode[mode] ?? false;
			const setCompareMode = (next) => {
				const target = mode;
				setCompareModeByMode((current) => current[target] === next ? current : {
					...current,
					[target]: next
				});
			};
			const [compareModelsByMode, setCompareModelsByMode] = (0, react.useState)({
				tts: [],
				music: [],
				sfx: [],
				voice_design: []
			});
			const compareModels = compareModelsByMode[mode] ?? [];
			const setCompareModels = (next) => {
				const target = mode;
				setCompareModelsByMode((current) => {
					const previous = current[target] ?? [];
					const updated = typeof next === "function" ? next(previous) : next;
					return updated === previous ? current : {
						...current,
						[target]: updated
					};
				});
			};
			const [overrides, setOverrides] = (0, react.useState)({});
			const { entries, reload, clear } = useHistory();
			const [designChannelId, setDesignChannelId] = (0, react.useState)("");
			(0, react.useMemo)(() => {
				const target = channels.find((candidate) => candidate.id === modelOptions.defaultChannelId) ?? channels[0];
				return target !== void 0 && (target.preset === "minimax" || /minimax/i.test(target.apiUrl));
			}, [channels, modelOptions.defaultChannelId]);
			(0, react.useEffect)(() => {
				if (channels.length === 0) return;
				if (designChannelId === "" || !channels.some((candidate) => candidate.id === designChannelId)) setDesignChannelId(modelOptions.defaultChannelId ?? channels[0].id);
			}, [
				channels,
				modelOptions.defaultChannelId,
				designChannelId
			]);
			const visibleModels = (0, react.useMemo)(() => {
				if (mode === "voice_design") return [];
				return modelOptions.models.filter((entry) => modelSuitableForMode(entry, mode)).map((entry) => entry.alias);
			}, [modelOptions.models, mode]);
			const currentPreset = (0, react.useMemo)(() => {
				if (mode === "voice_design") return channels.find((candidate) => candidate.id === designChannelId)?.preset ?? "";
				return (modelOptions.models.find((entry) => entry.alias === model) ?? modelOptions.models.find((entry) => entry.alias === (visibleModels[0] ?? "")))?.preset ?? "";
			}, [
				mode,
				model,
				visibleModels,
				modelOptions.models,
				channels,
				designChannelId
			]);
			const fieldPresets = (0, react.useMemo)(() => {
				if (mode === "voice_design") return [];
				if (compareMode) {
					const presets = [];
					for (const alias of compareModels) {
						const entry = modelOptions.models.find((candidate) => candidate.alias === alias);
						if (entry !== void 0 && !presets.includes(entry.preset)) presets.push(entry.preset);
					}
					if (presets.length === 0) return [currentPreset].filter((value) => value !== "");
					return presets;
				}
				return [currentPreset].filter((value) => value !== "");
			}, [
				mode,
				compareMode,
				compareModels,
				modelOptions.models,
				currentPreset
			]);
			const globalSpecs = (0, react.useMemo)(() => globalFieldSpecs(mode, fieldPresets), [mode, fieldPresets]);
			const groupedModels = (0, react.useMemo)(() => {
				const groups = [];
				for (const entry of modelOptions.models) {
					let group = groups.find((candidate) => candidate.channelId === entry.channelId);
					if (group === void 0) {
						group = {
							channelId: entry.channelId,
							channelName: entry.channelName,
							models: []
						};
						groups.push(group);
					}
					group.models.push({ alias: entry.alias });
				}
				return groups.map((group) => ({
					...group,
					models: group.models.filter((entry) => visibleModels.includes(entry.alias))
				})).filter((group) => group.models.length > 0);
			}, [modelOptions.models, visibleModels]);
			(0, react.useEffect)(() => {
				if (visibleModels.length > 0 && !visibleModels.includes(model)) setModel(visibleModels[0]);
			}, [visibleModels, model]);
			(0, react.useEffect)(() => {
				setCompareModels((current) => current.filter((item) => visibleModels.includes(item)));
			}, [mode, visibleModels]);
			(0, react.useEffect)(() => {
				if (!compareMode) return;
				setCompareModels((current) => {
					const valid = current.filter((item) => visibleModels.includes(item));
					const rest = visibleModels.filter((item) => !valid.includes(item));
					while (valid.length < 2 && rest.length > 0) valid.push(rest.shift());
					return valid;
				});
			}, [compareMode, visibleModels]);
			(0, react.useEffect)(() => {
				if (reuse === void 0 || reuse === null) return;
				setMode(reuse.mode);
				if (reuse.voiceId !== void 0 || reuse.voice !== void 0) setVoice(reuse.voiceId ?? reuse.voice ?? "");
				if (reuse.model !== void 0 && reuse.model !== "") setModel(reuse.model);
			}, [reuse?.nonce]);
			/** Build the shared generation request for one model. */
			const requestOf = (modelName) => ({
				mode,
				model: modelName,
				prompt: prompt.trim(),
				saveToLibrary,
				...mode === "voice_design" && designChannelId !== "" ? { channelId: designChannelId } : {},
				...previewText.trim() !== "" ? { previewText: previewText.trim() } : {},
				...voice.trim() !== "" ? { voice: voice.trim() } : {},
				...speed.trim() !== "" ? { speed: Number(speed) } : {},
				...duration.trim() !== "" ? { duration: Number(duration) } : {},
				...lyrics.trim() !== "" ? { lyrics: lyrics.trim() } : {},
				...instrumental ? { isInstrumental: true } : {},
				...loop ? { loop: true } : {},
				...promptInfluence.trim() !== "" ? { promptInfluence: Number(promptInfluence) } : {},
				...format.trim() !== "" ? { format: format.trim() } : {},
				...emotion.trim() !== "" ? { emotion: emotion.trim() } : {},
				...vol.trim() !== "" ? { vol: Number(vol) } : {},
				...pitch.trim() !== "" ? { pitch: Number(pitch) } : {},
				...toneText.trim() !== "" ? { pronunciationTone: toneText.split("\n").map((item) => item.trim()).filter((item) => item !== "") } : {},
				...sampleRate.trim() !== "" ? { sampleRate: Number(sampleRate) } : {},
				...bitrate.trim() !== "" ? { bitrate: Number(bitrate) } : {},
				...audioChannel.trim() !== "" ? { audioChannel: Number(audioChannel) } : {},
				...subtitle ? { subtitleEnable: true } : {},
				...seed.trim() !== "" ? { seed: Number(seed) } : {},
				...steps.trim() !== "" ? { steps: Number(steps) } : {},
				...cfgScale.trim() !== "" ? { cfgScale: Number(cfgScale) } : {}
			});
			const applyResponse = (response) => {
				const generated = response.outputs ?? [];
				if ((response.resources?.length ?? 0) > 0 && saveToLibrary) {
					setSavedIds((current) => /* @__PURE__ */ new Set([...current, ...generated.map((item) => item.id)]));
					props.showToast("已保存到资源库");
					props.onLibraryChanged();
				}
				reload();
				return generated;
			};
			const patchTask = (taskId, fn) => {
				setTasks((current) => current.map((task) => task.id === taskId ? fn(task) : task));
			};
			/** 提交即建任务：非阻塞，可继续发起其他生成；并发由宿主「最大并发生成数」闸门控制。 */
			const submit = () => {
				if (prompt.trim() === "") {
					setError(tt("prompt.required"));
					return;
				}
				const isCompare = compareMode && needModel;
				const models = isCompare ? compareModels.length >= 2 ? compareModels : visibleModels.slice(0, 2) : [];
				if (isCompare && models.length < 2) {
					setError("请至少选择 2 个模型进行对比");
					return;
				}
				const singleModel = isCompare ? "" : model || visibleModels[0] || "";
				if (!isCompare && singleModel === "") {
					setError("当前模式暂无可用模型");
					return;
				}
				setError(null);
				const taskId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				const planModels = isCompare ? models : [singleModel];
				const plan = planModels.map((modelName) => ({
					model: modelName,
					request: {
						...requestOf(modelName),
						taskId,
						...overrideSpread(overrides[modelName] ?? {})
					}
				}));
				const task = {
					id: taskId,
					mode,
					prompt: prompt.trim(),
					kind: isCompare ? "compare" : "single",
					label: isCompare ? `对比 ${models.join(" / ")}` : singleModel,
					status: "running",
					progress: {
						done: 0,
						total: plan.length,
						current: ""
					},
					startedAt: Date.now(),
					groups: planModels.map((modelName) => ({
						model: modelName,
						state: "waiting",
						outputs: []
					}))
				};
				setTasks((current) => [task, ...current]);
				runTask(taskId, plan);
			};
			/** 执行一个任务：并行发起（宿主闸门限流），进度回写；支持取消。 */
			const runTask = async (taskId, plan) => {
				const controllers = [];
				taskControllers.current.set(taskId, controllers);
				const taskIsFinished = () => {
					const task = tasksRef.current.find((candidate) => candidate.id === taskId);
					if (task === void 0) return "pending";
					if (task.status === "cancelled") return "cancelled";
					return "running";
				};
				await Promise.allSettled(plan.map(async (step) => {
					const controller = new AbortController();
					controllers.push(controller);
					patchTask(taskId, (task) => ({
						...task,
						progress: {
							...task.progress,
							current: step.model
						},
						groups: task.groups.map((group) => group.model === step.model ? {
							...group,
							state: "running",
							error: void 0
						} : group)
					}));
					try {
						const response = await api.generate(step.request, controller.signal);
						if (!response.ok) throw new Error(response.message ?? "生成失败");
						const generated = applyResponse(response);
						patchTask(taskId, (task) => ({
							...task,
							groups: task.groups.map((group) => group.model === step.model ? {
								...group,
								state: "done",
								outputs: generated
							} : group)
						}));
					} catch (err) {
						if (controller.signal.aborted === true || taskIsFinished() === "cancelled") patchTask(taskId, (task) => ({
							...task,
							groups: task.groups.map((group) => group.model === step.model ? {
								...group,
								state: "cancelled",
								error: void 0
							} : group)
						}));
						else patchTask(taskId, (task) => ({
							...task,
							groups: task.groups.map((group) => group.model === step.model ? {
								...group,
								state: "error",
								error: err instanceof Error ? err.message : String(err)
							} : group)
						}));
					} finally {
						patchTask(taskId, (task) => ({
							...task,
							progress: {
								...task.progress,
								done: task.progress.done + 1,
								current: ""
							}
						}));
					}
				}));
				taskControllers.current.delete(taskId);
				setTasks((current) => current.map((task) => {
					if (task.id !== taskId) return task;
					if (task.status === "cancelled") return {
						...task,
						finishedAt: task.finishedAt ?? Date.now()
					};
					const done = task.groups.filter((group) => group.state === "done").length;
					const failed = task.groups.filter((group) => group.state === "error").length;
					const cancelled = task.groups.filter((group) => group.state === "cancelled").length;
					if (done > 0) return {
						...task,
						status: "done",
						finishedAt: Date.now()
					};
					if (cancelled === task.groups.length) return {
						...task,
						status: "cancelled",
						finishedAt: Date.now()
					};
					return {
						...task,
						status: "failed",
						finishedAt: Date.now(),
						error: failed > 0 ? task.groups.filter((group) => group.state === "error").map((group) => `「${group.model}」${group.error ?? ""}`).join("；") : "生成失败"
					};
				}));
			};
			/** 取消任务：本地中止在途 fetch + 宿主中断上游请求，剩余模型跳过。 */
			const cancelTask = (taskId) => {
				for (const controller of taskControllers.current.get(taskId) ?? []) controller.abort();
				api.cancelTask(taskId);
				patchTask(taskId, (task) => ({
					...task,
					status: "cancelled",
					finishedAt: Date.now(),
					progress: {
						...task.progress,
						current: ""
					},
					groups: task.groups.map((group) => group.state === "waiting" || group.state === "running" ? {
						...group,
						state: "cancelled",
						error: void 0
					} : group)
				}));
			};
			const removeTask = (taskId) => {
				setTasks((current) => current.filter((task) => task.id !== taskId));
			};
			/** 从历史参数回填表单（参考 AI 生图「恢复」）：配置 + prompt 一键复用。
			*  compareModelsRestore：对比任务恢复为对比模式；overridesRestore 由各模型 params 差异重建；
			*  restoredGroups：把历史音频以「已完成任务」形式放回结果列，可直接试听/下载而无需重新生成。 */
			const restoreFromParams = (params, modeValue, singleModel, compareModelsRestore, overridesRestore, restoredGroups) => {
				const str = (key) => {
					const v = params[key];
					return typeof v === "string" && v.trim() !== "" ? v.trim() : void 0;
				};
				const num = (key) => {
					const v = params[key];
					if (typeof v === "number" && Number.isFinite(v)) return v;
					if (typeof v === "string" && v.trim() !== "") {
						const parsed = Number(v);
						return Number.isFinite(parsed) ? parsed : void 0;
					}
				};
				const bool = (key) => typeof params[key] === "boolean" ? params[key] : void 0;
				setMode(modeValue);
				const promptValue = str("prompt");
				if (promptValue !== void 0) setPromptByMode((current) => current[modeValue] === promptValue ? current : {
					...current,
					[modeValue]: promptValue
				});
				const modelValue = str("model") ?? singleModel;
				if (modelValue !== "") setModel(modelValue);
				if (compareModelsRestore !== void 0 && compareModelsRestore.length > 0) {
					setCompareModeByMode((current) => ({
						...current,
						[modeValue]: true
					}));
					setCompareModelsByMode((current) => ({
						...current,
						[modeValue]: compareModelsRestore
					}));
				} else setCompareModeByMode((current) => ({
					...current,
					[modeValue]: false
				}));
				const voiceValue = str("voice");
				if (voiceValue !== void 0) setVoice(voiceValue);
				const speedValue = num("speed");
				if (speedValue !== void 0) setSpeed(String(speedValue));
				const durationValue = num("duration");
				if (durationValue !== void 0) setDuration(String(durationValue));
				const formatValue = str("format");
				if (formatValue !== void 0) setFormat(formatValue);
				const lyricsValue = str("lyrics");
				if (lyricsValue !== void 0) setLyrics(lyricsValue);
				const instrumentalValue = bool("isInstrumental");
				if (instrumentalValue !== void 0) setInstrumental(instrumentalValue);
				const loopValue = bool("loop");
				if (loopValue !== void 0) setLoop(loopValue);
				const influenceValue = num("promptInfluence");
				if (influenceValue !== void 0) setPromptInfluence(String(influenceValue));
				const emotionValue = str("emotion");
				if (emotionValue !== void 0) setEmotion(emotionValue);
				const volValue = num("vol");
				if (volValue !== void 0) setVol(String(volValue));
				const pitchValue = num("pitch");
				if (pitchValue !== void 0) setPitch(String(pitchValue));
				if (Array.isArray(params.pronunciationTone)) setToneText(params.pronunciationTone.filter((item) => typeof item === "string").join("\n"));
				const sampleRateValue = num("sampleRate");
				if (sampleRateValue !== void 0) setSampleRate(String(sampleRateValue));
				const bitrateValue = num("bitrate");
				if (bitrateValue !== void 0) setBitrate(String(bitrateValue));
				const channelValue = num("audioChannel");
				if (channelValue !== void 0) setAudioChannel(String(channelValue));
				const subtitleValue = bool("subtitleEnable");
				if (subtitleValue !== void 0) setSubtitle(subtitleValue);
				const seedValue = num("seed");
				if (seedValue !== void 0) setSeed(String(seedValue));
				const stepsValue = num("steps");
				if (stepsValue !== void 0) setSteps(String(stepsValue));
				const cfgValue = num("cfgScale");
				if (cfgValue !== void 0) setCfgScale(String(cfgValue));
				const previewValue = str("previewText");
				if (previewValue !== void 0) setPreviewText(previewValue);
				const channelIdValue = str("channelId");
				if (channelIdValue !== void 0 && modeValue === "voice_design") setDesignChannelId(channelIdValue);
				setOverrides(overridesRestore ?? {});
				if (restoredGroups !== void 0 && restoredGroups.length > 0) {
					const now = Date.now();
					const total = restoredGroups.reduce((sum, group) => sum + group.audio.length, 0);
					const restoredTask = {
						id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
						mode: modeValue,
						kind: restoredGroups.length > 1 ? "compare" : "single",
						prompt: promptValue ?? "",
						label: restoredGroups.length > 1 ? `对比 ${restoredGroups.map((group) => group.model).join(" / ")}` : restoredGroups[0].model,
						status: "done",
						progress: {
							done: total,
							total,
							current: ""
						},
						startedAt: now,
						finishedAt: now,
						groups: restoredGroups.map((group) => ({
							model: group.model,
							state: "done",
							outputs: group.audio
						}))
					};
					setTasks((current) => [restoredTask, ...current]);
				}
				props.showToast(restoredGroups !== void 0 && restoredGroups.length > 0 ? "已恢复配置与音频（历史结果已放回中间栏）" : "已恢复该次生成的配置，可直接再次生成");
			};
			/** 历史音频引用 → 结果列卡片可用的音频对象（复用同源 URL，不重新生成）。 */
			const historyAudioToGenerated = (entryId, refs) => refs.map((ref, index) => ({
				id: `${entryId}-${index}`,
				file: "",
				b64: "",
				mime: ref.mime,
				bytes: 0,
				url: ref.url,
				...ref.voiceId === void 0 ? {} : { voiceId: ref.voiceId }
			}));
			/** 由对比历史条目重建每模型参数覆盖：以第一项为全局基准，其余条目与基准不同的字段即覆盖。 */
			const overridesOfCompare = (models) => {
				const base = models[0]?.entry.params ?? {};
				const out = {};
				for (const item of models.slice(1)) {
					const params = item.entry.params ?? {};
					const diff = {};
					for (const [key, value] of Object.entries(params)) {
						if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
						if (key === "taskId" || key === "upstream") continue;
						if (typeof base[key] === typeof value && String(base[key]) === String(value)) continue;
						diff[key] = String(value);
					}
					if (Object.keys(diff).length > 0) out[item.model] = diff;
				}
				return out;
			};
			/** 调用宿主增强（Agent 默认模型），结果先预览再应用。 */
			const runEnhance = async () => {
				if (prompt.trim() === "") {
					setError("请先输入文本/提示词，再点击增强");
					return;
				}
				setEnhancing(true);
				setError(null);
				try {
					const result = await api.enhancePrompt(prompt.trim(), mode);
					if (result.ok !== true || result.enhanced === void 0 || result.enhanced.trim() === "") {
						setError(result.message ?? "增强失败，请稍后重试");
						return;
					}
					setEnhancePreview(result.enhanced.trim());
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setEnhancing(false);
				}
			};
			/** 删除历史记录（对比任务卡删除该任务的全部模型条目）。 */
			const deleteHistoryEntries = async (ids) => {
				try {
					for (const id of ids) await api.removeHistory(id);
				} catch {}
				reload();
			};
			const openSaveDialog = (files, context) => {
				setSaveDialog({
					files,
					context
				});
			};
			/** 按字段规格渲染一个表单控件（渠道/模式感知：字段集由 globalSpecs 决定）。 */
			const renderField = (spec) => {
				const common = {
					className: audio_panel_module_css_default.input,
					disabled: false
				};
				/** 字段说明：显示为控件下方的小字，不再只挂在 title 悬浮提示上。 */
				const hintOf = (item) => item.hint === void 0 || item.hint.trim() === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
					className: audio_panel_module_css_default.fieldHint,
					children: item.hint
				});
				switch (spec.key) {
					case "voice": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: audio_panel_module_css_default.input,
								value: voice,
								onChange: (event) => setVoice(event.target.value),
								placeholder: currentPreset === "minimax" ? "male-qn-qingse / female-shaonv" : "alloy / 自定义音色"
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "speed": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: audio_panel_module_css_default.input,
								type: "number",
								step: spec.step ?? .1,
								min: spec.min,
								max: spec.max,
								value: speed,
								onChange: (event) => setSpeed(event.target.value),
								placeholder: spec.placeholder
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "duration": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: audio_panel_module_css_default.input,
								type: "number",
								step: spec.step ?? 1,
								min: spec.min,
								max: spec.max,
								value: duration,
								onChange: (event) => setDuration(event.target.value),
								placeholder: spec.placeholder
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "format": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								className: audio_panel_module_css_default.input,
								value: format,
								onChange: (event) => setFormat(event.target.value),
								children: (spec.options ?? [
									"mp3",
									"wav",
									"pcm"
								]).map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: option,
									children: option
								}, option))
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "lyrics": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: audio_panel_module_css_default.textarea,
								disabled: instrumental,
								value: lyrics,
								onChange: (event) => setLyrics(event.target.value),
								placeholder: instrumental ? "纯音乐模式无需填写歌词" : "第一段歌词…\n\n第二段歌词…"
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "instrumental": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: audio_panel_module_css_default.fieldCheck,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: audio_panel_module_css_default.checkbox,
							title: spec.hint,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: instrumental,
								onChange: (event) => setInstrumental(event.target.checked)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label })]
						}), hintOf(spec)]
					}, spec.key);
					case "sampleRate": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: audio_panel_module_css_default.input,
								value: sampleRate,
								onChange: (event) => setSampleRate(event.target.value),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: "默认（44100）"
								}), (spec.options ?? []).map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: option,
									children: option
								}, option))]
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "bitrate": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: audio_panel_module_css_default.input,
								value: bitrate,
								onChange: (event) => setBitrate(event.target.value),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: "默认（256000）"
								}), (spec.options ?? []).map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: option,
									children: option
								}, option))]
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "audioChannel": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: audio_panel_module_css_default.input,
								value: audioChannel,
								onChange: (event) => setAudioChannel(event.target.value),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "默认(1)"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "1",
										children: "1"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "2",
										children: "2"
									})
								]
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "emotion": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: audio_panel_module_css_default.input,
								value: emotion,
								onChange: (event) => setEmotion(event.target.value),
								placeholder: spec.placeholder
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "vol": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: audio_panel_module_css_default.input,
								type: "number",
								min: spec.min,
								max: spec.max,
								step: spec.step ?? .5,
								value: vol,
								onChange: (event) => setVol(event.target.value),
								placeholder: spec.placeholder
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "pitch": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: audio_panel_module_css_default.input,
								type: "number",
								min: spec.min,
								max: spec.max,
								value: pitch,
								onChange: (event) => setPitch(event.target.value),
								placeholder: spec.placeholder
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "toneText": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: audio_panel_module_css_default.textarea,
								value: toneText,
								onChange: (event) => setToneText(event.target.value),
								placeholder: spec.placeholder
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "subtitle": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: audio_panel_module_css_default.fieldCheck,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: audio_panel_module_css_default.checkbox,
							title: spec.hint,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: subtitle,
								onChange: (event) => setSubtitle(event.target.checked)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label })]
						}), hintOf(spec)]
					}, spec.key);
					case "loop": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: audio_panel_module_css_default.fieldCheck,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: audio_panel_module_css_default.checkbox,
							title: spec.hint,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: loop,
								onChange: (event) => setLoop(event.target.checked)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label })]
						}), hintOf(spec)]
					}, spec.key);
					case "promptInfluence": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: audio_panel_module_css_default.label,
						title: spec.hint,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: audio_panel_module_css_default.input,
								type: "number",
								step: spec.step ?? .1,
								min: spec.min,
								max: spec.max,
								value: promptInfluence,
								onChange: (event) => setPromptInfluence(event.target.value),
								placeholder: spec.placeholder
							}),
							hintOf(spec)
						]
					}, spec.key);
					case "seed":
					case "steps":
					case "cfgScale": {
						const value = spec.key === "seed" ? seed : spec.key === "steps" ? steps : cfgScale;
						const setter = spec.key === "seed" ? setSeed : spec.key === "steps" ? setSteps : setCfgScale;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: audio_panel_module_css_default.label,
							title: spec.hint,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									...common,
									type: "number",
									step: spec.step ?? 1,
									min: spec.min,
									max: spec.max,
									value: String(value),
									placeholder: spec.placeholder,
									onChange: (event) => setter(event.target.value)
								}),
								hintOf(spec)
							]
						}, spec.key);
					}
					default: return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: spec.label }, spec.key);
				}
			};
			const onDialogSaved = (entry) => {
				if (saveDialog !== null) setSavedIds((current) => /* @__PURE__ */ new Set([...current, ...saveDialog.files.map((file) => file.id)]));
				setSaveDialog(null);
				props.showToast(`已保存「${entry.name}」`);
				props.onLibraryChanged();
			};
			/** One result card (single mode shares it with the compare groups). */
			const renderAudioCard = (audio, index, label, contextModel) => {
				const saved = savedIds.has(audio.id);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: audio_panel_module_css_default.audioCard,
					"data-saved": saved ? "true" : "false",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: audio_panel_module_css_default.audioCardHead,
							children: [
								audio.voiceId !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: audio_panel_module_css_default.voiceIdChip,
									title: "新音色 ID",
									children: ["新音色 ", audio.voiceId]
								}) : null,
								saved ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: audio_panel_module_css_default.savedChip,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}), " 已入库"]
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: audio_panel_module_css_default.audioCardIndex,
									children: ["#", index + 1]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AudioPlayer, {
							src: srcOf(audio),
							itemKey: `${label}-${audio.id}`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: audio_panel_module_css_default.audioCardActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
								className: audio_panel_module_css_default.ghostButton,
								href: srcOf(audio),
								download: `generated-${index + 1}.${audio.mime.split("/")[1]?.replace("mpeg", "mp3") ?? "mp3"}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DownloadIcon, {}), " 下载"]
							}), saved ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: audio_panel_module_css_default.ghostButton,
								onClick: () => props.showToast("该音频已加入资源库"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}), " 已入库"]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: audio_panel_module_css_default.ghostButton,
								onClick: () => openSaveDialog([audio], {
									mode,
									prompt: prompt.trim(),
									...voice.trim() !== "" ? { voice: voice.trim() } : {},
									...audio.voiceId === void 0 ? {} : { voiceId: audio.voiceId },
									...contextModel !== "" ? { model: contextModel } : {},
									...channels.length > 0 ? { channel: channels.find((candidate) => candidate.id === (mode === "voice_design" ? designChannelId : modelOptions.defaultChannelId))?.name ?? channels[0]?.name ?? "" } : {},
									params: requestOf(contextModel)
								}),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StarIcon, {}), " 加入资源库"]
							})]
						})
					]
				}, `${label}-${audio.id}`);
			};
			(0, react.useMemo)(() => {
				if (mode === "tts") return tt("mode.tts");
				if (mode === "music") return tt("mode.music");
				if (mode === "sfx") return tt("mode.sfx");
				return tt("mode.voiceDesign");
			}, [mode]);
			/** 历史记录：按 taskId 聚合出「单条 / 对比任务卡」两种条目。 */
			const historyItems = (0, react.useMemo)(() => {
				const taskCounts = /* @__PURE__ */ new Map();
				for (const entry of entries) {
					const taskId = taskIdOf(entry);
					if (taskId !== "") taskCounts.set(taskId, (taskCounts.get(taskId) ?? 0) + 1);
				}
				const merged = [];
				const byTask = /* @__PURE__ */ new Map();
				for (const entry of entries) {
					const taskId = taskIdOf(entry);
					if (taskId !== "" && (taskCounts.get(taskId) ?? 0) > 1) {
						const existing = byTask.get(taskId);
						if (existing !== void 0) {
							existing.models.push({
								model: entry.model,
								...entry.channel === void 0 ? {} : { channel: entry.channel },
								entry
							});
							if (entry.createdAt > existing.createdAt) existing.createdAt = entry.createdAt;
							continue;
						}
						const item = {
							key: taskId,
							kind: "compare",
							mode: entry.mode,
							prompt: entry.prompt,
							createdAt: entry.createdAt,
							entry,
							models: [{
								model: entry.model,
								...entry.channel === void 0 ? {} : { channel: entry.channel },
								entry
							}]
						};
						byTask.set(taskId, item);
						merged.push(item);
						continue;
					}
					merged.push({
						key: entry.id,
						kind: "single",
						mode: entry.mode,
						prompt: entry.prompt,
						createdAt: entry.createdAt,
						entry,
						models: []
					});
				}
				return merged.sort((left, right) => right.createdAt - left.createdAt);
			}, [entries]);
			const needModel = mode !== "voice_design";
			const runningCount = tasks.filter((task) => task.status === "running").length;
			/** 结果列只显示当前模式的任务（历史面板已按模式分组）。 */
			const visibleTasks = (0, react.useMemo)(() => tasks.filter((task) => task.mode === mode), [tasks, mode]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: audio_panel_module_css_default.studio,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: audio_panel_module_css_default.formCol,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: audio_panel_module_css_default.modeRow,
								children: [
									["tts", "🎙️"],
									["music", "🎵"],
									["sfx", "🔊"],
									["voice_design", "🎨"]
								].map(([item, icon]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: audio_panel_module_css_default.modeButton,
									"data-active": mode === item ? "true" : "false",
									onClick: () => setMode(item),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: audio_panel_module_css_default.modeIcon,
										children: icon
									}), modeLabelOf(item)]
								}, item))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: audio_panel_module_css_default.formSection,
								children: "输入"
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: audio_panel_module_css_default.enhanceActionsRow,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: audio_panel_module_css_default.ghostButton,
									disabled: enhancing,
									onClick: () => void runEnhance(),
									children: enhancing ? "增强中…" : "✨ 增强提示词"
								})
							}),
							enhancePreview !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: audio_panel_module_css_default.enhanceCard,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: audio_panel_module_css_default.enhanceCardHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
										"增强结果（",
										modeLabelOf(mode),
										"）"
									] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: audio_panel_module_css_default.enhanceActions,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: audio_panel_module_css_default.ghostButton,
												onClick: () => {
													setPrompt(enhancePreview);
													setEnhancePreview(null);
													props.showToast("已应用增强结果");
												},
												children: "应用"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: audio_panel_module_css_default.ghostButton,
												disabled: enhancing,
												onClick: () => void runEnhance(),
												children: "重新生成"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: audio_panel_module_css_default.ghostButton,
												onClick: () => setEnhancePreview(null),
												children: "放弃"
											})
										]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									className: audio_panel_module_css_default.textarea,
									value: enhancePreview,
									readOnly: true
								})]
							}) : null,
							mode === "voice_design" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "厂商 / 渠道" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: audio_panel_module_css_default.input,
										value: designChannelId,
										onChange: (event) => setDesignChannelId(event.target.value),
										children: [channels.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: "（尚未配置渠道）"
										}) : null, channels.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: candidate.id,
											children: [
												candidate.name,
												"（",
												candidate.preset === "minimax" ? "MiniMax" : candidate.preset === "elevenlabs" ? "ElevenLabs" : candidate.preset || "自定义",
												"）"
											]
										}, candidate.id))]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: audio_panel_module_css_default.hint,
									children: "MiniMax 音色设计；ElevenLabs 音色设计（试听文本 100-1000 字符，过短将自动生成）"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: audio_panel_module_css_default.label,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "试听文本" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: audio_panel_module_css_default.input,
										value: previewText,
										onChange: (event) => setPreviewText(event.target.value),
										placeholder: "你好，这是新设计的音色试听。"
									})]
								})
							] }) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: audio_panel_module_css_default.formSection,
								children: "模型"
							}),
							needModel ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: audio_panel_module_css_default.checkbox,
								title: "选择多个模型，用相同参数逐个生成，便于对比效果",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: compareMode,
									onChange: (event) => setCompareMode(event.target.checked)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "模型对比（多模型同参数生成）" })]
							}) : null,
							needModel ? compareMode ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: audio_panel_module_css_default.compareBox,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: audio_panel_module_css_default.label,
										children: "对比模型（至少 2 个，最多 4 个）"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: audio_panel_module_css_default.compareChips,
										children: [visibleModels.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: audio_panel_module_css_default.compareChip,
											"data-active": compareModels.includes(item) ? "true" : "false",
											onClick: () => setCompareModels((current) => current.includes(item) ? current.filter((candidate) => candidate !== item) : current.length < 4 ? [...current, item] : current),
											children: item
										}, item)), visibleModels.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: audio_panel_module_css_default.hint,
											children: "当前模式暂无可用模型"
										}) : null]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
										className: audio_panel_module_css_default.advanced,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "每模型参数覆盖（默认自动：沿用上方相同配置）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: audio_panel_module_css_default.overrideTable,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: audio_panel_module_css_default.overrideRow,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${audio_panel_module_css_default.overrideCell} ${audio_panel_module_css_default.overrideCellHead}` }), compareModels.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: `${audio_panel_module_css_default.overrideCell} ${audio_panel_module_css_default.overrideCellHead}`,
													children: item
												}, item))]
											}), overrideRowSpecs(mode).map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: audio_panel_module_css_default.overrideRow,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: audio_panel_module_css_default.overrideCell,
													title: `${row.hint ?? ""}${row.presets.length < 3 ? `（适用：${row.presets.map(presetLabel).join("/")}）` : ""}`,
													children: [row.label, row.presets.length < 3 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: audio_panel_module_css_default.overrideOnly,
														children: [" 仅", row.presets.map(presetLabel).join("/")]
													}) : null]
												}), compareModels.map((item) => {
													const entry = modelOptions.models.find((candidate) => candidate.alias === item);
													if (!(entry !== void 0 && row.presets.includes(entry.preset))) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: audio_panel_module_css_default.overrideCell,
														children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: audio_panel_module_css_default.overrideDash,
															children: "—"
														})
													}, item);
													const value = overrides[item]?.[row.key] ?? "";
													return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: audio_panel_module_css_default.overrideCell,
														children: row.type === "select" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
															className: audio_panel_module_css_default.input,
															value,
															onChange: (event) => {
																setOverrides((current) => ({
																	...current,
																	[item]: {
																		...current[item] ?? {},
																		[row.key]: event.target.value
																	}
																}));
															},
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value: "",
																children: "自动"
															}), row.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
																value: option,
																children: option
															}, option))]
														}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															className: audio_panel_module_css_default.input,
															type: row.type === "number" ? "number" : "text",
															value,
															placeholder: row.placeholder ?? "自动",
															onChange: (event) => {
																setOverrides((current) => ({
																	...current,
																	[item]: {
																		...current[item] ?? {},
																		[row.key]: event.target.value
																	}
																}));
															}
														})
													}, item);
												})]
											}, row.key))]
										})]
									})
								]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: audio_panel_module_css_default.label,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tt("model.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: audio_panel_module_css_default.input,
									value: model,
									onChange: (event) => setModel(event.target.value),
									children: [visibleModels.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "（当前模式暂无可用模型）"
									}) : null, groupedModels.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("optgroup", {
										label: group.channelName,
										children: group.models.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: item.alias,
											children: /^stable-audio-/i.test(item.alias) ? `${item.alias} · 音乐/音效` : item.alias
										}, item.alias))
									}, group.channelId))]
								})]
							}) : null,
							globalSpecs.some((spec) => spec.advanced !== true) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: audio_panel_module_css_default.formSection,
								children: "生成参数"
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: audio_panel_module_css_default.formFields,
								children: globalSpecs.filter((spec) => spec.advanced !== true).map((spec) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: spec.key === "lyrics" || spec.key === "toneText" ? audio_panel_module_css_default.fieldFull : audio_panel_module_css_default.fieldCell,
									children: renderField(spec)
								}, spec.key))
							}),
							mode === "tts" && globalSpecs.some((spec) => spec.advanced === true) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: audio_panel_module_css_default.advanced,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "MiniMax 高级参数" }), globalSpecs.filter((spec) => spec.advanced === true).map((spec) => renderField(spec))]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: audio_panel_module_css_default.checkbox,
								title: "生成完成后自动保存到资源库；也可在设置中开启全部自动保存",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: saveToLibrary,
									onChange: (event) => setSaveToLibrary(event.target.checked)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "生成后保存到资源库" })]
							}),
							!connected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: audio_panel_module_css_default.hint,
								children: tt("config.missing")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: audio_panel_module_css_default.generate,
								disabled: !connected || (compareMode && needModel ? compareModels.length < 2 : needModel && visibleModels.length === 0),
								onClick: submit,
								children: compareMode && needModel ? "对比生成" : tt("generate")
							}),
							runningCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: audio_panel_module_css_default.hint,
								children: [
									"进行中任务：",
									runningCount,
									" 个（并发上限在「设置 → 插件 → AI 音频」调整）"
								]
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: audio_panel_module_css_default.resultCol,
						children: [error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: audio_panel_module_css_default.error,
							children: error
						}) : null, visibleTasks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: audio_panel_module_css_default.resultEmpty,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: audio_panel_module_css_default.resultEmptyIcon,
									children: "🎵"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: tt("result.empty") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: audio_panel_module_css_default.resultEmptyHint,
									children: "点击「开始生成」即创建一个任务，可同时进行多个；勾选「模型对比」用多个模型同参数生成对比"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: audio_panel_module_css_default.ghostButton,
									onClick: () => {
										setPrompt({
											tts: "今天是不是很开心呀(laughs)，当然了！我们一起去公园散步吧。",
											music: "Cinematic orchestral piece with a clear \"before/after\" transition at 1:00, starting minimalist piano + strings, then full orchestra entrance with timpani and brass at the 1-minute mark.",
											sfx: "科技感 UI 提示音：清脆短促，带轻微回声与空气感。",
											voice_design: "讲述悬疑故事的播音员，声音低沉富有磁性，语速时快时慢，营造紧张神秘的氛围。"
										}[mode] ?? "");
									},
									children: "填入示例 prompt"
								})
							]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: audio_panel_module_css_default.taskList,
							children: visibleTasks.map((task) => {
								const elapsed = task.finishedAt !== void 0 ? Math.round((task.finishedAt - task.startedAt) / 1e3) : Math.round((Date.now() - task.startedAt) / 1e3);
								const statusText = task.status === "running" ? `生成中 ${task.progress.done}/${task.progress.total}${task.progress.current !== "" ? ` · ${task.progress.current}` : ""} · ${elapsed}s` : task.status === "done" ? `完成 · ${task.groups.reduce((sum, group) => sum + group.outputs.length, 0)} 段 · ${elapsed}s` : task.status === "cancelled" ? "已取消" : "失败";
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: audio_panel_module_css_default.taskCard,
									"data-state": task.status,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: audio_panel_module_css_default.taskHead,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: audio_panel_module_css_default.resultModeChip,
													children: task.mode
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: audio_panel_module_css_default.taskLabel,
													title: task.prompt,
													children: task.label
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: audio_panel_module_css_default.taskStatus,
													"data-state": task.status,
													children: statusText
												}),
												task.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: audio_panel_module_css_default.taskBar,
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { width: `${task.progress.total > 0 ? Math.round(task.progress.done / task.progress.total * 100) : 0}%` } })
												}) : null,
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: audio_panel_module_css_default.taskActions,
													children: [task.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: audio_panel_module_css_default.ghostButton,
														onClick: () => cancelTask(task.id),
														children: "取消"
													}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: audio_panel_module_css_default.ghostButton,
														onClick: () => removeTask(task.id),
														children: "移除"
													})]
												})
											]
										}),
										task.error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: audio_panel_module_css_default.hint,
											"data-error": true,
											children: task.error
										}) : null,
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: audio_panel_module_css_default.compareBoard,
											children: task.groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: audio_panel_module_css_default.compareGroup,
												"data-state": group.state,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: audio_panel_module_css_default.compareGroupHead,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: audio_panel_module_css_default.compareModelName,
															children: group.model
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: audio_panel_module_css_default.compareState,
															children: group.state === "waiting" ? "等待中…" : group.state === "running" ? "生成中…" : group.state === "done" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}), " 完成"] }) : group.state === "cancelled" ? "已取消" : "失败"
														})]
													}),
													group.state === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: audio_panel_module_css_default.hint,
														"data-error": true,
														children: group.error
													}) : null,
													group.outputs.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: audio_panel_module_css_default.audioList,
														children: group.outputs.map((audio, index) => renderAudioCard(audio, index, group.model, group.model))
													}) : null
												]
											}, group.model))
										})
									]
								}, task.id);
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
						className: audio_panel_module_css_default.historyCol,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: audio_panel_module_css_default.historyHeader,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								className: audio_panel_module_css_default.historyTitle,
								children: tt("history.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: audio_panel_module_css_default.historyClear,
								onClick: clear,
								children: "清空"
							})]
						}), entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: audio_panel_module_css_default.historyEmpty,
							children: tt("history.empty")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: audio_panel_module_css_default.historyTabs,
							children: [
								"all",
								"tts",
								"music",
								"sfx",
								"voice_design"
							].map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: audio_panel_module_css_default.historyTab,
								"data-active": historyTab === tab ? "true" : "false",
								onClick: () => setHistoryTab(tab),
								children: [tab === "all" ? "全部" : modeLabelOf(tab), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: audio_panel_module_css_default.historyTabCount,
									children: tab === "all" ? entries.length : historyItems.filter((item) => item.mode === tab).length
								})]
							}, tab))
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: audio_panel_module_css_default.historyList,
							children: (historyTab === "all" ? historyItems : historyItems.filter((item) => item.mode === historyTab)).map((item) => {
								if (item.kind === "compare") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
									className: audio_panel_module_css_default.historyItem,
									open: true,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
											className: audio_panel_module_css_default.historyCompareSummary,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: audio_panel_module_css_default.historyPrompt,
													children: item.prompt
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: audio_panel_module_css_default.historyCompareBadge,
													children: [
														"对比 · ",
														item.models.length,
														" 个模型"
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: audio_panel_module_css_default.historyTime,
													children: formatClock(item.createdAt)
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: audio_panel_module_css_default.historyMeta,
											children: [
												modeLabelOf(item.mode),
												" · ",
												item.models.map((model) => model.model).join(" / ")
											]
										}),
										item.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: audio_panel_module_css_default.historyModelRow,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: audio_panel_module_css_default.historyMeta,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: model.model }), model.channel !== void 0 ? ` · ${model.channel}` : ""]
												}),
												model.entry.audio.map((audio, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AudioPlayer, {
													src: audio.url,
													compact: true,
													itemKey: `${item.key}-${model.entry.id}-${index}`
												}, index)),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: audio_panel_module_css_default.historyActions,
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
														type: "button",
														className: audio_panel_module_css_default.historyAction,
														onClick: () => openSaveDialog(audioRefsOfEntry(model.entry), contextOfEntry(model.entry)),
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StarIcon, {}), " 入库"]
													})
												})
											]
										}, model.entry.id)),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: audio_panel_module_css_default.historyActions,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: audio_panel_module_css_default.historyIcon,
												title: "恢复（回填配置与全部模型）",
												onClick: () => restoreFromParams(item.models[0]?.entry.params ?? {}, item.mode, item.models[0]?.model ?? "", item.models.map((model) => model.model), overridesOfCompare(item.models), item.models.map((model) => ({
													model: model.model,
													audio: historyAudioToGenerated(model.entry.id, model.entry.audio)
												}))),
												children: "↺"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: audio_panel_module_css_default.historyIcon,
												title: "删除整个对比任务",
												onClick: () => void deleteHistoryEntries(item.models.map((model) => model.entry.id)),
												children: "✕"
											})]
										})
									]
								}, item.key);
								const entry = item.entry;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: audio_panel_module_css_default.historyItem,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: audio_panel_module_css_default.historyPrompt,
											children: entry.prompt
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: audio_panel_module_css_default.historyMeta,
											children: [
												modeLabelOf(entry.mode),
												" · ",
												entry.model,
												entry.channel ? ` · ${entry.channel}` : ""
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: audio_panel_module_css_default.historyTime,
											children: formatClock(entry.createdAt)
										}),
										entry.audio.map((audio, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AudioPlayer, {
											src: audio.url,
											compact: true,
											itemKey: `${entry.id}-${index}`
										}, index)),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: audio_panel_module_css_default.historyActions,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: audio_panel_module_css_default.historyIcon,
													title: "恢复（回填配置与 prompt）",
													onClick: () => restoreFromParams(entry.params ?? {}, entry.mode, entry.model, void 0, void 0, [{
														model: entry.model,
														audio: historyAudioToGenerated(entry.id, entry.audio)
													}]),
													children: "↺"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: audio_panel_module_css_default.historyIcon,
													title: "删除这条记录",
													onClick: () => void deleteHistoryEntries([entry.id]),
													children: "✕"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: audio_panel_module_css_default.historyIcon,
													title: "加入资源库",
													onClick: () => openSaveDialog(audioRefsOfEntry(entry), contextOfEntry(entry)),
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StarIcon, {})
												})
											]
										})
									]
								}, item.key);
							})
						})] })]
					}),
					saveDialog !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibrarySaveDialog, {
						api,
						files: saveDialog.files,
						context: saveDialog.context,
						onClose: () => setSaveDialog(null),
						onSaved: onDialogSaved
					}) : null
				]
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/shimingming/Projects_code/dsh-audiogen/src/client/library.module.css.mjs
		const css$3 = ".vzUV2a_library{flex-direction:column;flex:1;gap:10px;min-width:0;min-height:0;display:flex}.vzUV2a_toolbar{flex-wrap:wrap;flex:none;align-items:center;gap:12px;display:flex}.vzUV2a_searchBox{border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-1,#fff);min-width:170px;height:33px;color:var(--dsw-alias-label-tertiary,#9ca3af);border-radius:999px;flex:220px;align-items:center;gap:7px;padding:0 11px;display:inline-flex}.vzUV2a_searchBox:focus-within{border-color:var(--dsw-alias-brand-primary,#2563eb);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 14%, transparent)}.vzUV2a_searchInput{min-width:0;height:100%;color:var(--dsw-alias-label-primary,#1f2328);background:0 0;border:0;outline:none;flex:1;font-family:inherit;font-size:12.5px}.vzUV2a_searchInput::placeholder{color:var(--dsw-alias-label-tertiary,#9ca3af)}.vzUV2a_typeChips{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-radius:10px;align-items:center;gap:5px;padding:3px;display:inline-flex}.vzUV2a_chip{min-height:27px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;cursor:pointer;background:0 0;border:0;border-radius:8px;align-items:center;gap:5px;padding:0 11px;font-family:inherit;font-size:12px;transition:color .12s,background .12s;display:inline-flex}.vzUV2a_chip:hover{color:var(--dsw-alias-label-primary,#1f2328)}.vzUV2a_chip[data-active=true]{color:var(--dsw-alias-brand-primary,#2563eb);background:var(--dsw-alias-bg-layer-1,#fff);font-weight:600;box-shadow:0 1px 3px #0000001a}.vzUV2a_chipCount{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-tertiary,#9ca3af);font-variant-numeric:tabular-nums;border-radius:999px;padding:1px 6px;font-size:10.5px}.vzUV2a_chip[data-active=true] .vzUV2a_chipCount{background:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 10%, transparent);color:var(--dsw-alias-brand-primary,#2563eb)}.vzUV2a_filterRow{flex-wrap:wrap;flex:none;align-items:center;gap:6px;display:flex}.vzUV2a_filterLabel{color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:11px;font-weight:600}.vzUV2a_smallChip{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f3f4f6);min-height:24px;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;border-radius:999px;align-items:center;gap:4px;padding:0 10px;font-family:inherit;font-size:11.5px;display:inline-flex}.vzUV2a_smallChip:hover{color:var(--dsw-alias-label-primary,#1f2328);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}.vzUV2a_smallChip[data-active=true]{color:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb);background:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 9%, transparent);font-weight:600}.vzUV2a_listHead{border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);flex:none;justify-content:space-between;align-items:center;gap:10px;padding-bottom:2px;display:flex}.vzUV2a_listCount{color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:12px}.vzUV2a_listActions{flex-wrap:wrap;align-items:center;gap:6px;display:inline-flex}.vzUV2a_selCount{color:var(--dsw-alias-brand-primary,#2563eb);font-size:11.5px;font-weight:600}.vzUV2a_smallSelect{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);height:27px;color:var(--dsw-alias-label-primary,#1f2328);border-radius:7px;outline:none;padding:0 8px;font-family:inherit;font-size:11.5px}.vzUV2a_ghostBtn{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);min-height:27px;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;border-radius:999px;align-items:center;gap:5px;padding:0 11px;font-family:inherit;font-size:11.5px;display:inline-flex}.vzUV2a_ghostBtn:hover:not(:disabled){color:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb)}.vzUV2a_dangerBtn{border:1px solid var(--dsw-alias-label-error,#b91c1c);min-height:27px;color:var(--dsw-alias-label-error,#b91c1c);cursor:pointer;background:0 0;border-radius:999px;align-items:center;gap:5px;padding:0 11px;font-family:inherit;font-size:11.5px;display:inline-flex}.vzUV2a_dangerBtn:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-label-error,#b91c1c) 8%, transparent)}.vzUV2a_ghostBtn:disabled,.vzUV2a_dangerBtn:disabled{opacity:.45;cursor:default}.vzUV2a_stateNote{color:var(--dsw-alias-label-tertiary,#9ca3af);margin:0;padding:8px 4px;font-size:12px}.vzUV2a_stateNote[data-error]{color:var(--dsw-alias-label-error,#b91c1c)}.vzUV2a_empty{text-align:center;color:var(--dsw-alias-label-secondary,#6b7280);flex-direction:column;flex:1;justify-content:center;align-items:center;gap:6px;font-size:13px;display:flex}.vzUV2a_emptyIcon{background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-radius:50%;justify-content:center;align-items:center;width:56px;height:56px;margin-bottom:4px;font-size:26px;display:inline-flex}.vzUV2a_emptyHint{color:var(--dsw-alias-label-tertiary,#9ca3af);margin:0;font-size:11.5px}.vzUV2a_grid{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;flex:1;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));align-content:start;gap:12px;min-height:0;padding:2px 2px 6px;display:grid;overflow-y:auto}.vzUV2a_grid::-webkit-scrollbar{width:8px}.vzUV2a_grid::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}.vzUV2a_card{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;border-radius:12px;flex-direction:column;gap:7px;padding:11px;transition:border-color .12s,box-shadow .12s,transform .12s;display:flex;position:relative}.vzUV2a_card:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af);transform:translateY(-1px);box-shadow:0 4px 14px #18203614}.vzUV2a_card[data-selected=true]{border-color:var(--dsw-alias-brand-primary,#2563eb);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 24%, transparent)}.vzUV2a_cardCheck{z-index:2;position:absolute;top:9px;right:9px}.vzUV2a_cardCheck input{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary,#2563eb);cursor:pointer}.vzUV2a_cardHead{justify-content:space-between;align-items:center;gap:8px;display:flex}.vzUV2a_typeBadge{background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-secondary,#6b7280);border-radius:999px;align-items:center;gap:5px;padding:2px 9px;font-size:10.5px;font-weight:600;display:inline-flex}.vzUV2a_typeBadge[data-type=voice]{color:#8b5cf6;background:#8b5cf61f}.vzUV2a_typeBadge[data-type=music]{color:#059669;background:#10b9811f}.vzUV2a_typeBadge[data-type=sfx]{color:#b45309;background:#f59e0b24}.vzUV2a_typeBadge[data-type=tts]{color:#2563eb;background:#3b82f61f}.vzUV2a_cardTime{color:var(--dsw-alias-label-tertiary,#9ca3af);white-space:nowrap;font-size:10.5px}.vzUV2a_cardName{color:var(--dsw-alias-label-primary,#1f2328);-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:34px;font-size:12.5px;line-height:1.4;display:-webkit-box;overflow:hidden}.vzUV2a_cardFoot{flex-wrap:wrap;align-items:center;gap:5px;display:flex}.vzUV2a_metaChip{background:var(--dsw-alias-bg-layer-2,#f3f4f6);max-width:140px;color:var(--dsw-alias-label-tertiary,#9ca3af);text-overflow:ellipsis;white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:10.5px;overflow:hidden}.vzUV2a_metaChip[data-tag]{color:var(--dsw-alias-brand-primary,#2563eb);background:color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 10%, transparent)}.vzUV2a_drawerMask{z-index:120;backdrop-filter:blur(2px);background:#0000004d;justify-content:flex-end;display:flex;position:absolute;inset:0}.vzUV2a_drawer{background:var(--dsw-alias-bg-layer-1,#fff);border-left:1px solid var(--dsw-alias-border-l2,#d1d5db);flex-direction:column;width:min(430px,100% - 24px);height:100%;animation:.18s ease-out vzUV2a_audiogenDrawerIn;display:flex;box-shadow:-12px 0 36px #0000002e}@keyframes vzUV2a_audiogenDrawerIn{0%{opacity:0;transform:translate(20px)}to{opacity:1;transform:translate(0)}}.vzUV2a_drawerHead{border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);flex:none;justify-content:space-between;align-items:center;gap:10px;padding:13px 14px;display:flex}.vzUV2a_drawerTitle{color:var(--dsw-alias-label-primary,#1f2328);text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:700;overflow:hidden}.vzUV2a_iconBtn{width:26px;height:26px;color:var(--dsw-alias-label-tertiary,#9ca3af);cursor:pointer;background:0 0;border:0;border-radius:7px;flex:none;justify-content:center;align-items:center;font-size:16px;line-height:1;display:inline-flex}.vzUV2a_iconBtn:hover{color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-layer-2,#f3f4f6)}.vzUV2a_drawerBody{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;flex-direction:column;flex:1;gap:14px;min-height:0;padding:14px;display:flex;overflow-y:auto}.vzUV2a_drawerBody::-webkit-scrollbar{width:8px}.vzUV2a_drawerBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}.vzUV2a_drawerSection{flex-direction:column;gap:9px;display:flex}.vzUV2a_drawerLabel{letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9ca3af);text-transform:uppercase;font-size:11px;font-weight:700}.vzUV2a_drawerPlayerList{flex-direction:column;gap:8px;display:flex}.vzUV2a_drawerPlayer{flex-direction:column;gap:4px;display:flex}.vzUV2a_drawerPlayerName{color:var(--dsw-alias-label-tertiary,#9ca3af);text-overflow:ellipsis;white-space:nowrap;padding-left:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;overflow:hidden}.vzUV2a_drawerField{color:var(--dsw-alias-label-secondary,#6b7280);flex-direction:column;gap:4px;font-size:11.5px;font-weight:600;display:flex}.vzUV2a_drawerSplit{grid-template-columns:1fr 1fr;gap:9px;display:grid}.vzUV2a_input,.vzUV2a_textarea{border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-2,#f7f7f8);width:100%;min-height:32px;color:var(--dsw-alias-label-primary,#1f2328);border-radius:8px;outline:none;padding:6px 9px;font-family:inherit;font-size:12.5px}.vzUV2a_input:focus,.vzUV2a_textarea:focus{border-color:var(--dsw-alias-brand-primary,#2563eb);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary,#2563eb) 12%, transparent)}.vzUV2a_textarea{resize:vertical}.vzUV2a_provenance{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f7f8);border-radius:10px;flex-direction:column;gap:7px;padding:10px 11px;display:flex}.vzUV2a_provRow{gap:8px;min-width:0;display:flex}.vzUV2a_provKey{width:64px;color:var(--dsw-alias-label-tertiary,#9ca3af);flex:none;padding-top:1px;font-size:11px;font-weight:600}.vzUV2a_provValue{min-width:0;color:var(--dsw-alias-label-primary,#1f2328);overflow-wrap:anywhere;flex-wrap:wrap;align-items:flex-start;gap:6px;font-size:12px;line-height:1.5;display:flex}.vzUV2a_mono{color:var(--dsw-alias-label-secondary,#6b7280);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px}.vzUV2a_promptText{color:var(--dsw-alias-label-secondary,#6b7280)}.vzUV2a_code{background:var(--dsw-alias-bg-layer-3,#eceef1);overflow-wrap:anywhere;border-radius:5px;padding:2px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px}.vzUV2a_paramsDetails summary{cursor:pointer;color:var(--dsw-alias-brand-primary,#2563eb);user-select:none;font-size:11px}.vzUV2a_paramsDetails pre{background:var(--dsw-alias-bg-layer-3,#eceef1);width:100%;max-height:200px;color:var(--dsw-alias-label-secondary,#6b7280);border-radius:7px;margin:5px 0 0;padding:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:1.5;overflow:auto}.vzUV2a_drawerActions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.vzUV2a_primaryBtn{background:var(--dsw-alias-label-primary,#1f2328);min-height:30px;color:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;border:0;border-radius:8px;align-items:center;gap:6px;padding:0 13px;font-family:inherit;font-size:12px;font-weight:600;display:inline-flex}.vzUV2a_primaryBtn:disabled{opacity:.5;cursor:default}@media (prefers-reduced-motion:reduce){.vzUV2a_drawer{animation-duration:1ms}}";
		const tagId$3 = "dsh-audiogen/library.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-audiogen";
			tag.dataset.pluginCss = tagId$3;
			tag.textContent = css$3;
			document.head.appendChild(tag);
		}
		var library_module_css_default = {
			"drawerField": "vzUV2a_drawerField",
			"drawerMask": "vzUV2a_drawerMask",
			"searchBox": "vzUV2a_searchBox",
			"drawerSection": "vzUV2a_drawerSection",
			"drawerPlayer": "vzUV2a_drawerPlayer",
			"chipCount": "vzUV2a_chipCount",
			"metaChip": "vzUV2a_metaChip",
			"listHead": "vzUV2a_listHead",
			"drawerLabel": "vzUV2a_drawerLabel",
			"provenance": "vzUV2a_provenance",
			"provRow": "vzUV2a_provRow",
			"promptText": "vzUV2a_promptText",
			"grid": "vzUV2a_grid",
			"emptyIcon": "vzUV2a_emptyIcon",
			"audiogenDrawerIn": "vzUV2a_audiogenDrawerIn",
			"drawerPlayerList": "vzUV2a_drawerPlayerList",
			"cardCheck": "vzUV2a_cardCheck",
			"toolbar": "vzUV2a_toolbar",
			"library": "vzUV2a_library",
			"paramsDetails": "vzUV2a_paramsDetails",
			"primaryBtn": "vzUV2a_primaryBtn",
			"filterLabel": "vzUV2a_filterLabel",
			"chip": "vzUV2a_chip",
			"searchInput": "vzUV2a_searchInput",
			"empty": "vzUV2a_empty",
			"drawerBody": "vzUV2a_drawerBody",
			"typeBadge": "vzUV2a_typeBadge",
			"textarea": "vzUV2a_textarea",
			"dangerBtn": "vzUV2a_dangerBtn",
			"selCount": "vzUV2a_selCount",
			"drawer": "vzUV2a_drawer",
			"drawerHead": "vzUV2a_drawerHead",
			"emptyHint": "vzUV2a_emptyHint",
			"listActions": "vzUV2a_listActions",
			"drawerTitle": "vzUV2a_drawerTitle",
			"drawerPlayerName": "vzUV2a_drawerPlayerName",
			"code": "vzUV2a_code",
			"provKey": "vzUV2a_provKey",
			"stateNote": "vzUV2a_stateNote",
			"cardHead": "vzUV2a_cardHead",
			"drawerSplit": "vzUV2a_drawerSplit",
			"provValue": "vzUV2a_provValue",
			"cardName": "vzUV2a_cardName",
			"typeChips": "vzUV2a_typeChips",
			"iconBtn": "vzUV2a_iconBtn",
			"smallSelect": "vzUV2a_smallSelect",
			"smallChip": "vzUV2a_smallChip",
			"ghostBtn": "vzUV2a_ghostBtn",
			"card": "vzUV2a_card",
			"filterRow": "vzUV2a_filterRow",
			"mono": "vzUV2a_mono",
			"listCount": "vzUV2a_listCount",
			"input": "vzUV2a_input",
			"cardFoot": "vzUV2a_cardFoot",
			"drawerActions": "vzUV2a_drawerActions",
			"cardTime": "vzUV2a_cardTime"
		};
		//#endregion
		//#region src/client/library-view.tsx
		/**
		* Library view: curated audio assets, organized by type (voice / music / sfx /
		* tts) with categories (voice: male/female/custom; tts: the speaking voice).
		* Search + chips + card grid + detail drawer (full provenance) + batch mode.
		*/
		const TYPE_ORDER = [
			"voice",
			"music",
			"sfx",
			"tts"
		];
		const VOICE_CATEGORIES = [
			"male",
			"female",
			"custom"
		];
		function timeAgo(ts) {
			const diff = Date.now() - ts;
			const minute = 6e4;
			const hour = 60 * minute;
			const day = 24 * hour;
			if (diff < minute) return "刚刚";
			if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
			if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
			if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
			const date = new Date(ts);
			return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		}
		function typeIcon(type) {
			if (type === "voice") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MicIcon, {});
			if (type === "music") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MusicNoteIcon, {});
			if (type === "sfx") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WaveIcon, {});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListIcon, {});
		}
		function LibraryView(props) {
			const { api, revision } = props;
			const [entries, setEntries] = (0, react.useState)([]);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(null);
			const [keyword, setKeyword] = (0, react.useState)("");
			const [typeFilter, setTypeFilter] = (0, react.useState)("all");
			const [categoryFilter, setCategoryFilter] = (0, react.useState)("all");
			const [tagFilter, setTagFilter] = (0, react.useState)(null);
			const [detailId, setDetailId] = (0, react.useState)(null);
			const [batchMode, setBatchMode] = (0, react.useState)(false);
			const [selected, setSelected] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [copied, setCopied] = (0, react.useState)(null);
			const load = () => {
				setLoading(true);
				setError(null);
				api.libraryList().then(setEntries).catch((err) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false));
			};
			(0, react.useEffect)(() => {
				load();
			}, [revision]);
			(0, react.useEffect)(() => {
				setCategoryFilter("all");
			}, [typeFilter]);
			const categoriesOf = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				for (const entry of entries) {
					if (entry.category === void 0 || entry.category === "") continue;
					const list = map.get(entry.type) ?? [];
					if (!list.includes(entry.category)) list.push(entry.category);
					map.set(entry.type, list);
				}
				return map;
			}, [entries]);
			const tags = (0, react.useMemo)(() => {
				const counts = /* @__PURE__ */ new Map();
				for (const entry of entries) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
				return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
			}, [entries]);
			const filtered = (0, react.useMemo)(() => {
				const needle = keyword.trim().toLowerCase();
				return entries.filter((entry) => {
					if (typeFilter !== "all" && entry.type !== typeFilter) return false;
					if (categoryFilter !== "all" && (entry.category ?? "") !== categoryFilter) return false;
					if (tagFilter !== null && !entry.tags.includes(tagFilter)) return false;
					if (needle !== "") {
						if (![
							entry.name,
							...entry.tags,
							entry.provenance.prompt,
							entry.provenance.model ?? "",
							entry.provenance.channel ?? ""
						].join(" ").toLowerCase().includes(needle)) return false;
					}
					return true;
				});
			}, [
				entries,
				keyword,
				typeFilter,
				categoryFilter,
				tagFilter
			]);
			const typeCounts = (0, react.useMemo)(() => {
				const counts = {
					all: entries.length,
					voice: 0,
					music: 0,
					sfx: 0,
					tts: 0
				};
				for (const entry of entries) counts[entry.type] += 1;
				return counts;
			}, [entries]);
			const detail = entries.find((entry) => entry.id === detailId) ?? null;
			const currentCategoryOptions = (0, react.useMemo)(() => {
				if (typeFilter === "all") return [];
				return [.../* @__PURE__ */ new Set([...categoriesOf.get(typeFilter) ?? [], ...typeFilter === "voice" ? VOICE_CATEGORIES : []])];
			}, [typeFilter, categoriesOf]);
			const toggleSelect = (id) => {
				setSelected((current) => {
					const next = new Set(current);
					if (!next.delete(id)) next.add(id);
					return next;
				});
			};
			const doDelete = async (ids) => {
				setBusy(true);
				try {
					await api.libraryRemove(ids);
					setEntries((current) => current.filter((entry) => !ids.includes(entry.id)));
					setSelected((current) => {
						const next = new Set(current);
						for (const id of ids) next.delete(id);
						return next;
					});
					if (detailId !== null && ids.includes(detailId)) setDetailId(null);
					props.showToast(`已删除 ${ids.length} 个资源`);
				} catch (err) {
					props.showToast(err instanceof Error ? err.message : "删除失败");
				} finally {
					setBusy(false);
					setConfirmDelete(null);
				}
			};
			const copyText = async (text, key) => {
				try {
					await navigator.clipboard.writeText(text);
					setCopied(key);
					window.setTimeout(() => setCopied(null), 1400);
				} catch {
					props.showToast("复制失败");
				}
			};
			const [draft, setDraft] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (detail !== null) setDraft({
					name: detail.name,
					tags: detail.tags.join(", "),
					note: detail.note ?? "",
					type: detail.type,
					category: detail.category ?? ""
				});
			}, [detailId]);
			const saveDraft = async () => {
				if (detail === null || draft === null) return;
				setBusy(true);
				try {
					const result = await api.libraryUpdate({
						id: detail.id,
						name: draft.name,
						tags: draft.tags.split(/[,，、\n]/).map((tag) => tag.trim()).filter((tag) => tag !== ""),
						note: draft.note,
						type: draft.type,
						...(draft.type === "voice" || draft.type === "tts") && draft.category.trim() !== "" ? { category: draft.category.trim() } : {}
					});
					if (!result.ok || result.entry === void 0) {
						props.showToast(result.message ?? "保存失败");
						return;
					}
					setEntries((current) => current.map((entry) => entry.id === result.entry.id ? result.entry : entry));
					props.showToast("资源已更新");
				} catch (err) {
					props.showToast(err instanceof Error ? err.message : "保存失败");
				} finally {
					setBusy(false);
				}
			};
			const batchMoveCategory = async (category, type) => {
				if (selected.size === 0) return;
				setBusy(true);
				try {
					for (const id of selected) await api.libraryUpdate({
						id,
						type,
						...category !== "" ? { category } : {}
					});
					await load();
					setSelected(/* @__PURE__ */ new Set());
					props.showToast(`已移动 ${selected.size} 个资源`);
				} catch (err) {
					props.showToast(err instanceof Error ? err.message : "移动失败");
				} finally {
					setBusy(false);
				}
			};
			const [batchTypeSelect, setBatchTypeSelect] = (0, react.useState)("voice");
			const [batchCategorySelect, setBatchCategorySelect] = (0, react.useState)("");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: library_module_css_default.library,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_module_css_default.toolbar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: library_module_css_default.searchBox,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: library_module_css_default.searchInput,
								value: keyword,
								onChange: (event) => setKeyword(event.target.value),
								placeholder: "搜索名称、标签、提示词、模型…"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: library_module_css_default.typeChips,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: library_module_css_default.chip,
								"data-active": typeFilter === "all" ? "true" : "false",
								onClick: () => setTypeFilter("all"),
								children: ["全部 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: library_module_css_default.chipCount,
									children: typeCounts.all
								})]
							}), TYPE_ORDER.map((type) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: library_module_css_default.chip,
								"data-active": typeFilter === type ? "true" : "false",
								onClick: () => setTypeFilter(type),
								children: [
									typeIcon(type),
									" ",
									LIBRARY_TYPE_LABELS[type],
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: library_module_css_default.chipCount,
										children: typeCounts[type]
									})
								]
							}, type))]
						})]
					}),
					typeFilter !== "all" && currentCategoryOptions.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_module_css_default.filterRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: library_module_css_default.filterLabel,
								children: "分类"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: library_module_css_default.smallChip,
								"data-active": categoryFilter === "all" ? "true" : "false",
								onClick: () => setCategoryFilter("all"),
								children: "全部"
							}),
							currentCategoryOptions.map((category) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: library_module_css_default.smallChip,
								"data-active": categoryFilter === category ? "true" : "false",
								onClick: () => setCategoryFilter(category),
								children: typeFilter === "voice" ? {
									male: "男声",
									female: "女声",
									custom: "未分级"
								}[category] ?? category : category
							}, category))
						]
					}) : null,
					tags.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_module_css_default.filterRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: library_module_css_default.filterLabel,
							children: "标签"
						}), tags.map(([tag, count]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: library_module_css_default.smallChip,
							"data-active": tagFilter === tag ? "true" : "false",
							onClick: () => setTagFilter(tagFilter === tag ? null : tag),
							children: [
								tag,
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: library_module_css_default.chipCount,
									children: count
								})
							]
						}, tag))]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_module_css_default.listHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: library_module_css_default.listCount,
							children: [filtered.length, " 个资源"]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: library_module_css_default.listActions,
							children: batchMode ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: library_module_css_default.selCount,
									children: ["已选 ", selected.size]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: library_module_css_default.smallSelect,
									value: batchTypeSelect,
									onChange: (event) => {
										setBatchTypeSelect(event.target.value);
										setBatchCategorySelect("");
									},
									children: TYPE_ORDER.map((type) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: type,
										children: LIBRARY_TYPE_LABELS[type]
									}, type))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: library_module_css_default.smallSelect,
									list: "library-category-options",
									placeholder: "分类（可选）",
									value: batchCategorySelect,
									onChange: (event) => setBatchCategorySelect(event.target.value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
									id: "library-category-options",
									children: (categoriesOf.get(batchTypeSelect) ?? []).map((category) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: category }, category))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: library_module_css_default.ghostBtn,
									disabled: busy || selected.size === 0,
									onClick: () => void batchMoveCategory(batchCategorySelect, batchTypeSelect),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}), " 移动"]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: library_module_css_default.dangerBtn,
									disabled: busy || selected.size === 0,
									onClick: () => {
										if (confirmDelete === "batch") doDelete([...selected]);
										else setConfirmDelete("batch");
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrashIcon, {}),
										" ",
										confirmDelete === "batch" ? "确认删除" : "批量删除"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: library_module_css_default.ghostBtn,
									onClick: () => {
										setBatchMode(false);
										setSelected(/* @__PURE__ */ new Set());
										setConfirmDelete(null);
									},
									children: "退出"
								})
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: library_module_css_default.ghostBtn,
								onClick: () => setBatchMode(true),
								children: "多选管理"
							})
						})]
					}),
					loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: library_module_css_default.stateNote,
						children: "加载中…"
					}) : null,
					error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_module_css_default.stateNote,
						"data-error": true,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: error }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "若提示 not found / 404：插件宿主尚未加载新代码，请重启 `dsh web` 后在浏览器强制刷新（Cmd+Shift+R）。" })]
					}) : null,
					!loading && error === null && filtered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: library_module_css_default.empty,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: library_module_css_default.emptyIcon,
								children: "🎧"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "资源库还是空的" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: library_module_css_default.emptyHint,
								children: "在生成页点击「加入资源库」，把满意的音频沉淀为可管理的资源"
							})
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: library_module_css_default.grid,
						children: filtered.map((entry) => {
							const fileCount = entry.files.length;
							const first = entry.files[0];
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: library_module_css_default.card,
								"data-selected": selected.has(entry.id) ? "true" : "false",
								onClick: () => {
									if (batchMode) toggleSelect(entry.id);
									else setDetailId(entry.id);
								},
								role: "button",
								tabIndex: 0,
								onKeyDown: (event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										if (batchMode) toggleSelect(entry.id);
										else setDetailId(entry.id);
									}
								},
								children: [
									batchMode ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: library_module_css_default.cardCheck,
										onClick: (event) => event.stopPropagation(),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: selected.has(entry.id),
											onChange: () => toggleSelect(entry.id)
										})
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: library_module_css_default.cardHead,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: library_module_css_default.typeBadge,
											"data-type": entry.type,
											children: [typeIcon(entry.type), LIBRARY_TYPE_LABELS[entry.type]]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: library_module_css_default.cardTime,
											children: timeAgo(entry.createdAt)
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										className: library_module_css_default.cardName,
										title: entry.name,
										children: entry.name
									}),
									first !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										onClick: (event) => event.stopPropagation(),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AudioPlayer, {
											src: first.url,
											compact: true,
											itemKey: entry.id
										})
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: library_module_css_default.cardFoot,
										children: [
											entry.category !== void 0 && entry.category !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: library_module_css_default.metaChip,
												children: entry.type === "voice" ? {
													male: "男声",
													female: "女声",
													custom: "未分级"
												}[entry.category] ?? entry.category : entry.category
											}) : null,
											entry.provenance.model !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: library_module_css_default.metaChip,
												title: `模型：${entry.provenance.model}`,
												children: entry.provenance.model
											}) : null,
											fileCount > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: library_module_css_default.metaChip,
												children: ["×", fileCount]
											}) : null,
											entry.tags.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: library_module_css_default.metaChip,
												"data-tag": true,
												children: [entry.tags[0], entry.tags.length > 1 ? ` +${entry.tags.length - 1}` : ""]
											}) : null
										]
									})
								]
							}, entry.id);
						})
					}),
					detail !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: library_module_css_default.drawerMask,
						onClick: () => setDetailId(null),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
							className: library_module_css_default.drawer,
							onClick: (event) => event.stopPropagation(),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								className: library_module_css_default.drawerHead,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									className: library_module_css_default.drawerTitle,
									children: detail.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: library_module_css_default.iconBtn,
									"aria-label": "关闭",
									onClick: () => setDetailId(null),
									children: "×"
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: library_module_css_default.drawerBody,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: library_module_css_default.drawerSection,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: library_module_css_default.drawerPlayerList,
											children: detail.files.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: library_module_css_default.drawerPlayer,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: library_module_css_default.drawerPlayerName,
													children: file.rel.split("/").pop()
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AudioPlayer, {
													src: file.url,
													itemKey: `${file.rel}-${detail.createdAt}`
												})]
											}, file.rel))
										})
									}),
									draft !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: library_module_css_default.drawerSection,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: library_module_css_default.drawerLabel,
												children: "编辑"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: library_module_css_default.drawerField,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "名称" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													className: library_module_css_default.input,
													value: draft.name,
													onChange: (event) => setDraft({
														...draft,
														name: event.target.value
													})
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: library_module_css_default.drawerField,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "标签（逗号分隔）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													className: library_module_css_default.input,
													value: draft.tags,
													onChange: (event) => setDraft({
														...draft,
														tags: event.target.value
													})
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: library_module_css_default.drawerField,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "备注" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
													className: library_module_css_default.textarea,
													rows: 2,
													value: draft.note,
													onChange: (event) => setDraft({
														...draft,
														note: event.target.value
													})
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: library_module_css_default.drawerSplit,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: library_module_css_default.drawerField,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "类型" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
														className: library_module_css_default.input,
														value: draft.type,
														onChange: (event) => setDraft({
															...draft,
															type: event.target.value,
															category: ""
														}),
														children: TYPE_ORDER.map((type) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
															value: type,
															children: LIBRARY_TYPE_LABELS[type]
														}, type))
													})]
												}), draft.type === "voice" || draft.type === "tts" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: library_module_css_default.drawerField,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: draft.type === "voice" ? "分级（男/女）" : "音色键" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														className: library_module_css_default.input,
														list: "library-category-options",
														value: draft.category,
														onChange: (event) => setDraft({
															...draft,
															category: event.target.value
														}),
														placeholder: draft.type === "voice" ? "male / female / custom" : "voice 键"
													})]
												}) : null]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: library_module_css_default.primaryBtn,
												disabled: busy,
												onClick: () => void saveDraft(),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}), " 保存修改"]
											})
										]
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: library_module_css_default.drawerSection,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: library_module_css_default.drawerLabel,
											children: "来源（可追溯）"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: library_module_css_default.provenance,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: library_module_css_default.provRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provKey,
														children: "类型"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: library_module_css_default.provValue,
														children: [
															LIBRARY_TYPE_LABELS[detail.type],
															" · ",
															detail.provenance.mode
														]
													})]
												}),
												detail.provenance.channel !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: library_module_css_default.provRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provKey,
														children: "渠道"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provValue,
														children: detail.provenance.channel
													})]
												}) : null,
												detail.provenance.apiUrl !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: library_module_css_default.provRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provKey,
														children: "API 地址"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: `${library_module_css_default.provValue} ${library_module_css_default.mono}`,
														children: detail.provenance.apiUrl
													})]
												}) : null,
												detail.provenance.model !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: library_module_css_default.provRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provKey,
														children: "模型"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: library_module_css_default.provValue,
														children: [detail.provenance.model, detail.provenance.upstream !== void 0 && detail.provenance.upstream !== detail.provenance.model ? ` → ${detail.provenance.upstream}` : ""]
													})]
												}) : null,
												detail.provenance.voice !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: library_module_css_default.provRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provKey,
														children: "音色"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provValue,
														children: detail.provenance.voice
													})]
												}) : null,
												detail.provenance.voiceId !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: library_module_css_default.provRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provKey,
														children: "Voice ID"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: library_module_css_default.provValue,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
															className: library_module_css_default.code,
															children: detail.provenance.voiceId
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: library_module_css_default.iconBtn,
															title: "复制 Voice ID",
															onClick: () => void copyText(detail.provenance.voiceId, `vid-${detail.id}`),
															children: copied === `vid-${detail.id}` ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CopyIcon, {})
														})]
													})]
												}) : null,
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: library_module_css_default.provRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provKey,
														children: "提示词"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: `${library_module_css_default.provValue} ${library_module_css_default.promptText}`,
														children: detail.provenance.prompt || "—"
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: library_module_css_default.provRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provKey,
														children: "创建时间"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provValue,
														children: new Date(detail.createdAt).toLocaleString("zh-CN", { hour12: false })
													})]
												}),
												detail.provenance.params !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: library_module_css_default.provRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provKey,
														children: "生成参数"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: library_module_css_default.provValue,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
															className: library_module_css_default.paramsDetails,
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "查看参数快照" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
																className: library_module_css_default.code,
																children: JSON.stringify(detail.provenance.params, null, 2)
															})]
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: library_module_css_default.iconBtn,
															title: "复制参数 JSON",
															onClick: () => void copyText(JSON.stringify(detail.provenance.params, null, 2), `params-${detail.id}`),
															children: copied === `params-${detail.id}` ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CopyIcon, {})
														})]
													})]
												}) : null,
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: library_module_css_default.provRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: library_module_css_default.provKey,
														children: "文件"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: `${library_module_css_default.provValue} ${library_module_css_default.mono}`,
														children: [
															detail.files.length,
															" 段 · ",
															detail.files.map((file) => file.rel).join("，")
														]
													})]
												})
											]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: library_module_css_default.drawerActions,
										children: [detail.provenance.voiceId !== void 0 || detail.provenance.voice !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: library_module_css_default.primaryBtn,
											onClick: () => {
												props.onReuseVoice({
													mode: "tts",
													...detail.provenance.voiceId !== void 0 ? { voiceId: detail.provenance.voiceId } : {},
													...detail.provenance.voice !== void 0 ? { voice: detail.provenance.voice } : {},
													...detail.provenance.model !== void 0 ? { model: detail.provenance.model } : {}
												});
												setDetailId(null);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MicIcon, {}), " 用此音色去 TTS"]
										}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: library_module_css_default.dangerBtn,
											onClick: () => {
												if (confirmDelete === detail.id) doDelete([detail.id]);
												else setConfirmDelete(detail.id);
											},
											disabled: busy,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrashIcon, {}),
												" ",
												confirmDelete === detail.id ? "确认删除" : "删除资源"
											]
										})]
									})
								]
							})]
						})
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/AudioGenPanel.tsx
		/**
		* The AI 音频 panel shell: header with 生成 / 资源库 tabs, toast host, and
		* cross-tab hooks (library refresh after saves, «use this voice» reuse).
		*/
		function AudioGenPanel(props) {
			const { api, scope } = props;
			const [tab, setTab] = (0, react.useState)("studio");
			const [libraryRev, setLibraryRev] = (0, react.useState)(0);
			const [reuse, setReuse] = (0, react.useState)(null);
			const [toast, setToast] = (0, react.useState)(null);
			const toastTimer = (0, react.useRef)(void 0);
			const showToast = (text) => {
				setToast(text);
				if (toastTimer.current !== void 0) window.clearTimeout(toastTimer.current);
				toastTimer.current = window.setTimeout(() => setToast(null), 2400);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: audio_panel_module_css_default.panel,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: audio_panel_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: audio_panel_module_css_default.title,
							children: tt("panel.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: audio_panel_module_css_default.tabs,
							role: "tablist",
							"aria-label": "AI 音频",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "tab",
								"aria-selected": tab === "studio",
								className: audio_panel_module_css_default.tab,
								"data-active": tab === "studio" ? "true" : "false",
								onClick: () => setTab("studio"),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GridIcon, {}),
									" ",
									tt("tab.studio")
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "tab",
								"aria-selected": tab === "library",
								className: audio_panel_module_css_default.tab,
								"data-active": tab === "library" ? "true" : "false",
								onClick: () => setTab("library"),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListIcon, {}),
									" ",
									tt("tab.library")
								]
							})]
						})]
					}),
					tab === "studio" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StudioView, {
						api,
						scope,
						reuse,
						onLibraryChanged: () => setLibraryRev((revision) => revision + 1),
						showToast
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibraryView, {
						api,
						revision: libraryRev,
						showToast,
						onReuseVoice: (payload) => {
							setReuse({
								nonce: Date.now(),
								mode: payload.mode,
								...payload.voice === void 0 ? {} : { voice: payload.voice },
								...payload.voiceId === void 0 ? {} : { voiceId: payload.voiceId },
								...payload.model === void 0 ? {} : { model: payload.model }
							});
							setTab("studio");
						}
					}),
					toast !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: audio_panel_module_css_default.toast,
						role: "status",
						children: toast
					}) : null
				]
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
			"lightboxIndex": "rwa6qG_lightboxIndex",
			"lightboxScaleFrame": "rwa6qG_lightboxScaleFrame",
			"configGuideBody": "rwa6qG_configGuideBody",
			"footer": "rwa6qG_footer",
			"galleryClear": "rwa6qG_galleryClear",
			"taskRow": "rwa6qG_taskRow",
			"taskTrayChevron": "rwa6qG_taskTrayChevron",
			"compareToggle": "rwa6qG_compareToggle",
			"promptCount": "rwa6qG_promptCount",
			"galleryTagInput": "rwa6qG_galleryTagInput",
			"gallerySort": "rwa6qG_gallerySort",
			"panelTitle": "rwa6qG_panelTitle",
			"galleryCard": "rwa6qG_galleryCard",
			"historyThumb": "rwa6qG_historyThumb",
			"dshImageGenToastIn": "rwa6qG_dshImageGenToastIn",
			"modePill": "rwa6qG_modePill",
			"modelMenu": "rwa6qG_modelMenu",
			"lightboxClose": "rwa6qG_lightboxClose",
			"historyMeta": "rwa6qG_historyMeta",
			"compareModelChoices": "rwa6qG_compareModelChoices",
			"galleryImageButton": "rwa6qG_galleryImageButton",
			"connectionStatus": "rwa6qG_connectionStatus",
			"panel": "rwa6qG_panel",
			"paramGroup": "rwa6qG_paramGroup",
			"galleryTagFilter": "rwa6qG_galleryTagFilter",
			"optionPill": "rwa6qG_optionPill",
			"config": "rwa6qG_config",
			"historyFilters": "rwa6qG_historyFilters",
			"modelWrap": "rwa6qG_modelWrap",
			"lightboxCaptionRow": "rwa6qG_lightboxCaptionRow",
			"galleryToolbar": "rwa6qG_galleryToolbar",
			"modelSelect": "rwa6qG_modelSelect",
			"historySearch": "rwa6qG_historySearch",
			"comparisonFullscreenGrid": "rwa6qG_comparisonFullscreenGrid",
			"galleryTags": "rwa6qG_galleryTags",
			"referenceImage": "rwa6qG_referenceImage",
			"galleryAdd": "rwa6qG_galleryAdd",
			"lightboxEdit": "rwa6qG_lightboxEdit",
			"galleryTagFilterList": "rwa6qG_galleryTagFilterList",
			"optionGrid": "rwa6qG_optionGrid",
			"updateText": "rwa6qG_updateText",
			"historyInfo": "rwa6qG_historyInfo",
			"taskPrompt": "rwa6qG_taskPrompt",
			"prompt": "rwa6qG_prompt",
			"historyAction": "rwa6qG_historyAction",
			"canvasStateTitle": "rwa6qG_canvasStateTitle",
			"lightboxDownload": "rwa6qG_lightboxDownload",
			"gallerySelectionClear": "rwa6qG_gallerySelectionClear",
			"historyMain": "rwa6qG_historyMain",
			"galleryFilterDivider": "rwa6qG_galleryFilterDivider",
			"historyActions": "rwa6qG_historyActions",
			"uploadIcon": "rwa6qG_uploadIcon",
			"enhanceButton": "rwa6qG_enhanceButton",
			"paramHint": "rwa6qG_paramHint",
			"image": "rwa6qG_image",
			"gallerySearch": "rwa6qG_gallerySearch",
			"optionRow": "rwa6qG_optionRow",
			"taskTrayCount": "rwa6qG_taskTrayCount",
			"lightboxZoomLevel": "rwa6qG_lightboxZoomLevel",
			"taskTrayHeader": "rwa6qG_taskTrayHeader",
			"historyClear": "rwa6qG_historyClear",
			"canvasHistoryTag": "rwa6qG_canvasHistoryTag",
			"modelMenuList": "rwa6qG_modelMenuList",
			"lightbox": "rwa6qG_lightbox",
			"gallerySelectMode": "rwa6qG_gallerySelectMode",
			"galleryTagEdit": "rwa6qG_galleryTagEdit",
			"promptFooter": "rwa6qG_promptFooter",
			"comparisonBoard": "rwa6qG_comparisonBoard",
			"galleryCardInfo": "rwa6qG_galleryCardInfo",
			"history": "rwa6qG_history",
			"galleryRatio": "rwa6qG_galleryRatio",
			"taskTray": "rwa6qG_taskTray",
			"dshImageGenSpin": "rwa6qG_dshImageGenSpin",
			"galleryMasonry": "rwa6qG_galleryMasonry",
			"galleryFilterNote": "rwa6qG_galleryFilterNote",
			"galleryFilterHeading": "rwa6qG_galleryFilterHeading",
			"updateActions": "rwa6qG_updateActions",
			"lightboxTool": "rwa6qG_lightboxTool",
			"referenceActions": "rwa6qG_referenceActions",
			"entryIcon": "rwa6qG_entryIcon",
			"historyEmpty": "rwa6qG_historyEmpty",
			"historyTitle": "rwa6qG_historyTitle",
			"galleryRatioList": "rwa6qG_galleryRatioList",
			"galleryHeading": "rwa6qG_galleryHeading",
			"galleryCardFooter": "rwa6qG_galleryCardFooter",
			"taskTrayToggle": "rwa6qG_taskTrayToggle",
			"updateRelease": "rwa6qG_updateRelease",
			"lightboxStage": "rwa6qG_lightboxStage",
			"galleryWorkspace": "rwa6qG_galleryWorkspace",
			"galleryBulkButton": "rwa6qG_galleryBulkButton",
			"card": "rwa6qG_card",
			"lightboxTools": "rwa6qG_lightboxTools",
			"historyPrompt": "rwa6qG_historyPrompt",
			"lightboxMeta": "rwa6qG_lightboxMeta",
			"grid": "rwa6qG_grid",
			"uploadHint": "rwa6qG_uploadHint",
			"modeRow": "rwa6qG_modeRow",
			"uploadBox": "rwa6qG_uploadBox",
			"entry": "rwa6qG_entry",
			"canvas": "rwa6qG_canvas",
			"configGuide": "rwa6qG_configGuide",
			"generateButton": "rwa6qG_generateButton",
			"configScroll": "rwa6qG_configScroll",
			"spinner": "rwa6qG_spinner",
			"canvasEmptyIcon": "rwa6qG_canvasEmptyIcon",
			"comparisonGrid": "rwa6qG_comparisonGrid",
			"view": "rwa6qG_view",
			"galleryFilter": "rwa6qG_galleryFilter",
			"entryLabel": "rwa6qG_entryLabel",
			"panelHeader": "rwa6qG_panelHeader",
			"panelHeading": "rwa6qG_panelHeading",
			"bigSpinner": "rwa6qG_bigSpinner",
			"historyList": "rwa6qG_historyList",
			"taskTrayClose": "rwa6qG_taskTrayClose",
			"imageCaption": "rwa6qG_imageCaption",
			"lightboxNav": "rwa6qG_lightboxNav",
			"imageCard": "rwa6qG_imageCard",
			"taskRows": "rwa6qG_taskRows",
			"canvasState": "rwa6qG_canvasState",
			"lightboxFigure": "rwa6qG_lightboxFigure",
			"connectionDot": "rwa6qG_connectionDot",
			"updateBanner": "rwa6qG_updateBanner",
			"galleryAvatar": "rwa6qG_galleryAvatar",
			"galleryTagEditor": "rwa6qG_galleryTagEditor",
			"studio": "rwa6qG_studio",
			"generateInner": "rwa6qG_generateInner",
			"download": "rwa6qG_download",
			"lightboxImage": "rwa6qG_lightboxImage",
			"historyHeader": "rwa6qG_historyHeader",
			"lightboxCaption": "rwa6qG_lightboxCaption",
			"modelMenuItem": "rwa6qG_modelMenuItem",
			"lightboxActions": "rwa6qG_lightboxActions",
			"galleryToast": "rwa6qG_galleryToast",
			"comparisonImageButton": "rwa6qG_comparisonImageButton",
			"historyThumbPlaceholder": "rwa6qG_historyThumbPlaceholder",
			"lightboxCopy": "rwa6qG_lightboxCopy",
			"taskStatus": "rwa6qG_taskStatus",
			"paramLabel": "rwa6qG_paramLabel",
			"canvasMeta": "rwa6qG_canvasMeta",
			"compareControl": "rwa6qG_compareControl",
			"gallerySelectionBar": "rwa6qG_gallerySelectionBar",
			"galleryRemove": "rwa6qG_galleryRemove",
			"galleryImage": "rwa6qG_galleryImage",
			"canvasBody": "rwa6qG_canvasBody",
			"galleryBadge": "rwa6qG_galleryBadge",
			"galleryFilterCount": "rwa6qG_galleryFilterCount",
			"modelLabel": "rwa6qG_modelLabel",
			"galleryCount": "rwa6qG_galleryCount",
			"hiddenFile": "rwa6qG_hiddenFile",
			"galleryFilters": "rwa6qG_galleryFilters",
			"comparisonFullscreen": "rwa6qG_comparisonFullscreen",
			"galleryToolbarActions": "rwa6qG_galleryToolbarActions",
			"zoomHint": "rwa6qG_zoomHint",
			"reference": "rwa6qG_reference",
			"galleryViewToggle": "rwa6qG_galleryViewToggle",
			"canvasStateHint": "rwa6qG_canvasStateHint",
			"templatesButton": "rwa6qG_templatesButton",
			"githubLink": "rwa6qG_githubLink",
			"gallerySelect": "rwa6qG_gallerySelect",
			"historyItem": "rwa6qG_historyItem",
			"canvasError": "rwa6qG_canvasError"
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
		const css$1 = ".zmjoSq_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.zmjoSq_card:hover{border-color:var(--dsw-alias-label-dimmed)}.zmjoSq_card:has(.zmjoSq_body){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.zmjoSq_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.zmjoSq_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.zmjoSq_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.zmjoSq_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.zmjoSq_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.zmjoSq_chevron,.zmjoSq_chevronOpen{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.zmjoSq_chevronOpen{transform:rotate(180deg)}.zmjoSq_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.zmjoSq_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.zmjoSq_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.zmjoSq_field+.zmjoSq_field{border-top:1px solid var(--dsw-alias-border-l2)}.zmjoSq_head{align-items:center;gap:8px;display:flex}.zmjoSq_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.zmjoSq_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.zmjoSq_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.zmjoSq_reset:disabled{cursor:default;opacity:.5}.zmjoSq_input,.zmjoSq_select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;outline:none;padding:0 12px;font-size:13px;line-height:1.5}.zmjoSq_input:focus-visible,.zmjoSq_select:focus-visible{border-color:var(--dsw-alias-brand-primary)}.zmjoSq_input:disabled,.zmjoSq_select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.zmjoSq_sectionTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;line-height:1.4}.zmjoSq_sectionHint{color:var(--dsw-alias-label-tertiary);margin:-4px 0 2px;font-size:12px;line-height:1.5}.zmjoSq_sectionHeader{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.zmjoSq_sectionHeader .zmjoSq_sectionHint{max-width:430px}.zmjoSq_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}.zmjoSq_link{color:var(--dsw-alias-brand-primary);text-decoration:none}.zmjoSq_link:hover{text-decoration:underline}.zmjoSq_channelSection{padding:6px 0 2px}.zmjoSq_channelEmpty{color:var(--dsw-alias-label-tertiary);margin:10px 0 0;font-size:12px;line-height:1.5}.zmjoSq_channelList{flex-direction:column;gap:6px;margin:10px 0 0;padding:0;list-style:none;display:flex}.zmjoSq_channelRow{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;align-items:center;gap:10px;padding:8px 10px;display:flex}.zmjoSq_channelRow[data-action]{flex-wrap:wrap}.zmjoSq_channelDotReady,.zmjoSq_channelDotWarn{border-radius:50%;flex:none;width:9px;height:9px}.zmjoSq_channelDotReady{background:var(--dsw-color-success,#2fbf71)}.zmjoSq_channelDotWarn{background:var(--dsw-color-danger,#e5484d)}.zmjoSq_channelMain{appearance:none;min-width:0;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;flex-direction:column;flex:1;gap:3px;padding:0;display:flex}.zmjoSq_channelName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:1.4;overflow:hidden}.zmjoSq_channelMeta{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}.zmjoSq_channelHost{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;font-family:var(--dsw-font-family-mono,monospace);text-overflow:ellipsis;white-space:nowrap;max-width:180px;overflow:hidden}.zmjoSq_channelBadge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:0 7px;font-size:11px;font-weight:500;line-height:17px}.zmjoSq_channelBadge[data-warn]{color:var(--dsw-alias-label-error)}.zmjoSq_channelAction{appearance:none;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;flex:none;padding:4px 8px;font-size:12px;line-height:1.5}.zmjoSq_channelAction:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform)}.zmjoSq_channelAction[data-danger]{color:var(--dsw-alias-label-error)}.zmjoSq_channelAction:disabled{opacity:.45;cursor:default}.zmjoSq_channelDanger{appearance:none;border:1px solid var(--dsw-alias-label-error);color:var(--dsw-alias-label-error);font:inherit;cursor:pointer;background:0 0;border-radius:6px;flex:none;padding:3px 10px;font-size:12px}.zmjoSq_channelDanger:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-label-error) 12%, transparent)}.zmjoSq_channelDanger:disabled{opacity:.45;cursor:default}.zmjoSq_deleteConfirmText{min-width:0;color:var(--dsw-alias-label-error);flex:1;font-size:12px;line-height:1.5}.zmjoSq_channelAddRow{flex-wrap:wrap;gap:10px;margin-top:10px;display:flex}.zmjoSq_channelAdd{appearance:none;border:1px dashed var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));min-width:180px;min-height:44px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:12px;flex:1 1 0;padding:0 12px;font-size:12px}.zmjoSq_channelAdd:hover:not(:disabled){color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}.zmjoSq_channelAdd:disabled{opacity:.45;cursor:default}.zmjoSq_editorWrap{margin-top:10px}.zmjoSq_channelEditor{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:12px;flex-direction:column;gap:2px;padding:14px 16px;display:flex}.zmjoSq_editorHeader{align-items:baseline;gap:8px;padding-bottom:4px;display:flex}.zmjoSq_editorTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:22px}.zmjoSq_editorTag{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.zmjoSq_customSettings{border-top:1px solid var(--dsw-alias-border-l2);margin-top:6px;padding-top:10px}.zmjoSq_customSettingsSummary{cursor:pointer;width:fit-content;color:var(--dsw-alias-label-secondary);border-radius:6px;align-items:center;gap:6px;margin-left:-4px;padding:2px 4px;font-size:12px;font-weight:500;line-height:18px;list-style:none;display:flex}.zmjoSq_customSettingsSummary::-webkit-details-marker{display:none}.zmjoSq_customSettingsSummary:before{content:\"\";border-bottom:1.5px solid;border-right:1.5px solid;width:5px;height:5px;transition:transform .12s;transform:rotate(-45deg)translate(-1px,-1px)}.zmjoSq_customSettings[open]>.zmjoSq_customSettingsSummary:before{transform:rotate(45deg)translate(-1px,-1px)}.zmjoSq_customSettingsSummary:hover{color:var(--dsw-alias-label-primary)}.zmjoSq_customSettingsSummary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.zmjoSq_customSettingsBody{flex-direction:column;gap:6px;padding-top:10px;display:flex}.zmjoSq_modelCatalog{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:10px;margin-top:6px;padding-top:12px;display:flex}.zmjoSq_modelCatalogHead{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.zmjoSq_modelCatalogTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5;display:block}.zmjoSq_modelCatalogMeta{color:var(--dsw-alias-label-tertiary);margin-top:1px;font-size:12px;line-height:1.5;display:block}.zmjoSq_linkButton{box-sizing:border-box;height:28px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:none;border-radius:14px;align-items:center;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}.zmjoSq_linkButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-module-platform));color:var(--dsw-alias-label-secondary)}.zmjoSq_linkButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.zmjoSq_linkButton:disabled{opacity:.5;cursor:default}.zmjoSq_modelEmpty{border:1px dashed var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));text-align:center;color:var(--dsw-alias-label-tertiary);border-radius:8px;margin:0;padding:12px;font-size:12px;line-height:18px}.zmjoSq_modelRows{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.zmjoSq_modelRow{grid-template-columns:minmax(0,1fr) auto minmax(0,1.2fr) auto auto;align-items:center;gap:6px;display:grid}.zmjoSq_modelInput{min-width:0;height:32px}.zmjoSq_modelArrow{color:var(--dsw-alias-label-tertiary);font-size:12px}.zmjoSq_modelCategorySelect{cursor:pointer;min-width:0;max-width:108px;height:32px;padding:0 6px}.zmjoSq_modelRowRemove{appearance:none;width:24px;height:24px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:6px;flex:none;padding:0;font-size:14px;line-height:24px}.zmjoSq_modelRowRemove:hover:not(:disabled){color:var(--dsw-alias-label-error);background:var(--dsw-alias-bg-module-platform)}.zmjoSq_modelRowRemove:disabled{opacity:.45;cursor:default}.zmjoSq_modelCatalogTools{align-items:center;gap:8px;display:flex}.zmjoSq_addModel{appearance:none;border:1px solid var(--dsw-alias-border-l2);min-height:30px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;padding:0 12px;font-size:12px}.zmjoSq_addModel:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.zmjoSq_addModel:disabled{opacity:.45;cursor:default}.zmjoSq_modelBadge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;padding:0 7px;font-size:11px;line-height:17px}.zmjoSq_detectOk{color:var(--dsw-color-success,var(--dsw-alias-label-secondary));margin:0;font-size:12px;line-height:1.5}.zmjoSq_candidatePanel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}.zmjoSq_candidateHead{justify-content:space-between;align-items:center;gap:12px;display:flex}.zmjoSq_candidateTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}.zmjoSq_candidateList{flex-direction:column;gap:4px;max-height:220px;margin:0;padding:0;list-style:none;display:flex;overflow-y:auto}.zmjoSq_candidate{align-items:center;display:flex}.zmjoSq_candidateLabel{min-width:0;color:var(--dsw-alias-label-secondary);cursor:pointer;align-items:center;gap:7px;padding:4px 2px;font-size:12px;line-height:1.5;display:inline-flex}.zmjoSq_candidateLabel input{margin:0}.zmjoSq_candidateLabel:has(input:disabled){opacity:.55;cursor:default}.zmjoSq_candidateId{text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-family-mono,monospace);overflow:hidden}.zmjoSq_candidateActions{justify-content:flex-end;align-items:center;gap:8px;display:flex}.zmjoSq_footer,.zmjoSq_editorFooter{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.zmjoSq_editorFooter{margin-top:8px}.zmjoSq_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}.zmjoSq_discard,.zmjoSq_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.zmjoSq_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.zmjoSq_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.zmjoSq_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.zmjoSq_discard:disabled,.zmjoSq_save:disabled{opacity:.4;cursor:default}.zmjoSq_discard:focus-visible,.zmjoSq_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}@media (prefers-reduced-motion:reduce){.zmjoSq_card,.zmjoSq_chevron,.zmjoSq_chevronOpen{transition:none}}";
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
			"card": "zmjoSq_card",
			"label": "zmjoSq_label",
			"channelAddRow": "zmjoSq_channelAddRow",
			"channelEditor": "zmjoSq_channelEditor",
			"channelMeta": "zmjoSq_channelMeta",
			"modelCatalogMeta": "zmjoSq_modelCatalogMeta",
			"failed": "zmjoSq_failed",
			"channelList": "zmjoSq_channelList",
			"editorHeader": "zmjoSq_editorHeader",
			"channelSection": "zmjoSq_channelSection",
			"channelAdd": "zmjoSq_channelAdd",
			"modelCatalog": "zmjoSq_modelCatalog",
			"field": "zmjoSq_field",
			"candidatePanel": "zmjoSq_candidatePanel",
			"candidateActions": "zmjoSq_candidateActions",
			"modelCatalogTools": "zmjoSq_modelCatalogTools",
			"chevronOpen": "zmjoSq_chevronOpen",
			"chevron": "zmjoSq_chevron",
			"discard": "zmjoSq_discard",
			"channelEmpty": "zmjoSq_channelEmpty",
			"select": "zmjoSq_select",
			"customSettingsSummary": "zmjoSq_customSettingsSummary",
			"editorTitle": "zmjoSq_editorTitle",
			"deleteConfirmText": "zmjoSq_deleteConfirmText",
			"body": "zmjoSq_body",
			"channelName": "zmjoSq_channelName",
			"channelHost": "zmjoSq_channelHost",
			"modelCatalogTitle": "zmjoSq_modelCatalogTitle",
			"modelEmpty": "zmjoSq_modelEmpty",
			"sectionHeader": "zmjoSq_sectionHeader",
			"channelRow": "zmjoSq_channelRow",
			"name": "zmjoSq_name",
			"editorTag": "zmjoSq_editorTag",
			"channelDotWarn": "zmjoSq_channelDotWarn",
			"addModel": "zmjoSq_addModel",
			"headText": "zmjoSq_headText",
			"candidateHead": "zmjoSq_candidateHead",
			"detectOk": "zmjoSq_detectOk",
			"channelMain": "zmjoSq_channelMain",
			"input": "zmjoSq_input",
			"channelBadge": "zmjoSq_channelBadge",
			"channelAction": "zmjoSq_channelAction",
			"editorWrap": "zmjoSq_editorWrap",
			"sectionHint": "zmjoSq_sectionHint",
			"header": "zmjoSq_header",
			"customSettings": "zmjoSq_customSettings",
			"candidateLabel": "zmjoSq_candidateLabel",
			"linkButton": "zmjoSq_linkButton",
			"candidateId": "zmjoSq_candidateId",
			"description": "zmjoSq_description",
			"candidate": "zmjoSq_candidate",
			"link": "zmjoSq_link",
			"modelCatalogHead": "zmjoSq_modelCatalogHead",
			"customSettingsBody": "zmjoSq_customSettingsBody",
			"modelRow": "zmjoSq_modelRow",
			"modelRowRemove": "zmjoSq_modelRowRemove",
			"modelCategorySelect": "zmjoSq_modelCategorySelect",
			"modelRows": "zmjoSq_modelRows",
			"editorFooter": "zmjoSq_editorFooter",
			"channelDotReady": "zmjoSq_channelDotReady",
			"reset": "zmjoSq_reset",
			"modelArrow": "zmjoSq_modelArrow",
			"readOnly": "zmjoSq_readOnly",
			"footer": "zmjoSq_footer",
			"candidateList": "zmjoSq_candidateList",
			"modelInput": "zmjoSq_modelInput",
			"candidateTitle": "zmjoSq_candidateTitle",
			"save": "zmjoSq_save",
			"modelBadge": "zmjoSq_modelBadge",
			"channelDanger": "zmjoSq_channelDanger",
			"sectionTitle": "zmjoSq_sectionTitle",
			"pending": "zmjoSq_pending"
		};
		//#endregion
		//#region src/client/SettingsCard.tsx
		/**
		* The dsh-audiogen settings card.
		*
		* Registers into the official `settings.plugin.item` slot. It manages a list
		* of audio channels (each with API URL, per-channel secret, and model/voice
		* catalog), plus master switches.
		*
		* Channel management follows the DSH "模型" settings pattern: provider rows
		* with a status dot and 编辑/删除 actions, and two equal-width add actions
		* (「添加提供方」 / 「添加自定义提供方」) below. Both add and edit open the
		* same inline editor card — provider select, API key, 自定义设置 (API 地址)
		* and a 模型目录 with 「获取可用模型」 discovery and per-row model editing.
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
					textField("defaultModel"),
					booleanField("autoSaveToLibrary"),
					textField("maxConcurrentGenerations"),
					textField("enhanceModel")
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
					defaultModel: this.form.field("defaultModel"),
					autoSaveToLibrary: this.form.field("autoSaveToLibrary"),
					maxConcurrentGenerations: this.form.field("maxConcurrentGenerations"),
					enhanceModel: this.form.field("enhanceModel")
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
		const MODEL_CATEGORIES = [
			void 0,
			"tts",
			"music",
			"sfx",
			"voice_design",
			"voice_clone"
		];
		function newChannelId() {
			return `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		}
		/** Strip a draft before staging: empty rows removed, aliases default to ids. */
		function cleanModels(models) {
			const cleaned = models.map((model) => {
				const alias = model.alias.trim();
				const id = model.id.trim() === "" ? alias : model.id.trim();
				if (alias === "" && id === "") return void 0;
				return {
					alias: alias === "" ? id : alias,
					id,
					...model.category === void 0 ? {} : { category: model.category }
				};
			}).filter((model) => model !== void 0);
			return [...new Map(cleaned.map((model) => [model.alias, model])).values()];
		}
		/** Translate one key with interpolation (the injected `t` takes no values). */
		function tpl(t, key, values) {
			let text = t(key);
			if (values === void 0) return text;
			for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
			return text;
		}
		function rowsOf(models) {
			return models.map((model, index) => ({
				...model,
				rowKey: `m-${index}-${model.alias}-${model.id}`
			}));
		}
		function ChannelEditor(props) {
			const { t, writable, mode, presets } = props;
			const [presetId, setPresetId] = (0, react.useState)(mode.kind === "add-provider" ? presets[0]?.id ?? "" : "");
			const invited = (0, react.useMemo)(() => mode.kind === "add-provider" ? presets.find((preset) => preset.id === presetId) : void 0, [
				mode,
				presets,
				presetId
			]);
			const [name, setName] = (0, react.useState)(props.channel?.name ?? invited?.name ?? "");
			const [url, setUrl] = (0, react.useState)(props.channel?.apiUrl ?? invited?.apiUrl ?? "");
			const [models, setModels] = (0, react.useState)(rowsOf(props.channel?.models ?? invited?.models ?? []));
			const [key, setKey] = (0, react.useState)("");
			const [keyAction, setKeyAction] = (0, react.useState)("none");
			const [isDefault, setIsDefault] = (0, react.useState)(props.initiallyDefault);
			const [discovering, setDiscovering] = (0, react.useState)(false);
			const [discoverError, setDiscoverError] = (0, react.useState)(null);
			const [candidates, setCandidates] = (0, react.useState)(null);
			const [picked, setPicked] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [sourceNote, setSourceNote] = (0, react.useState)(null);
			const usePreset = (preset) => {
				setPresetId(preset?.id ?? "");
				setName(preset?.name ?? "");
				setUrl(preset?.apiUrl ?? "");
				setModels(rowsOf(preset?.models ?? []));
				setKey("");
				setKeyAction("none");
			};
			const effectiveKeyHeld = props.keyHeld && keyAction !== "clear";
			const save = () => {
				const channel = {
					id: props.channel?.id ?? newChannelId(),
					preset: mode.kind === "edit" ? props.channel?.preset ?? "" : mode.kind === "add-custom" ? "" : invited?.id ?? "",
					name: name.trim(),
					apiUrl: url.trim(),
					models: cleanModels(models)
				};
				const stagedKey = key.trim() !== "" ? key.trim() : keyAction === "clear" ? "" : void 0;
				props.onSave(channel, stagedKey, isDefault);
			};
			const discoverable = url.trim() !== "" && (key.trim() !== "" || effectiveKeyHeld);
			const discover = async () => {
				if (!discoverable) return;
				setDiscovering(true);
				setDiscoverError(null);
				setSourceNote(null);
				try {
					const response = await fetch(MODEL_API.discover, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							channelId: props.channel?.id ?? "preview",
							preset: mode.kind === "add-provider" ? invited?.id ?? "" : props.channel?.preset ?? "",
							apiUrl: url.trim(),
							...key.trim() !== "" ? { apiKey: key.trim() } : {}
						})
					});
					const body = await response.json();
					if (body.ok !== true || body.models === void 0) throw new Error(body.message ?? `HTTP ${response.status}`);
					const known = new Set(models.map((model) => model.id.trim()).filter(Boolean));
					const found = body.models.map((model) => ({
						...model,
						id: model.id.trim()
					})).filter((model) => model.id !== "");
					if (found.length === 0) {
						setDiscoverError(t("channel.fetchEmpty"));
						return;
					}
					setCandidates(found);
					setPicked(new Set(found.filter((model) => !known.has(model.id)).map((model) => model.id)));
					setSourceNote(body.source ?? null);
				} catch (error) {
					setDiscoverError(error instanceof Error ? error.message : String(error));
				} finally {
					setDiscovering(false);
				}
			};
			const closeCandidates = () => {
				setCandidates(null);
				setPicked(/* @__PURE__ */ new Set());
			};
			const adoptCandidates = () => {
				if (candidates === null) return;
				const existing = [...models];
				const byId = new Map(existing.map((model, index) => [model.id.trim(), {
					model,
					index
				}]));
				for (const candidate of candidates) {
					const id = candidate.id.trim();
					if (id === "" || !picked.has(id)) continue;
					if (byId.has(id)) continue;
					byId.set(id, {
						model: {
							rowKey: `m-${Date.now()}-${existing.length}`,
							alias: candidate.alias,
							id,
							...candidate.category === void 0 ? {} : { category: candidate.category }
						},
						index: existing.length
					});
					existing.push(byId.get(id).model);
				}
				setModels(existing);
				closeCandidates();
			};
			const patchModel = (index, next) => {
				setModels(models.map((model, at) => at === index ? {
					...model,
					...next
				} : model));
			};
			const presetPlaceholder = invited?.apiUrl ?? t("channel.apiUrlPlaceholder");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: settings_card_module_css_default.channelEditor,
				children: [
					mode.kind === "add-provider" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.field,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: settings_card_module_css_default.label,
								htmlFor: "audiogen-editor-provider",
								children: t("channel.provider")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								id: "audiogen-editor-provider",
								className: settings_card_module_css_default.select,
								value: presetId,
								disabled: !writable,
								onChange: (event) => usePreset(presets.find((preset) => preset.id === event.target.value)),
								children: presets.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: preset.id,
									children: preset.name
								}, preset.id))
							}),
							invited?.site !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: settings_card_module_css_default.sectionHint,
								children: [
									t("channel.site"),
									"：",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										className: settings_card_module_css_default.link,
										href: invited.site,
										target: "_blank",
										rel: "noreferrer",
										children: invited.site
									})
								]
							}) : null
						]
					}) : null,
					mode.kind === "add-custom" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.label,
							children: t("channel.provider")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: settings_card_module_css_default.sectionHint,
							children: [
								t("channel.providerCustom"),
								" — ",
								t("channel.providerCustomHint")
							]
						})]
					}) : null,
					mode.kind === "edit" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.editorHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.editorTitle,
							children: props.channel?.name.trim() !== "" ? props.channel?.name : t("channels.untitled")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.editorTag,
							children: mode.kind === "edit" ? t("channel.editTitle") : ""
						})]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: settings_card_module_css_default.label,
							htmlFor: "audiogen-editor-name",
							children: t("channel.name")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: "audiogen-editor-name",
							className: settings_card_module_css_default.input,
							value: name,
							placeholder: t("channel.namePlaceholder"),
							disabled: !writable,
							onChange: (event) => setName(event.target.value)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.field,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: settings_card_module_css_default.head,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									className: settings_card_module_css_default.label,
									htmlFor: "audiogen-editor-key",
									children: t("channel.apiKey")
								}), effectiveKeyHeld && key.trim() === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.reset,
									disabled: !writable,
									onClick: () => {
										setKeyAction("clear");
										setKey("");
									},
									children: t("channel.clearKey")
								}) : null]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: "audiogen-editor-key",
								className: settings_card_module_css_default.input,
								type: "password",
								value: key,
								autoComplete: "off",
								placeholder: effectiveKeyHeld ? "••••••••" : "",
								disabled: !writable,
								onChange: (event) => {
									setKey(event.target.value);
									if (event.target.value !== "") setKeyAction("none");
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: settings_card_module_css_default.sectionHint,
								children: effectiveKeyHeld ? t("channel.apiKeyStoredHint") : t("channel.apiKeyHint")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: settings_card_module_css_default.customSettings,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
							className: settings_card_module_css_default.customSettingsSummary,
							children: t("channel.customSettings")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: settings_card_module_css_default.customSettingsBody,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: settings_card_module_css_default.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: settings_card_module_css_default.label,
										htmlFor: "audiogen-editor-url",
										children: t("channel.apiUrl")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "audiogen-editor-url",
										className: settings_card_module_css_default.input,
										type: "text",
										value: url,
										placeholder: presetPlaceholder,
										disabled: !writable,
										onChange: (event) => setUrl(event.target.value)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: settings_card_module_css_default.sectionHint,
										children: t("channel.apiUrlHint")
									})
								]
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelCatalog, {
						t,
						writable,
						models,
						discoverable,
						discovering,
						discoverError,
						candidates,
						picked,
						sourceNote,
						onPatchModel: patchModel,
						onRemoveModel: (index) => setModels(models.filter((_model, at) => at !== index)),
						onAddModel: () => setModels([...models, {
							rowKey: `m-${Date.now()}-${models.length}`,
							alias: "",
							id: ""
						}]),
						onDiscover: () => void discover(),
						onTogglePicked: (id) => {
							setPicked((current) => {
								const next = new Set(current);
								if (!next.delete(id)) next.add(id);
								return next;
							});
						},
						onToggleAllPicked: () => {
							setPicked((current) => candidates !== null && candidates.length > 0 && candidates.every((candidate) => current.has(candidate.id)) ? /* @__PURE__ */ new Set() : new Set((candidates ?? []).map((candidate) => candidate.id)));
						},
						onAdopt: () => adoptCandidates(),
						onCloseCandidates: closeCandidates
					}),
					/stability/i.test(`${props.channel?.preset ?? invited?.id ?? presetId}|${url}`) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.sectionHint,
						children: t("channel.stabilityHint")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: settings_card_module_css_default.field,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: settings_card_module_css_default.label,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: isDefault,
									disabled: !writable,
									onChange: (event) => setIsDefault(event.target.checked)
								}),
								" ",
								t("channel.default")
							]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.editorFooter,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: settings_card_module_css_default.discard,
							onClick: props.onCancel,
							children: t("channel.cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: settings_card_module_css_default.save,
							onClick: save,
							children: t("channel.save")
						})]
					})
				]
			});
		}
		function ModelCatalog(props) {
			const { t, writable, models, discoverable, discovering, candidates, picked } = props;
			const allPicked = candidates !== null && candidates.length > 0 && candidates.every((candidate) => picked.has(candidate.id));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: settings_card_module_css_default.modelCatalog,
				"aria-label": t("channel.modelsTitle"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.modelCatalogHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.modelCatalogTitle,
							children: t("channel.modelsTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: settings_card_module_css_default.modelCatalogMeta,
							children: models.length > 0 ? tpl(t, "channel.modelsCount", { n: models.length }) : t("channel.modelsNone")
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: settings_card_module_css_default.linkButton,
							disabled: !writable || discovering || !discoverable,
							title: discoverable ? void 0 : t("channel.discoverNeedsUrlKey"),
							onClick: props.onDiscover,
							children: discovering ? t("channel.fetchingModels") : t("channel.fetchModels")
						})]
					}),
					models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.modelEmpty,
						children: t("channel.modelsEmpty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: settings_card_module_css_default.modelRows,
						children: models.map((model, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: settings_card_module_css_default.modelRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: `${settings_card_module_css_default.input} ${settings_card_module_css_default.modelInput}`,
									type: "text",
									value: model.alias,
									placeholder: t("channel.modelAlias"),
									"aria-label": `${t("channel.modelAlias")} ${index + 1}`,
									disabled: !writable,
									onChange: (event) => props.onPatchModel(index, { alias: event.target.value })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: settings_card_module_css_default.modelArrow,
									"aria-hidden": "true",
									children: "→"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: `${settings_card_module_css_default.input} ${settings_card_module_css_default.modelInput}`,
									type: "text",
									value: model.id,
									placeholder: t("channel.modelId"),
									"aria-label": `${t("channel.modelId")} ${index + 1}`,
									disabled: !writable,
									onChange: (event) => props.onPatchModel(index, { id: event.target.value })
								}),
								/^stable-audio-/i.test(model.id) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: `${settings_card_module_css_default.select} ${settings_card_module_css_default.modelCategorySelect}`,
									value: "__stable-dual__",
									"aria-label": `${t("channel.modelCategory")} ${index + 1}`,
									disabled: true,
									title: t("channel.category.stableDualHint"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "__stable-dual__",
										children: t("channel.category.stableDual")
									})
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: `${settings_card_module_css_default.select} ${settings_card_module_css_default.modelCategorySelect}`,
									value: model.category ?? "",
									"aria-label": `${t("channel.modelCategory")} ${index + 1}`,
									disabled: !writable,
									onChange: (event) => {
										const value = event.target.value;
										props.onPatchModel(index, value === "" ? { category: void 0 } : { category: value });
									},
									children: MODEL_CATEGORIES.map((category) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: category ?? "",
										children: category === void 0 ? t("channel.category.auto") : t(`channel.category.${category}`)
									}, category ?? "auto"))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.modelRowRemove,
									"aria-label": t("channel.removeModel"),
									disabled: !writable,
									onClick: () => props.onRemoveModel(index),
									children: "×"
								})
							]
						}, `${model.rowKey}-${index}`))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: settings_card_module_css_default.modelCatalogTools,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: settings_card_module_css_default.addModel,
							disabled: !writable,
							onClick: props.onAddModel,
							children: t("channel.addModel")
						})
					}),
					props.sourceNote !== null && props.candidates !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.detectOk,
						children: tpl(t, "channel.discoverSource", { source: props.sourceNote })
					}) : null,
					props.discoverError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: settings_card_module_css_default.failed,
						children: props.discoverError
					}) : null,
					candidates === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: settings_card_module_css_default.candidatePanel,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: settings_card_module_css_default.candidateHead,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: settings_card_module_css_default.candidateTitle,
									children: tpl(t, "channel.candidates", { n: candidates.length })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.linkButton,
									onClick: props.onToggleAllPicked,
									children: allPicked ? t("channel.clearSelection") : t("channel.selectAll")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: settings_card_module_css_default.candidateList,
								children: candidates.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
									className: settings_card_module_css_default.candidate,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: settings_card_module_css_default.candidateLabel,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: picked.has(candidate.id),
												disabled: models.some((model) => model.id.trim() === candidate.id),
												onChange: () => props.onTogglePicked(candidate.id)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: settings_card_module_css_default.candidateId,
												children: candidate.alias === candidate.id ? candidate.id : `${candidate.alias}（${candidate.id}）`
											}),
											candidate.category !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: settings_card_module_css_default.modelBadge,
												children: t(`channel.category.${candidate.category}`)
											}) : null
										]
									})
								}, candidate.id))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: settings_card_module_css_default.candidateActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.discard,
									onClick: props.onCloseCandidates,
									children: t("channel.cancel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: settings_card_module_css_default.save,
									onClick: props.onAdopt,
									children: tpl(t, "channel.adoptSelected", { n: Array.from(picked).length })
								})]
							})
						]
					})
				]
			});
		}
		function AudioGenSettingsCard(props) {
			const { t } = props;
			const state = props.useAudioGenSettingsCard((snapshot) => snapshot);
			const [open, setOpen] = (0, react.useState)(false);
			const [editor, setEditor] = (0, react.useState)(null);
			const [presets, setPresets] = (0, react.useState)([]);
			const [presetLoading, setPresetLoading] = (0, react.useState)(false);
			const [presetError, setPresetError] = (0, react.useState)(null);
			const [confirmDeleteId, setConfirmDeleteId] = (0, react.useState)(null);
			const [llmModels, setLlmModels] = (0, react.useState)(null);
			const [llmModelsError, setLlmModelsError] = (0, react.useState)(null);
			const channels = state.channels.channels;
			const editingChannel = editor !== null && editor.kind === "edit" ? channels.find((channel) => channel.id === editor.channelId) : void 0;
			(0, react.useEffect)(() => {
				if (editor?.kind === "add-provider" && presets.length === 0 && presetError === null && !presetLoading) {
					setPresetLoading(true);
					setPresetError(null);
					fetch(PRESETS_API, { method: "POST" }).then(async (response) => {
						const body = await response.json();
						if (!response.ok || body.ok !== true || body.presets === void 0) throw new Error(body.message ?? `HTTP ${response.status}`);
						setPresets(body.presets);
					}).catch((error) => setPresetError(error instanceof Error ? error.message : String(error))).finally(() => setPresetLoading(false));
				}
			}, [
				editor,
				presets.length,
				presetError,
				presetLoading
			]);
			(0, react.useEffect)(() => {
				if (!open || llmModels !== null || llmModelsError !== null) return;
				fetch(LLM_MODELS_API, { method: "POST" }).then(async (response) => {
					const body = await response.json();
					if (!response.ok || body.ok !== true || body.providers === void 0) throw new Error(body.message ?? `HTTP ${response.status}`);
					setLlmModels(body.providers);
				}).catch((error) => setLlmModelsError(error instanceof Error ? error.message : String(error)));
			}, [
				open,
				llmModels,
				llmModelsError
			]);
			if (!state.available) return null;
			const blocked = !state.dirty || state.invalid || state.saving || state.channels.saving;
			const closeEditor = () => {
				setEditor(null);
			};
			const saveEditor = (channel, key, isDefault) => {
				const next = channels.some((candidate) => candidate.id === channel.id) ? channels.map((candidate) => candidate.id === channel.id ? channel : candidate) : [...channels, channel];
				props.channels.setChannels(next);
				if (key !== void 0) props.channels.setChannelKey(channel.id, key);
				if (isDefault) props.channels.setDefaultChannel(channel.id);
				closeEditor();
			};
			const removeChannel = (channel) => {
				const isDefault = channel.id === state.channels.defaultChannelId;
				const next = channels.filter((candidate) => candidate.id !== channel.id);
				props.channels.setChannels(next);
				if (isDefault && next.length > 0) props.channels.setDefaultChannel(next[0].id);
				setConfirmDeleteId(null);
				if (editor?.kind === "edit" && editor.channelId === channel.id) closeEditor();
			};
			const openAddProvider = () => {
				setPresetError(null);
				setEditor({ kind: "add-provider" });
			};
			const openAddCustom = () => {
				setPresetError(null);
				setEditor({ kind: "add-custom" });
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
													onClick: () => removeChannel(channel),
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
													onClick: () => {
														setEditor({
															kind: "edit",
															channelId: channel.id
														});
													},
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
													onClick: () => {
														setEditor({
															kind: "edit",
															channelId: channel.id
														});
													},
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
								presetError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: settings_card_module_css_default.failed,
									children: presetError
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: settings_card_module_css_default.channelAddRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: settings_card_module_css_default.channelAdd,
										disabled: !state.writable,
										onClick: openAddProvider,
										children: presetLoading ? t("channels.addProviderLoading") : t("channels.addProvider")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: settings_card_module_css_default.channelAdd,
										disabled: !state.writable,
										onClick: openAddCustom,
										children: t("channels.addCustom")
									})]
								}),
								editor !== null ? editor.kind === "add-provider" && presets.length === 0 && presetError === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: settings_card_module_css_default.sectionHint,
									children: presetLoading ? t("channels.addProviderLoading") : t("channels.addProviderFailed")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: settings_card_module_css_default.editorWrap,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelEditor, {
										t,
										writable: state.writable,
										mode: editor,
										channel: editingChannel,
										keyHeld: editor.kind === "edit" ? state.channels.keySet[editor.channelId] === true : false,
										presets,
										initiallyDefault: editor.kind === "edit" ? editor.channelId === state.channels.defaultChannelId : channels.length === 0,
										onCancel: closeEditor,
										onSave: saveEditor
									}, editor.kind === "edit" ? `edit-${editor.channelId}` : editor.kind)
								}) : null
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: settings_card_module_css_default.field,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: settings_card_module_css_default.label,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settings.enhanceModel") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: settings_card_module_css_default.select,
										value: state.enhanceModel.text,
										disabled: !state.writable,
										onChange: (event) => props.edit("enhanceModel", event.target.value),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "",
												children: t("settings.enhanceModelDefault")
											}),
											llmModels !== null ? llmModels.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: `${option.provider}|${option.id}`,
												children: `${option.providerName} — ${option.name}${option.name !== option.id ? `（${option.id}）` : ""}`
											}, `${option.provider}|${option.id}`)) : null,
											llmModels !== null && state.enhanceModel.text !== "" && !llmModels.some((option) => `${option.provider}|${option.id}` === state.enhanceModel.text) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: state.enhanceModel.text,
												children: state.enhanceModel.text
											}) : null
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: settings_card_module_css_default.sectionHint,
										children: t("settings.enhanceModelHint")
									}),
									llmModelsError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: settings_card_module_css_default.failed,
										children: [
											t("settings.enhanceModelFailed"),
											"：",
											llmModelsError
										]
									}) : null
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
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: settings_card_module_css_default.field,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: settings_card_module_css_default.label,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: state.autoSaveToLibrary.text === "true",
										disabled: !state.writable,
										onChange: (event) => props.edit("autoSaveToLibrary", String(event.target.checked))
									}),
									" ",
									t("settings.autoSaveLibrary")
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: settings_card_module_css_default.field,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: settings_card_module_css_default.label,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settings.maxConcurrent") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "number",
									min: "1",
									max: "20",
									className: settings_card_module_css_default.input,
									value: state.maxConcurrentGenerations.text,
									disabled: !state.writable,
									onChange: (event) => {
										const raw = event.target.value;
										const parsed = Number(raw);
										const value = raw === "" || !Number.isFinite(parsed) ? "" : String(Math.max(1, Math.min(20, Math.floor(parsed))));
										props.edit("maxConcurrentGenerations", value);
									}
								})]
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
			"icon": "_7K1QKa_icon",
			"status": "_7K1QKa_status",
			"header": "_7K1QKa_header",
			"error": "_7K1QKa_error",
			"audios": "_7K1QKa_audios",
			"audio": "_7K1QKa_audio",
			"download": "_7K1QKa_download",
			"empty": "_7K1QKa_empty",
			"message": "_7K1QKa_message",
			"audioRow": "_7K1QKa_audioRow"
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