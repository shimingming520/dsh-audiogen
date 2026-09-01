import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path, { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { SettingsConflictError } from "@deepseek-ai/dsh-settings";
import { mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/protocol.ts
/**
* Wire contract shared by the host and client halves of dsh-audiogen:
* settings namespace, route paths, generate payload/result shapes.
* Pure types and constants — safe for the client bundle to inline.
*/
/** Settings namespace this plugin owns (host settings seam + bridge). */
const AUDIOGEN_SETTINGS_NAMESPACE = "dsh-audiogen";
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
/** Vendor voice management (browse/filter + delete) endpoints. */
const VOICES_API = {
	list: "/api/dsh-audiogen/voices/list",
	delete: "/api/dsh-audiogen/voices/delete",
	recommend: "/api/dsh-audiogen/voices/recommend",
	recommendHistory: {
		list: "/api/dsh-audiogen/voices/recommend-history/list",
		remove: "/api/dsh-audiogen/voices/recommend-history/remove"
	}
};
/** Loopback-only audio file reader for panel/tool-result previews. */
const AUDIO_API = { file: "/api/dsh-audiogen/audio" };
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
/** All library types, for iteration and validation. */
const LIBRARY_TYPES = [
	"voice",
	"music",
	"sfx",
	"tts"
];
//#endregion
//#region src/audio-scheduler.ts
function createGenerationBudget(limit) {
	let active = 0;
	const waiting = [];
	const clampLimit = () => {
		const raw = Number(limit());
		if (!Number.isFinite(raw) || raw < 1) return 5;
		return Math.min(20, Math.floor(raw));
	};
	const pump = () => {
		const max = clampLimit();
		while (active < max && waiting.length > 0) {
			const entry = waiting.shift();
			if (entry.signal?.aborted === true) {
				entry.reject(new DOMException("The operation was aborted.", "AbortError"));
				continue;
			}
			entry.cleanup?.();
			active += 1;
			let released = false;
			entry.resolve(() => {
				if (released) return;
				released = true;
				active = Math.max(0, active - 1);
				pump();
			});
		}
	};
	const acquire = (signal) => new Promise((resolve, reject) => {
		const entry = {
			resolve,
			reject,
			signal
		};
		const onAbort = () => {
			const index = waiting.indexOf(entry);
			if (index < 0) return;
			waiting.splice(index, 1);
			entry.cleanup = void 0;
			reject(new DOMException("The operation was aborted.", "AbortError"));
		};
		entry.cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
		};
		if (signal !== void 0) {
			if (signal.aborted === true) {
				reject(new DOMException("The operation was aborted.", "AbortError"));
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
		}
		waiting.push(entry);
		pump();
	});
	return { acquire };
}
//#endregion
//#region src/audio-engine.ts
/** An audio generation failure with a user-presentable message. */
var AudioGenError = class extends Error {
	code;
	constructor(message, code = "audio-generate-failed") {
		super(message);
		this.name = "AudioGenError";
		this.code = code;
	}
};
/** Total budget for one upstream generation call. Audio models can be slow. */
const UPSTREAM_TIMEOUT_MS = 24e4;
/** Budget for downloading one result audio URL. */
const AUDIO_FETCH_TIMEOUT_MS = 6e4;
function requestSignal(source, timeoutMs) {
	const controller = new AbortController();
	const abortFromSource = () => {
		controller.abort(source?.reason);
	};
	if (source?.aborted === true) abortFromSource();
	else source?.addEventListener("abort", abortFromSource, { once: true });
	const timeout = setTimeout(() => {
		controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
	}, timeoutMs);
	timeout.unref?.();
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timeout);
			source?.removeEventListener("abort", abortFromSource);
		}
	};
}
/** Detect a few common audio container formats from magic bytes. */
function detectAudioMime(data) {
	if (data.length >= 4 && data[0] === 82 && data[1] === 73 && data[2] === 70 && data[3] === 70) return "audio/wav";
	if (data.length >= 3 && data[0] === 73 && data[1] === 68 && data[2] === 51) return "audio/mpeg";
	if (data.length >= 4 && data[0] === 102 && data[1] === 76 && data[2] === 97 && data[3] === 67) return "audio/flac";
	if (data.length >= 4 && data[0] === 79 && data[1] === 103 && data[2] === 103 && data[3] === 83) return "audio/ogg";
	if (data.length >= 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 24) return "audio/mp4";
	if (data.length >= 4 && data[0] === 35 && data[1] === 33 && data[2] === 65 && data[3] === 77) return "audio/aiff";
}
function mimeFromContentType(value) {
	if (value === null || value === "") return void 0;
	const parts = value.split(";");
	for (const part of parts.slice(1)) {
		const match = /^\s*type=([^;\s]+)/i.exec(part);
		if (match !== null) return match[1].trim().toLowerCase();
	}
	return parts[0].trim().toLowerCase();
}
function audioMime(data, contentType) {
	return detectAudioMime(data) ?? mimeFromContentType(contentType) ?? "audio/mpeg";
}
function isPreset(channel, id) {
	return channel.preset === id || channel.apiUrl.toLowerCase().includes(id);
}
function isOpenAICompatible(channel, mode) {
	return isPreset(channel, "openai") || /(^|\/)(v\d+\/)?audio\/speech$/i.test(channel.apiUrl.trim()) || channel.preset === "custom" && mode === "tts";
}
function isElevenLabs$2(channel) {
	return isPreset(channel, "elevenlabs") || /elevenlabs/i.test(channel.apiUrl);
}
function isMiniMax$2(channel) {
	return isPreset(channel, "minimax") || /minimax/i.test(channel.apiUrl);
}
function isStability$1(channel) {
	return isPreset(channel, "stability") || /stability\.ai/i.test(channel.apiUrl);
}
function endpointBase(url) {
	return url.trim().replace(/\/+$/, "");
}
/** Recursively look for the first likely base64 audio string in a JSON payload. */
function findBase64Audio(value) {
	if (typeof value === "string" && value.length > 100 && !/^https?:\/\//i.test(value.trim())) return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findBase64Audio(item);
			if (found !== void 0) return found;
		}
		return;
	}
	if (value === null || typeof value !== "object") return void 0;
	const record = value;
	for (const key of [
		"audio",
		"music",
		"b64_json",
		"base64",
		"data",
		"output",
		"result",
		"value"
	]) {
		const candidate = record[key];
		const found = findBase64Audio(candidate);
		if (found !== void 0) return found;
	}
}
/** Find the first provider-returned audio URL in a JSON payload. */
function findAudioUrl(value) {
	if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findAudioUrl(item);
			if (found !== void 0) return found;
		}
		return;
	}
	if (value === null || typeof value !== "object") return void 0;
	const record = value;
	for (const key of [
		"url",
		"audio_url",
		"href",
		"link",
		"audio",
		"data",
		"output",
		"result",
		"value"
	]) {
		const candidate = record[key];
		const found = findAudioUrl(candidate);
		if (found !== void 0) return found;
	}
}
async function fetchWithTimeout(url, init, timeoutMs) {
	const budget = requestSignal(init.signal, timeoutMs);
	try {
		return await fetch(url, {
			...init,
			signal: budget.signal
		});
	} finally {
		budget.dispose();
	}
}
async function normalizeAudioResponse(response, options) {
	if (!response.ok) {
		let detail = "";
		try {
			detail = (await response.text()).slice(0, 500);
		} catch {}
		throw new AudioGenError(`audio API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail}`}`, "audio-api-error");
	}
	const contentType = mimeFromContentType(response.headers.get("content-type")) ?? options.fallbackMime;
	const buffer = new Uint8Array(await response.arrayBuffer());
	const text = new TextDecoder().decode(buffer).trim();
	if (text.startsWith("{") || text.startsWith("[")) {
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new AudioGenError("audio endpoint returned an unprocessable response body", "audio-bad-response");
		}
		const encoded = findBase64Audio(parsed);
		if (encoded !== void 0 && encoded.length > 0) {
			let data;
			try {
				const isHex = /^[0-9a-fA-F]+$/.test(encoded) && encoded.length % 2 === 0;
				data = new Uint8Array(Buffer.from(encoded, isHex ? "hex" : "base64"));
			} catch {
				throw new AudioGenError("audio endpoint returned invalid audio encoding", "audio-bad-response");
			}
			return [{
				data,
				mime: detectAudioMime(data) ?? contentType ?? "audio/mpeg"
			}];
		}
		const url = findAudioUrl(parsed);
		if (url !== void 0) {
			const fetched = await fetchWithTimeout(url, {
				headers: options.apiKey === "" ? {} : { authorization: `Bearer ${options.apiKey}` },
				redirect: "follow"
			}, AUDIO_FETCH_TIMEOUT_MS);
			if (!fetched.ok) throw new AudioGenError(`failed to fetch generated audio url: HTTP ${fetched.status}`, "audio-url-fetch-failed");
			const data = new Uint8Array(await fetched.arrayBuffer());
			return [{
				data,
				mime: audioMime(data, fetched.headers.get("content-type"))
			}];
		}
		throw new AudioGenError("audio endpoint returned neither binary nor base64/url audio", "audio-empty-result");
	}
	return [{
		data: buffer,
		mime: audioMime(buffer, response.headers.get("content-type") ?? contentType ?? null)
	}];
}
async function openAITTS(channel, request, signal) {
	const base = endpointBase(channel.apiUrl);
	const endpoint = /\/audio\/speech(\?|$)/i.test(base) ? base : `${base}/audio/speech`;
	const model = (request.upstream ?? request.model) || "tts-1";
	const voice = request.voice ?? "alloy";
	const body = {
		model,
		input: request.prompt,
		voice,
		response_format: request.format ?? "mp3",
		...request.speed !== void 0 ? { speed: request.speed } : {}
	};
	return normalizeAudioResponse(await fetchWithTimeout(endpoint, {
		method: "POST",
		redirect: "error",
		headers: {
			authorization: `Bearer ${channel.apiKey.trim()}`,
			"content-type": "application/json",
			accept: "audio/mpeg, application/json"
		},
		body: JSON.stringify(body),
		signal
	}, UPSTREAM_TIMEOUT_MS), {
		apiKey: channel.apiKey,
		fallbackMime: "audio/mpeg"
	});
}
const ELEVENLABS_OUTPUT_FORMATS = {
	mp3: {
		sampleRates: [
			22050,
			24e3,
			44100
		],
		bitrates: {
			22050: [32],
			24e3: [48],
			44100: [
				32,
				64,
				96,
				128,
				192
			]
		},
		defaultSampleRate: 44100,
		defaultBitrate: 128
	},
	pcm: {
		sampleRates: [
			8e3,
			16e3,
			22050,
			24e3,
			32e3,
			44100,
			48e3
		],
		defaultSampleRate: 44100
	},
	ulaw: {
		sampleRates: [8e3],
		defaultSampleRate: 8e3
	},
	alaw: {
		sampleRates: [8e3],
		defaultSampleRate: 8e3
	},
	opus: {
		sampleRates: [48e3],
		bitrates: { 48e3: [32] },
		defaultSampleRate: 48e3,
		defaultBitrate: 32
	}
};
/**
* 把「格式 + 采样率 + 码率」组合为 ElevenLabs 的 output_format（codec_sample_rate_bitrate）。
* 三个参数都不给时返回 undefined（不发送该字段，交给上游默认）。
* 组合非法时给出可操作错误（列出合法值），而不是静默修改用户选择的参数。
* 注意码率单位：ElevenLabs 为 kbps（32/48/64/96/128/192），与 MiniMax 的 bps 不同。
*/
function elevenLabsOutputFormat(request) {
	const format = (request.format ?? "").trim().toLowerCase();
	const sampleRate = request.sampleRate;
	const bitrate = request.bitrate;
	if (format === "" && sampleRate === void 0 && bitrate === void 0) return void 0;
	const codec = format === "" ? "mp3" : format;
	const spec = ELEVENLABS_OUTPUT_FORMATS[codec];
	if (spec === void 0) throw new AudioGenError(`ElevenLabs 输出格式不支持「${codec}」：可用 ${Object.keys(ELEVENLABS_OUTPUT_FORMATS).join("/")}（output_format 为 codec_sample_rate_bitrate 组合枚举）`, "audio-bad-format");
	let resolvedRate = sampleRate;
	if (resolvedRate !== void 0 && !spec.sampleRates.includes(resolvedRate)) throw new AudioGenError(`ElevenLabs ${codec} 输出采样率仅支持 ${spec.sampleRates.join("/")}Hz（实际 ${resolvedRate}Hz）`, "audio-bad-format");
	if (resolvedRate === void 0) resolvedRate = spec.defaultSampleRate;
	let resolvedBitrate = bitrate;
	if (resolvedBitrate !== void 0) {
		const allowed = spec.bitrates?.[resolvedRate] ?? [];
		if (allowed.length === 0 || !allowed.includes(resolvedBitrate)) throw new AudioGenError(`ElevenLabs ${codec}_${resolvedRate} 输出码率仅支持 ${allowed.length === 0 ? "无（该编码不带码率）" : allowed.join("/")}kbps（实际 ${resolvedBitrate}kbps）`, "audio-bad-format");
	}
	if (resolvedBitrate === void 0) {
		const rates = spec.bitrates?.[resolvedRate] ?? [];
		resolvedBitrate = spec.defaultBitrate !== void 0 && rates.includes(spec.defaultBitrate) ? spec.defaultBitrate : rates[0];
	}
	return resolvedBitrate === void 0 ? `${codec}_${resolvedRate}` : `${codec}_${resolvedRate}_${resolvedBitrate}`;
}
async function elevenLabsOfficial(channel, request, signal) {
	const base = endpointBase(channel.apiUrl);
	const model = (request.upstream ?? request.model) || "eleven_multilingual_v2";
	const headers = {
		"xi-api-key": channel.apiKey.trim(),
		authorization: `Bearer ${channel.apiKey.trim()}`,
		"content-type": "application/json",
		accept: "audio/mpeg, application/json"
	};
	if (request.mode === "voice_design") {
		const endpoint = `${base}/text-to-voice/design`;
		const previewText = request.previewText?.trim() ?? "";
		const body = {
			voice_description: request.prompt,
			...previewText.length >= 100 ? { text: previewText } : { auto_generate_text: true }
		};
		const response = await fetchWithTimeout(endpoint, {
			method: "POST",
			redirect: "error",
			headers,
			body: JSON.stringify(body),
			signal
		}, UPSTREAM_TIMEOUT_MS);
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new AudioGenError(`ElevenLabs voice design API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
		}
		const previews = (await response.json()).previews ?? [];
		if (previews.length === 0) throw new AudioGenError("ElevenLabs voice design returned no previews", "audio-empty-result");
		const outputs = [];
		for (const preview of previews) {
			const encoded = preview.audio_base_64?.trim() ?? "";
			if (encoded === "") continue;
			const data = new Uint8Array(Buffer.from(encoded, "base64"));
			outputs.push({
				data,
				mime: preview.media_type ?? "audio/mpeg",
				...preview.generated_voice_id === void 0 || preview.generated_voice_id === "" ? {} : { voiceId: preview.generated_voice_id }
			});
		}
		if (outputs.length === 0) throw new AudioGenError("ElevenLabs voice design returned no audio", "audio-empty-result");
		return outputs;
	}
	if (request.mode === "music") {
		const endpoint = `${base}/music`;
		const musicModel = (request.upstream ?? request.model) || "music_v1";
		const lyrics = request.lyrics?.trim() ?? "";
		const instrumental = request.isInstrumental === true || lyrics === "";
		const body = {
			model_id: musicModel,
			prompt: request.prompt,
			...request.duration !== void 0 && Number.isFinite(request.duration) ? { music_length_ms: Math.round(Math.min(6e5, Math.max(3e3, request.duration * 1e3))) } : {},
			...lyrics === "" ? {} : { lyrics_text: lyrics },
			...instrumental ? { force_instrumental: true } : {}
		};
		const response = await fetchWithTimeout(endpoint, {
			method: "POST",
			redirect: "follow",
			headers,
			body: JSON.stringify(body),
			signal
		}, UPSTREAM_TIMEOUT_MS);
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new AudioGenError(`ElevenLabs music API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
		}
		return normalizeAudioResponse(response, {
			apiKey: channel.apiKey,
			fallbackMime: "audio/mpeg"
		});
	}
	if (request.mode === "sfx") {
		const endpoint = `${base}/sound-generation`;
		const sfxModel = (request.upstream ?? request.model) || "eleven_text_to_sound_v2";
		const outputFormat = elevenLabsOutputFormat(request);
		const body = {
			text: request.prompt,
			model_id: sfxModel,
			...outputFormat === void 0 ? {} : { output_format: outputFormat },
			...request.duration !== void 0 && Number.isFinite(request.duration) ? { duration_seconds: Math.min(30, Math.max(.5, request.duration)) } : {},
			...request.loop !== void 0 ? { loop: request.loop } : {},
			...request.promptInfluence !== void 0 && Number.isFinite(request.promptInfluence) ? { prompt_influence: Math.min(1, Math.max(0, request.promptInfluence)) } : {}
		};
		const response = await fetchWithTimeout(endpoint, {
			method: "POST",
			redirect: "follow",
			headers,
			body: JSON.stringify(body),
			signal
		}, UPSTREAM_TIMEOUT_MS);
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new AudioGenError(`ElevenLabs sound effects API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
		}
		return normalizeAudioResponse(response, {
			apiKey: channel.apiKey,
			fallbackMime: "audio/mpeg"
		});
	}
	const voiceId = (request.voice ?? request.model ?? model).trim();
	const endpoint = `${base}/text-to-speech/${encodeURIComponent(voiceId)}`;
	const body = {
		text: request.prompt,
		model_id: model,
		voice_settings: {
			stability: .5,
			similarity_boost: .75,
			style: 0,
			use_speaker_boost: true,
			...request.speed !== void 0 ? { speed: request.speed } : {}
		}
	};
	return normalizeAudioResponse(await fetchWithTimeout(endpoint, {
		method: "POST",
		redirect: "error",
		headers,
		body: JSON.stringify(body),
		signal
	}, UPSTREAM_TIMEOUT_MS), {
		apiKey: channel.apiKey,
		fallbackMime: "audio/mpeg"
	});
}
/**
* 官方 ElevenLabs 请求被网关拒绝的信号:官方路径未映射(404 Invalid URL)或
* 网关要求 Bearer 认证而非 xi-api-key(401/403 Invalid token / Invalid API key)。
* New API 类中转(如 ai.farmmx.com)对 ElevenLabs 官方协议通常返回这类错误。
*/
function isGatewayRouteMiss(error) {
	return error instanceof AudioGenError && error.code === "audio-api-error" && /\bHTTP (404|401|403)\b/.test(error.message) && /\bInvalid URL\b|\bInvalid token\b|\bInvalid API key\b/i.test(error.message);
}
/** 网关兼容形态的请求头:仅 Bearer(携带 xi-api-key 会被网关按官方协议校验而 401)。 */
function gatewayHeaders(apiKey) {
	return {
		authorization: `Bearer ${apiKey.trim()}`,
		"content-type": "application/json",
		accept: "audio/mpeg, application/json"
	};
}
/** /audio/speech 兼容端点:base 已以此结尾时直接复用,否则拼接。 */
function speechGatewayEndpoint(base) {
	return /\/audio\/speech(\?|$)/i.test(base) ? base : `${base}/audio/speech`;
}
/**
* ElevenLabs 渠道的网关兼容形态(OpenAI 风格):路径用 /audio/speech(音效/TTS)
* 或 /music(音乐),认证用 Bearer、模型用 `model` 字段。
*
* 适配未映射 ElevenLabs 官方端点(404 Invalid URL)或要求 Bearer 认证
* (401 Invalid token)的 New API 类中转,如 ai.farmmx.com。
*/
async function elevenLabsGatewayCompat(channel, request, signal) {
	const base = endpointBase(channel.apiUrl);
	const headers = gatewayHeaders(channel.apiKey);
	if (request.mode === "music") {
		const endpoint = /\/music(\?|$)/i.test(base) ? base : `${base}/music`;
		const musicModel = (request.upstream ?? request.model) || "music_v1";
		const lyrics = request.lyrics?.trim() ?? "";
		const instrumental = request.isInstrumental === true || lyrics === "";
		const body = {
			model: musicModel,
			prompt: request.prompt,
			...request.duration !== void 0 && Number.isFinite(request.duration) ? { music_length_ms: Math.round(Math.min(6e5, Math.max(3e3, request.duration * 1e3))) } : {},
			...lyrics === "" ? {} : { lyrics_text: lyrics },
			...instrumental ? { force_instrumental: true } : {}
		};
		const response = await fetchWithTimeout(endpoint, {
			method: "POST",
			redirect: "follow",
			headers,
			body: JSON.stringify(body),
			signal
		}, UPSTREAM_TIMEOUT_MS);
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new AudioGenError(`ElevenLabs music gateway-compatible API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
		}
		return normalizeAudioResponse(response, {
			apiKey: channel.apiKey,
			fallbackMime: "audio/mpeg"
		});
	}
	if (request.mode === "voice_design") throw new AudioGenError("当前网关不支持 ElevenLabs 音色设计端点(POST /v1/text-to-voice/design);该模式请改用 MiniMax 渠道或 ElevenLabs 官方 API。", "voice-design-unsupported");
	const endpoint = speechGatewayEndpoint(base);
	const isSfx = request.mode === "sfx";
	const model = (request.upstream ?? request.model) || (isSfx ? "eleven_text_to_sound_v2" : "eleven_multilingual_v2");
	if (!isSfx) {
		if ((request.voice?.trim() ?? "") === "") {
			const suggestions = (channel.models ?? []).filter((entry) => {
				const candidate = entry;
				return candidate.category === "tts" && candidate.id.trim() !== "" && candidate.id !== candidate.alias;
			}).map((entry) => `${entry.alias}（${entry.id}）`);
			throw new AudioGenError(`ElevenLabs 网关渠道的 TTS 必须携带音色 voice_id（网关强制校验，缺失会返回 400 voice or voice_id is required）：请在「音色」字段填入官方音色 ID${suggestions.length === 0 ? "" : `，可选用以下音色：${suggestions.slice(0, 4).join("、")}`}。`, "voice-required");
		}
	}
	const body = isSfx ? {
		model,
		input: request.prompt,
		...request.duration !== void 0 && Number.isFinite(request.duration) ? { duration_seconds: Math.min(30, Math.max(.5, request.duration)) } : {},
		...request.loop !== void 0 ? { loop: request.loop } : {},
		...request.promptInfluence !== void 0 && Number.isFinite(request.promptInfluence) ? { prompt_influence: Math.min(1, Math.max(0, request.promptInfluence)) } : {}
	} : {
		model,
		input: request.prompt,
		voice: request.voice.trim(),
		response_format: request.format ?? "mp3",
		...request.speed !== void 0 ? { speed: request.speed } : {}
	};
	const response = await fetchWithTimeout(endpoint, {
		method: "POST",
		redirect: "follow",
		headers,
		body: JSON.stringify(body),
		signal
	}, UPSTREAM_TIMEOUT_MS);
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new AudioGenError(`ElevenLabs ${isSfx ? "sound effects" : "TTS"} gateway-compatible API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
	}
	return normalizeAudioResponse(response, {
		apiKey: channel.apiKey,
		fallbackMime: "audio/mpeg"
	});
}
/**
* ElevenLabs 渠道入口:官方端点优先;官方协议被网关(New API 类中转)拒绝时,
* 自动改用 OpenAI 兼容形态重试,使同一渠道同时兼容 ElevenLabs 官方 API 与
* ai.farmmx.com 类中转。官方地址(api.elevenlabs.io)直连不触发回退。
*/
async function elevenLabs(channel, request, signal) {
	if (/elevenlabs\.io/i.test(channel.apiUrl)) return elevenLabsOfficial(channel, request, signal);
	try {
		return await elevenLabsOfficial(channel, request, signal);
	} catch (error) {
		if (!isGatewayRouteMiss(error)) throw error;
	}
	return elevenLabsGatewayCompat(channel, request, signal);
}
function minimaxApiBase(base) {
	const trimmed = endpointBase(base);
	return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}
/**
* Resolve the MiniMax voice_id for a TTS request.
* Priority: explicit voice param → upstream id (if it is not a model name) →
* model alias (if it is not a model name). MiniMax speech/music model ids
* (speech-2.8-hd, music-3.0, …) are never treated as voice ids.
*/
function resolveMiniMaxVoice(request) {
	const explicit = request.voice?.trim();
	if (explicit !== void 0 && explicit !== "") return explicit;
	for (const candidate of [request.upstream, request.model]) {
		const value = typeof candidate === "string" ? candidate.trim() : "";
		if (value === "") continue;
		if (/^(speech|music|t2a|tts)[-_]/i.test(value)) continue;
		return value;
	}
}
/**
* Build the full MiniMax t2a_v2 body. Every official field is carried
* through — voice_setting (voice_id/speed/vol/pitch/emotion/text_normalization/
* latex_read), pronunciation_dict.tone, audio_setting (format/sample_rate/
* bitrate/channel/force_cbr), subtitle_enable, aigc_watermark, language_boost,
* voice_modify and timbre_weights — so callers and skills can reference them.
*/
function buildMiniMaxTTSBody(request, model, voiceId) {
	const body = {
		model,
		text: request.prompt,
		stream: false,
		voice_setting: {
			voice_id: voiceId,
			speed: request.speed ?? 1,
			vol: request.vol ?? 1,
			pitch: request.pitch ?? 0,
			...request.emotion !== void 0 && request.emotion.trim() !== "" ? { emotion: request.emotion.trim() } : {},
			...request.textNormalization !== void 0 ? { text_normalization: request.textNormalization } : {},
			...request.latexRead !== void 0 ? { latex_read: request.latexRead } : {}
		},
		audio_setting: {
			format: request.format ?? "mp3",
			sample_rate: request.sampleRate ?? 32e3,
			bitrate: request.bitrate ?? 128e3,
			channel: request.audioChannel ?? 1,
			...request.forceCbr !== void 0 ? { force_cbr: request.forceCbr } : {}
		}
	};
	if (request.pronunciationTone !== void 0 && request.pronunciationTone.length > 0) body.pronunciation_dict = { tone: request.pronunciationTone };
	if (request.subtitleEnable !== void 0) body.subtitle_enable = request.subtitleEnable;
	if (request.aigcWatermark !== void 0) body.aigc_watermark = request.aigcWatermark;
	if (request.languageBoost !== void 0 && request.languageBoost.trim() !== "") body.language_boost = request.languageBoost.trim();
	if (request.voiceModify !== void 0) {
		const modify = {};
		if (request.voiceModify.pitch !== void 0) modify.pitch = request.voiceModify.pitch;
		if (request.voiceModify.intensity !== void 0) modify.intensity = request.voiceModify.intensity;
		if (request.voiceModify.timbre !== void 0) modify.timbre = request.voiceModify.timbre;
		if (request.voiceModify.soundEffects !== void 0 && request.voiceModify.soundEffects.trim() !== "") modify.sound_effects = request.voiceModify.soundEffects.trim();
		if (Object.keys(modify).length > 0) body.voice_modify = modify;
	}
	if (request.timbreWeights !== void 0 && request.timbreWeights.length > 0) body.timbre_weights = request.timbreWeights.filter((item) => typeof item?.voiceId === "string" && item.voiceId.trim() !== "" && typeof item.weight === "number").map((item) => ({
		voice_id: item.voiceId.trim(),
		weight: item.weight
	}));
	return body;
}
/** The MiniMax-specific fields only (model/text/stream excluded) — used as the
*  new-api `metadata` payload when a gateway serves MiniMax TTS at /v1/audio/speech.
*  The merge keeps the gateway-sent model/input, and voice_setting.voice_id is
*  carried explicitly so relays that overwrite it still get the right voice. */
function buildMiniMaxTTSUpload(request, voiceId) {
	const upload = buildMiniMaxTTSBody(request, "", voiceId);
	delete upload.model;
	delete upload.text;
	delete upload.stream;
	return upload;
}
/**
* OpenAI-compatible MiniMax TTS path for New API style gateways that do not
* route the native /v1/t2a_v2. The full native field set is carried inside
* `metadata`, which new-api's MiniMax TTS relay merges into t2a_v2 upstream.
*/
async function minimaxTTSGateway(channel, request, signal, voiceId) {
	const endpoint = `${minimaxApiBase(channel.apiUrl)}/audio/speech`;
	const model = (request.upstream ?? request.model) || "speech-2.8-hd";
	const metadata = buildMiniMaxTTSUpload(request, voiceId);
	const body = {
		model,
		input: request.prompt,
		voice: voiceId,
		response_format: request.format ?? "mp3",
		...request.speed !== void 0 ? { speed: request.speed } : {},
		...Object.keys(metadata).length > 0 ? { metadata } : {}
	};
	return normalizeAudioResponse(await fetchWithTimeout(endpoint, {
		method: "POST",
		redirect: "follow",
		headers: {
			authorization: `Bearer ${channel.apiKey.trim()}`,
			"content-type": "application/json",
			accept: "application/json, audio/mpeg"
		},
		body: JSON.stringify(body),
		signal
	}, UPSTREAM_TIMEOUT_MS), {
		apiKey: channel.apiKey,
		fallbackMime: "audio/mpeg"
	});
}
async function minimax(channel, request, signal) {
	const base = minimaxApiBase(channel.apiUrl);
	const model = (request.upstream ?? request.model) || (request.mode === "music" ? "music-3.0" : "speech-2.8-hd");
	if (request.mode === "voice_design") {
		const endpoint = `${base}/voice_design`;
		const body = {
			prompt: request.prompt,
			preview_text: request.previewText ?? request.voice ?? "你好，这是新设计的音色试听。"
		};
		const response = await fetchWithTimeout(endpoint, {
			method: "POST",
			redirect: "error",
			headers: {
				authorization: `Bearer ${channel.apiKey.trim()}`,
				"content-type": "application/json",
				accept: "application/json"
			},
			body: JSON.stringify(body),
			signal
		}, UPSTREAM_TIMEOUT_MS);
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new AudioGenError(`MiniMax voice design API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
		}
		const payload = await response.json();
		if (payload.base_resp?.status_code !== void 0 && payload.base_resp.status_code !== 0) throw new AudioGenError(payload.base_resp.status_msg ?? `MiniMax returned status ${payload.base_resp.status_code}`, "audio-api-error");
		const encoded = payload.trial_audio ?? "";
		if (encoded === "") throw new AudioGenError("MiniMax voice design returned no trial audio", "audio-empty-result");
		const isHex = /^[0-9a-fA-F]+$/.test(encoded) && encoded.length % 2 === 0;
		return [{
			data: new Uint8Array(Buffer.from(encoded, isHex ? "hex" : "base64")),
			mime: "audio/mpeg",
			...payload.voice_id === void 0 ? {} : { voiceId: payload.voice_id }
		}];
	}
	if (request.mode === "music") {
		const MUSIC_FORMATS = /* @__PURE__ */ new Set([
			"mp3",
			"wav",
			"pcm"
		]);
		const MUSIC_SAMPLE_RATES = /* @__PURE__ */ new Set([
			16e3,
			24e3,
			32e3,
			44100
		]);
		const MUSIC_BITRATES = /* @__PURE__ */ new Set([
			32e3,
			64e3,
			128e3,
			256e3
		]);
		const lyrics = request.lyrics?.trim() ?? "";
		const instrumental = request.isInstrumental === true || lyrics === "";
		const endpoint = `${base}/music_generation`;
		const body = {
			model,
			prompt: request.prompt,
			...lyrics === "" ? {} : { lyrics },
			...instrumental ? { is_instrumental: true } : {},
			...request.duration !== void 0 ? { duration: request.duration } : {},
			audio_setting: {
				format: MUSIC_FORMATS.has(request.format ?? "mp3") ? request.format ?? "mp3" : "mp3",
				sample_rate: MUSIC_SAMPLE_RATES.has(request.sampleRate ?? 44100) ? request.sampleRate ?? 44100 : 44100,
				bitrate: MUSIC_BITRATES.has(request.bitrate ?? 256e3) ? request.bitrate ?? 256e3 : 256e3
			}
		};
		const response = await fetchWithTimeout(endpoint, {
			method: "POST",
			redirect: "error",
			headers: {
				authorization: `Bearer ${channel.apiKey.trim()}`,
				"content-type": "application/json",
				accept: "application/json, audio/mpeg"
			},
			body: JSON.stringify(body),
			signal
		}, UPSTREAM_TIMEOUT_MS);
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new AudioGenError(`MiniMax music API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
		}
		return normalizeAudioResponse(response, {
			apiKey: channel.apiKey,
			fallbackMime: "audio/mpeg"
		});
	}
	const voiceId = resolveMiniMaxVoice(request);
	if (voiceId === void 0) throw new AudioGenError("MiniMax TTS 需要指定音色 voice_id（如 male-qn-qingse、female-shaonv）：请在「音色」字段填写，或把音色加入渠道模型目录（alias 可任意、upstream 填 voice_id），也可点「获取可用模型」拉取账号音色列表。", "voice-required");
	const endpoint = `${base}/t2a_v2`;
	const body = buildMiniMaxTTSBody(request, model, voiceId);
	const response = await fetchWithTimeout(endpoint, {
		method: "POST",
		redirect: "error",
		headers: {
			authorization: `Bearer ${channel.apiKey.trim()}`,
			"content-type": "application/json",
			accept: "application/json, audio/mpeg"
		},
		body: JSON.stringify(body),
		signal
	}, UPSTREAM_TIMEOUT_MS);
	if (response.ok) return normalizeAudioResponse(response, {
		apiKey: channel.apiKey,
		fallbackMime: "audio/mpeg"
	});
	const detail = await response.text().catch(() => "");
	if (!(response.status === 404 && /invalid url|invalid_request_error/i.test(detail))) throw new AudioGenError(`MiniMax TTS API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
	try {
		return await minimaxTTSGateway(channel, request, signal, voiceId);
	} catch (gatewayError) {
		const detailText = gatewayError instanceof AudioGenError ? gatewayError.message : String(gatewayError);
		throw new AudioGenError(`MiniMax 渠道「${channel.name}」网关未提供原生 TTS 接口：POST ${endpoint} 返回 HTTP 404（Invalid URL，网关未路由 /v1/t2a_v2）；已回退 OpenAI 兼容 ${minimaxApiBase(channel.apiUrl)}/audio/speech 仍失败：${detailText.slice(0, 300)}。请把渠道 API 地址配置为官方 https://api.minimaxi.com（配合 MiniMax 官方密钥），或确认网关已将 /v1/audio/speech 映射到 MiniMax 音色渠道。`, "audio-api-error");
	}
}
/** Stability 内部信号：路由缺失（网关 404 Invalid URL），可切换另一协议重试。 */
var StabilityRouteMissError = class extends Error {};
/** 网关风格：apiUrl 形如 .../v1、.../v1/audio/speech 时优先 OpenAI 兼容 speech。 */
function stabilityGatewayStyle(channel) {
	const url = channel.apiUrl.trim().toLowerCase();
	return /\/v1(\/|$|\?)/.test(url) || /\/audio\/speech(\?|$)/.test(url);
}
function isStabilityRouteMiss(status, detail) {
	return status === 404 && /invalid url|invalid_request_error/i.test(detail);
}
/**
* Stable Audio 官方 v2beta（multipart/form-data）。
* - stable-audio-3        → POST {base}/stable-audio/text-to-audio    （202 异步 → GET /v2beta/audio/results/{id} 轮询）
* - stable-audio-2 / 2.5  → POST {base}/stable-audio-2/text-to-audio  （200 同步返回音频/JSON base64）
* - 不同模型参数不同：stable-audio-3 steps 4-8、duration ≤380；2 steps 30-100、cfg_scale 默认 7；
*   2.5 steps 4-8、cfg_scale 默认 1；均支持 seed、output_format(hp3|wav)。
*/
async function stabilityNativeAudio(channel, request, signal) {
	const rawBase = endpointBase(channel.apiUrl);
	const model = (request.upstream ?? request.model) || "stable-audio-2.5";
	const isV3 = /^stable-audio-3/i.test(model);
	const isV2 = /^stable-audio-2(\.[05])?$/i.test(model) || /^stable-audio-2-/i.test(model);
	const group = isV2 ? "stable-audio-2" : "stable-audio";
	const base = /\/v2beta\/audio$/i.test(rawBase) ? rawBase : /\/v2beta$/i.test(rawBase) ? `${rawBase}/audio` : `${rawBase}/v2beta/audio`;
	const endpoint = `${base}/${group}/text-to-audio`;
	const form = new FormData();
	form.set("prompt", request.prompt);
	form.set("model", model);
	if (request.duration !== void 0 && Number.isFinite(request.duration)) {
		const maxDuration = isV3 ? 380 : 190;
		form.set("duration", String(Math.min(maxDuration, Math.max(1, request.duration))));
	}
	if (request.seed !== void 0 && Number.isFinite(request.seed)) form.set("seed", String(Math.floor(Math.min(4294967294, Math.max(0, request.seed)))));
	const format = request.format === "wav" ? "wav" : "mp3";
	form.set("output_format", format);
	if (request.steps !== void 0 && Number.isInteger(request.steps)) {
		const minSteps = isV2 && !/2\.5/i.test(model) ? 30 : 4;
		const maxSteps = isV2 && !/2\.5/i.test(model) ? 100 : 8;
		form.set("steps", String(Math.min(maxSteps, Math.max(minSteps, request.steps))));
	}
	if (request.cfgScale !== void 0 && Number.isFinite(request.cfgScale)) form.set("cfg_scale", String(Math.min(25, Math.max(1, request.cfgScale))));
	const response = await fetchWithTimeout(endpoint, {
		method: "POST",
		redirect: "error",
		headers: {
			authorization: `Bearer ${channel.apiKey.trim()}`,
			accept: "application/json"
		},
		body: form,
		signal
	}, isV3 ? 6e4 : UPSTREAM_TIMEOUT_MS);
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		if (isStabilityRouteMiss(response.status, detail)) throw new StabilityRouteMissError();
		throw new AudioGenError(`Stable Audio API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
	}
	if (response.status === 202) {
		const payload = await response.json().catch(() => ({}));
		if (payload.id === void 0 || payload.id === "") throw new AudioGenError("Stable Audio accepted the job but returned no result id", "audio-empty-result");
		const resultUrl = `${base.replace(/\/v2beta\/audio$/i, "")}/v2beta/audio/results/${encodeURIComponent(payload.id)}`;
		const deadline = Date.now() + UPSTREAM_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (signal?.aborted === true) throw new AudioGenError("Stable Audio generation was aborted", "audio-aborted");
			const polled = await fetchWithTimeout(resultUrl, {
				method: "GET",
				redirect: "error",
				headers: {
					authorization: `Bearer ${channel.apiKey.trim()}`,
					accept: "application/json"
				},
				signal
			}, 6e4);
			if (polled.ok) return normalizeAudioResponse(polled, {
				apiKey: channel.apiKey,
				fallbackMime: "audio/mpeg"
			});
			if (polled.status === 404 || polled.status === 202) {
				await new Promise((resolve) => setTimeout(resolve, 5e3));
				continue;
			}
			const detail = await polled.text().catch(() => "");
			throw new AudioGenError(`Stable Audio result API error (HTTP ${polled.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
		}
		throw new AudioGenError("Stable Audio generation timed out waiting for the result", "audio-timeout");
	}
	return normalizeAudioResponse(response, {
		apiKey: channel.apiKey,
		fallbackMime: "audio/mpeg"
	});
}
/**
* Stable Audio 经 OpenAI 兼容网关（如 New API 的 /v1/audio/speech）：
* 模型名映射到 Stable 上游，JSON 体为 {model, input, output_format, duration,
* seed, steps, cfg_scale} —— 与官方 v2beta 字段一一对应，网关负责转发。
*/
async function stabilityGatewayAudio(channel, request, signal) {
	const rawBase = endpointBase(channel.apiUrl);
	const model = (request.upstream ?? request.model) || "stable-audio-2.5";
	const isV3 = /^stable-audio-3/i.test(model);
	const isV2 = /^stable-audio-2(\.[05])?$/i.test(model) || /^stable-audio-2-/i.test(model);
	const endpoint = /\/audio\/speech(\?|$)/i.test(rawBase) ? rawBase : `${rawBase}/audio/speech`;
	const format = request.format === "wav" ? "wav" : "mp3";
	const body = {
		model,
		input: request.prompt,
		output_format: format,
		...request.duration !== void 0 && Number.isFinite(request.duration) ? { duration: Math.min(isV3 ? 380 : 190, Math.max(1, request.duration)) } : {},
		...request.seed !== void 0 && Number.isFinite(request.seed) ? { seed: Math.floor(Math.min(4294967294, Math.max(0, request.seed))) } : {},
		...request.steps !== void 0 && Number.isInteger(request.steps) ? { steps: Math.min(isV2 && !/2\.5/i.test(model) ? 100 : 8, Math.max(isV2 && !/2\.5/i.test(model) ? 30 : 4, request.steps)) } : {},
		...request.cfgScale !== void 0 && Number.isFinite(request.cfgScale) ? { cfg_scale: Math.min(25, Math.max(1, request.cfgScale)) } : {}
	};
	const response = await fetchWithTimeout(endpoint, {
		method: "POST",
		redirect: "follow",
		headers: {
			authorization: `Bearer ${channel.apiKey.trim()}`,
			accept: "audio/*",
			"content-type": "application/json"
		},
		body: JSON.stringify(body),
		signal
	}, UPSTREAM_TIMEOUT_MS);
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		if (isStabilityRouteMiss(response.status, detail)) throw new StabilityRouteMissError();
		throw new AudioGenError(`Stable Audio gateway API error (HTTP ${response.status})${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`, "audio-api-error");
	}
	return normalizeAudioResponse(response, {
		apiKey: channel.apiKey,
		fallbackMime: "audio/mpeg"
	});
}
/**
* 稳定性入口：优先官方 v2beta（api.stability.ai / v2beta 形态），
* 网关形态（apiUrl 以 /v1 结尾或已含 /audio/speech）优先 OpenAI 兼容；
* 一方返回 404 Invalid URL（未路由）时自动换另一方重试。
*/
async function stabilityAudio(channel, request, signal) {
	const styles = stabilityGatewayStyle(channel) ? ["gateway", "native"] : ["native", "gateway"];
	let lastError;
	for (const style of styles) try {
		if (style === "gateway") return await stabilityGatewayAudio(channel, request, signal);
		return await stabilityNativeAudio(channel, request, signal);
	} catch (error) {
		if (!(error instanceof StabilityRouteMissError)) throw error;
		lastError = error;
	}
	throw lastError ?? new AudioGenError("Stable Audio 渠道未配置或不可达", "audio-api-error");
}
async function genericAudio(channel, request, signal) {
	const base = endpointBase(channel.apiUrl);
	if (request.mode === "tts" && !/\/generate(\?|$)/i.test(base)) return openAITTS(channel, request, signal);
	const endpoint = /\/generate(\?|$)/i.test(base) ? base : `${base}/generate`;
	const body = {
		model: (request.upstream ?? request.model) || "default",
		prompt: request.prompt,
		mode: request.mode,
		...request.voice !== void 0 ? { voice: request.voice } : {},
		...request.duration !== void 0 ? { duration: request.duration } : {},
		...request.format !== void 0 ? { output_format: request.format } : {}
	};
	return normalizeAudioResponse(await fetchWithTimeout(endpoint, {
		method: "POST",
		redirect: "error",
		headers: {
			authorization: `Bearer ${channel.apiKey.trim()}`,
			"content-type": "application/json",
			accept: "application/json, audio/mpeg, audio/wav"
		},
		body: JSON.stringify(body),
		signal
	}, UPSTREAM_TIMEOUT_MS), {
		apiKey: channel.apiKey,
		fallbackMime: "audio/mpeg"
	});
}
/**
* Generate one or more audio outputs from a configured channel.
* @returns normalized generated audio (base64, mime, bytes).
*/
async function generateAudio(channel, request, signal) {
	if (channel.apiUrl.trim() === "") throw new AudioGenError("channel API URL is not configured", "audio-no-endpoint");
	if (channel.apiKey.trim() === "") throw new AudioGenError("channel API key is not configured", "audio-no-key");
	if (request.prompt.trim() === "") throw new AudioGenError("audio prompt/text is required", "audio-empty-prompt");
	if (request.mode === "voice_design" && !isMiniMax$2(channel) && !isElevenLabs$2(channel)) throw new AudioGenError("音色设计当前仅支持 MiniMax（/v1/voice_design）与 ElevenLabs（/v1/text-to-voice/design）渠道", "voice-design-unsupported");
	if (isElevenLabs$2(channel)) return elevenLabs(channel, request, signal);
	if (isMiniMax$2(channel)) return minimax(channel, request, signal);
	if (isStability$1(channel) || /^stable-audio-/i.test(((request.upstream ?? request.model) || "").trim())) return stabilityAudio(channel, request, signal);
	if (isOpenAICompatible(channel, request.mode)) return openAITTS(channel, request, signal);
	return genericAudio(channel, request, signal);
}
//#endregion
//#region src/prompt-enhance.ts
/** 按生成模式给出增强指令（系统提示）。 */
function instructionsFor(mode) {
	return [
		"你是一个音频提示词增强助手。用户给出一个粗略的音频生成需求，",
		"请将其扩写为一段可直接提交给音频生成模型的中文或英文描述。",
		"只输出增强后的描述本身，不要输出任何解释、前后缀、引号或代码块。",
		"保持用户原始意图，不要改变其核心内容；为最终生成的音频服务。",
		"描述控制在 200-600 字左右。"
	].join("") + {
		tts: "这是文本转语音（TTS）任务：让文本更适合朗读——口语化、自然、带合适的情感标签（如 (laughs)、(whisper)），避免生僻多音字和超长句，可适当补足上下文使语句完整，但不要改写原意。",
		music: "这是音乐生成任务：扩写音乐风格/情绪/乐器/结构/节奏变化/氛围，使用音频模型熟悉的描述词汇（如 cinematic orchestral、lo-fi、bpm、弦乐进出、旋律动机、前中后段结构），如用户未指定可补充风格建议，但保持原方向。",
		sfx: "这是音效生成任务：扩写声音材质、动作过程、空间感、节奏（先轻后重、清脆短促等）、环境氛围，用具体拟声与材质词，避免抽象概括。",
		voice_design: "这是音色设计任务：扩写人声/音色特征——性别年龄、音域、音质（低沉/清亮/沙哑）、语速、情绪性格、适用场景，用可感知的描述，方便语音模型合成。"
	}[mode];
}
/** 读取 Agent 默认模型并调用 LLM 增强，返回增强后的文本。
*  @param override - 用户设置的增强模型；缺省/为空时回退到 agent-default-model。 */
async function enhancePromptText(deps, prompt, mode, override) {
	const text = prompt.trim();
	if (text === "") throw new AudioGenError("提示词为空，无法增强", "enhance-empty-prompt");
	const selected = override !== void 0 && override.provider.trim() !== "" && override.model.trim() !== "" ? {
		provider: override.provider.trim(),
		model: override.model.trim()
	} : void 0;
	const descriptor = selected === void 0 ? (deps.settings.describe({ redactSecrets: true }) ?? []).find((candidate) => String(candidate.ns) === "agent-default-model") : void 0;
	const value = selected ?? descriptor?.value ?? {};
	const provider = typeof value.provider === "string" && value.provider.trim() !== "" ? value.provider.trim() : "";
	const model = typeof value.model === "string" && value.model.trim() !== "" ? value.model.trim() : "";
	if (provider === "" || model === "") throw new AudioGenError("未找到 Agent 默认模型（agent-default-model）：请先在「设置 → 模型」中配置默认模型", "no-default-model");
	const runtime = deps.llm?.();
	if (runtime === void 0 || runtime.stream === void 0) throw new AudioGenError("宿主 LLM 服务不可用（ctx.llm 未注册）", "llm-unavailable");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), 3e4);
	timer.unref?.();
	let output = "";
	let terminalFailure = "";
	try {
		for await (const chunk of runtime.stream({
			provider,
			model,
			messages: [{
				role: "user",
				content: [{
					type: "text",
					text
				}]
			}],
			system: instructionsFor(mode),
			temperature: .7,
			maxTokens: 1200,
			signal: controller.signal
		})) {
			const record = chunk;
			if (record.type === "text-delta" && typeof record.text === "string") output += record.text;
			else if (record.type === "block-end" && record.block !== void 0 && record.block.type === "text" && typeof record.block.text === "string") output += record.block.text;
			else if (record.type === "finish" && record.reason !== void 0 && record.reason.kind !== "stop" && record.reason.kind !== void 0 && terminalFailure === "") {
				const failure = record.reason.failure;
				terminalFailure = typeof failure?.message === "string" && failure.message.trim() !== "" ? `${failure.message}${typeof failure.code === "string" ? `（${failure.code}）` : ""}` : `stream ${record.reason.kind}`;
			}
		}
	} finally {
		clearTimeout(timer);
	}
	const result = stripFences$1(output.trim());
	if (result === "") {
		if (terminalFailure !== "") throw new AudioGenError(`增强失败：LLM 调用出错（${terminalFailure}）。请检查「设置 → 模型」的默认模型是否可用`, "enhance-llm-error");
		throw new AudioGenError("模型未返回增强内容：请检查「设置 → 模型」的默认模型是否可用（或稍后重试）", "enhance-empty-result");
	}
	return result;
}
/** 去掉模型可能包裹的 ``` 代码围栏。 */
function stripFences$1(value) {
	if (value === "") return value;
	return value.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
}
//#endregion
//#region src/voice-manager.ts
const SHARED_VOICE_SORT_OPTIONS = [
	"most_used",
	"random",
	"oldest",
	"newest"
];
/**
* ISO 639-1 -> matching substrings across the two vendor vocabularies:
* ElevenLabs uses ISO codes ("en"), MiniMax system ids use language labels
* ("Chinese (Mandarin)_..." / "Japanese_..."). The aliases make one dropdown
* value match both. "zh" also covers Cantonese (Chinese (Cantonese)).
*/
const LANGUAGE_ALIASES = {
	zh: [
		"zh",
		"chinese",
		"mandarin",
		"cantonese",
		"yue"
	],
	en: ["en", "english"],
	ja: ["ja", "japanese"],
	ko: ["ko", "korean"],
	es: ["es", "spanish"],
	fr: ["fr", "french"],
	de: ["de", "german"],
	ru: ["ru", "russian"],
	it: ["it", "italian"],
	pt: ["pt", "portuguese"],
	ar: ["ar", "arabic"],
	hi: ["hi", "hindi"]
};
function languageMatches(language, locale, needle) {
	const haystack = [language ?? "", locale ?? ""].join(" ").toLowerCase();
	const value = needle.trim().toLowerCase();
	if (value === "") return true;
	if (haystack.includes(value)) return true;
	for (const alias of LANGUAGE_ALIASES[value] ?? []) if (haystack.includes(alias)) return true;
	return false;
}
const MINIMAX_LANGUAGE_PREFIXES = [
	"Chinese (Mandarin)",
	"Chinese (Cantonese)",
	"Japanese",
	"English",
	"Korean",
	"Spanish",
	"French",
	"German",
	"Italian",
	"Russian",
	"Portuguese",
	"Arabic",
	"Hindi"
];
function isMiniMax$1(channel) {
	return channel.preset === "minimax" || /minimax/i.test(channel.apiUrl);
}
function isElevenLabs$1(channel) {
	return channel.preset === "elevenlabs" || /elevenlabs/i.test(channel.apiUrl);
}
function supportsVoiceManagement(channel) {
	return isMiniMax$1(channel) || isElevenLabs$1(channel);
}
function baseUrl$1(url) {
	return url.trim().replace(/\/+$/, "");
}
/** MiniMax system voice ids carry a language label prefix. */
function languageFromMiniMaxId(voiceId) {
	for (const prefix of MINIMAX_LANGUAGE_PREFIXES) if (voiceId.startsWith(`${prefix}_`)) return prefix;
}
function asStringList$1(value) {
	if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item.trim() !== "");
	if (typeof value === "string" && value.trim() !== "") return [value.trim()];
	return [];
}
async function fetchJson$1(url, init) {
	const response = await fetch(url, init);
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`HTTP ${response.status}${text === "" ? "" : `: ${text.slice(0, 300)}`}`);
	}
	return response.json();
}
async function postJson$1(url, apiKey, body) {
	return fetchJson$1(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey.trim()}`,
			"content-type": "application/json"
		},
		body: JSON.stringify(body)
	});
}
function normalizeMiniMax(voice, source) {
	const voiceId = String(voice.voice_id ?? "").trim();
	const description = asStringList$1(voice.description).join("；") || void 0;
	const language = languageFromMiniMaxId(voiceId);
	return {
		provider: "minimax",
		voice_id: voiceId,
		name: String(voice.voice_name ?? voiceId).trim() || voiceId,
		source,
		...language === void 0 ? {} : { language },
		...description === void 0 ? {} : { description },
		deletable: source === "custom"
	};
}
async function listMiniMax(channel) {
	const payload = await postJson$1(`${baseUrl$1(channel.apiUrl).replace(/\/v1$/i, "")}/v1/get_voice`, channel.apiKey, { voice_type: "all" });
	if (payload.base_resp?.status_code !== void 0 && payload.base_resp.status_code !== 0) throw new Error(`MiniMax get_voice 失败：${payload.base_resp.status_msg ?? `status ${payload.base_resp.status_code}`}`);
	const entries = [];
	for (const voice of Array.isArray(payload.system_voice) ? payload.system_voice : []) {
		if (typeof voice !== "object" || voice === null) continue;
		const entry = normalizeMiniMax(voice, "system");
		if (entry.voice_id !== "") entries.push(entry);
	}
	for (const bucket of ["voice_cloning", "voice_generation"]) for (const voice of Array.isArray(payload[bucket]) ? payload[bucket] : []) {
		if (typeof voice !== "object" || voice === null) continue;
		const entry = normalizeMiniMax(voice, "custom");
		if (entry.voice_id !== "") entries.push(entry);
	}
	return {
		vendor: "minimax",
		voices: entries,
		truncated: false
	};
}
function normalizeElevenLabs(voice, source) {
	const voiceId = String(voice.voice_id ?? "").trim();
	const labels = typeof voice.labels === "object" && voice.labels !== null ? voice.labels : void 0;
	const pick = (key) => {
		const owned = labels?.[key];
		const direct = voice[key];
		return (typeof owned === "string" && owned.trim() !== "" ? owned : typeof direct === "string" && direct.trim() !== "" ? direct : void 0)?.trim() || void 0;
	};
	const description = pick("description");
	const name = String(voice.name ?? voiceId).trim() || voiceId;
	const keptLabels = {};
	for (const [key, value] of Object.entries(labels ?? {})) if (typeof value === "string" && value.trim() !== "") keptLabels[key] = value;
	const descriptive = pick("descriptive");
	return {
		provider: "elevenlabs",
		voice_id: voiceId,
		name,
		source,
		...pick("language") === void 0 ? {} : { language: pick("language") },
		...pick("locale") === void 0 ? {} : { locale: pick("locale") },
		...pick("accent") === void 0 ? {} : { accent: pick("accent") },
		...pick("gender") === void 0 ? {} : { gender: pick("gender") },
		...pick("age") === void 0 ? {} : { age: pick("age") },
		...pick("use_case") === void 0 ? {} : { use_case: pick("use_case") },
		...pick("category") === void 0 ? {} : { category: pick("category") },
		...Object.keys(keptLabels).length === 0 ? {} : { labels: keptLabels },
		...descriptive === void 0 ? {} : { descriptive },
		...description === void 0 ? {} : { description },
		...typeof voice.preview_url === "string" && voice.preview_url.trim() !== "" ? { preview_url: voice.preview_url.trim() } : {},
		deletable: source === "owned"
	};
}
async function listElevenLabs(channel, options) {
	const base = baseUrl$1(channel.apiUrl);
	const headers = {
		"xi-api-key": channel.apiKey.trim(),
		accept: "application/json"
	};
	const entries = [];
	const failures = [];
	const filters = options.serverFilters ?? {};
	try {
		const payload = await fetchJson$1(`${base}/voices`, { headers });
		for (const voice of Array.isArray(payload.voices) ? payload.voices : []) {
			if (typeof voice !== "object" || voice === null) continue;
			const entry = normalizeElevenLabs(voice, "owned");
			if (entry.voice_id !== "") entries.push(entry);
		}
	} catch (error) {
		failures.push(`自有音色：${error instanceof Error ? error.message : String(error)}`);
	}
	const pageSize = 100;
	try {
		for (let page = 0; page < 3; page += 1) {
			const query = new URLSearchParams({
				page_size: String(pageSize),
				page: String(page)
			});
			if (options.language !== void 0 && options.language.trim() !== "") query.set("language", options.language.trim());
			if (filters.search !== void 0 && filters.search.trim() !== "") query.set("search", filters.search.trim());
			if (filters.use_case !== void 0 && filters.use_case.trim() !== "") query.set("use_case", filters.use_case.trim());
			if (filters.accent !== void 0 && filters.accent.trim() !== "") query.set("accent", filters.accent.trim());
			if (filters.gender !== void 0 && filters.gender.trim() !== "") query.set("gender", filters.gender.trim());
			if (filters.age !== void 0 && filters.age.trim() !== "") query.set("age", filters.age.trim());
			if (filters.locale !== void 0 && filters.locale.trim() !== "") query.set("locale", filters.locale.trim());
			if (filters.category !== void 0 && filters.category.trim() !== "") query.set("category", filters.category.trim());
			if (filters.sort !== void 0 && SHARED_VOICE_SORT_OPTIONS.includes(filters.sort)) query.set("sort", filters.sort);
			if (filters.featured === true) query.set("featured", "true");
			if (filters.free_users_allowed === true) query.set("free_users_allowed", "true");
			if (filters.descriptive === true) query.set("descriptive", "true");
			const payload = await fetchJson$1(`${base}/shared-voices?${query.toString()}`, { headers });
			const voices = Array.isArray(payload.voices) ? payload.voices : [];
			for (const voice of voices) {
				if (typeof voice !== "object" || voice === null) continue;
				const entry = normalizeElevenLabs(voice, "shared");
				if (entry.voice_id !== "") entries.push(entry);
			}
			if (payload.has_more !== true || voices.length === 0) break;
		}
	} catch (error) {
		failures.push(`共享音色库：${error instanceof Error ? error.message : String(error)}`);
	}
	if (entries.length === 0 && failures.length > 0) {
		const gatewayHint = gatewayVoiceLibraryHint(failures);
		throw new Error(`ElevenLabs 音色列表拉取失败：${failures.join("；").slice(0, 300)}${gatewayHint}`);
	}
	const seen = /* @__PURE__ */ new Set();
	const deduped = [];
	for (const entry of entries) {
		if (seen.has(entry.voice_id)) continue;
		seen.add(entry.voice_id);
		deduped.push(entry);
	}
	const note = failures.length === 0 ? void 0 : `部分端点失败（已忽略）：${failures.join("；").slice(0, 300)}${gatewayVoiceLibraryHint(failures)}`;
	return {
		vendor: "elevenlabs",
		voices: deduped,
		truncated: false,
		...note === void 0 ? {} : { note }
	};
}
/**
* Gateway (new-api 类) 通常不映射 ElevenLabs 音色库端点，其响应是
* 404/Invalid URL。把这种失败翻译成可操作的建议，而不是一份原始 JSON。
*/
function gatewayVoiceLibraryHint(failures) {
	const raw = failures.join(" ").toLowerCase();
	if (!raw.includes("404") && !raw.includes("invalid url") && !raw.includes("not found")) return "";
	return "。该渠道网关未提供 ElevenLabs 音色库端点（/v1/voices、/v1/shared-voices）：生成可用，但浏览/删除音色需要配置官方 API 地址 https://api.elevenlabs.io 的渠道";
}
async function listVendorVoices(channel, options = {}) {
	if (channel.apiUrl.trim() === "") throw new Error("渠道未配置 API 地址");
	if (channel.apiKey.trim() === "") throw new Error("渠道未配置 API 密钥");
	if (!supportsVoiceManagement(channel)) throw new Error(`当前渠道「${channel.name}」不提供厂商音色管理接口：仅 MiniMax 与 ElevenLabs 支持音色浏览/删除`);
	if (isMiniMax$1(channel)) {
		const result = await listMiniMax(channel);
		return {
			vendor: result.vendor,
			...applyFilter(result.voices, options),
			...serverFilterNote(options.serverFilters) === void 0 ? {} : { note: serverFilterNote(options.serverFilters) }
		};
	}
	const result = await listElevenLabs(channel, options);
	return {
		vendor: result.vendor,
		...applyFilter(result.voices, options),
		...result.note === void 0 ? {} : { note: result.note }
	};
}
/**
* listVendorVoices 的网关友好版本：聚合网关（new-api 等）通常只代理生成接口、
* 不映射 /v1/voices 与 /v1/shared-voices，此时把「渠道配置的音色目录」
* （channel.models 的 alias 列表）作为候选池，保证音色浏览/推荐/选角仍可用。
* 返回条目的 source 为 `configured`（只读、无试听、无性别/年龄元数据）。
*/
async function listVendorVoicesWithFallback(channel, options = {}) {
	try {
		return await listVendorVoices(channel, options);
	} catch (error) {
		const entries = (channel.models ?? []).filter((model) => model.alias.trim() !== "").map((model) => ({
			provider: channel.preset || "configured",
			voice_id: model.alias,
			name: model.alias,
			source: "configured",
			deletable: false
		}));
		if (entries.length === 0) throw error;
		const reason = error instanceof Error ? error.message : String(error);
		return {
			vendor: channel.preset || "custom",
			...applyFilter(entries, options),
			note: `音色库接口不可用（${reason.slice(0, 160)}）。已回退为渠道配置的音色目录（${entries.length} 个）：只能按名称选择，无试听与语言/性别/年龄元数据；配一个官方 API 地址（如 https://api.elevenlabs.io）的渠道可获得完整音色库`
		};
	}
}
async function deleteVendorVoice(channel, voiceId) {
	if (channel.apiUrl.trim() === "") throw new Error("渠道未配置 API 地址");
	if (channel.apiKey.trim() === "") throw new Error("渠道未配置 API 密钥");
	const id = voiceId.trim();
	if (id === "") throw new Error("voice_id 不能为空");
	if (isMiniMax$1(channel)) {
		const known = (await listMiniMax(channel)).voices.find((entry) => entry.voice_id === id);
		if (known !== void 0 && known.source === "system") throw new Error(`MiniMax 系统预置音色「${id}」为只读，不能删除（仅自定义音色可删）`);
		const payload = await postJson$1(`${baseUrl$1(channel.apiUrl).replace(/\/v1$/i, "")}/v1/delete_voice`, channel.apiKey, {
			voice_id: id,
			voice_type: "voice_cloning"
		});
		if (payload.base_resp?.status_code !== void 0 && payload.base_resp.status_code !== 0) throw new Error(`MiniMax delete_voice 失败：${payload.base_resp.status_msg ?? `status ${payload.base_resp.status_code}`}`);
		return {
			vendor: "minimax",
			voice_id: id,
			deleted: true
		};
	}
	if (isElevenLabs$1(channel)) {
		const base = baseUrl$1(channel.apiUrl);
		const headers = {
			"xi-api-key": channel.apiKey.trim(),
			accept: "application/json"
		};
		let owned = false;
		let checkFailed = false;
		try {
			const payload = await fetchJson$1(`${base}/voices`, { headers });
			if (Array.isArray(payload.voices)) owned = payload.voices.some((voice) => String(voice.voice_id ?? "") === id);
		} catch {
			checkFailed = true;
		}
		if (!checkFailed && !owned) throw new Error(`ElevenLabs 音色「${id}」不是账户自有音色（共享库/官方音色只读），不能删除`);
		const response = await fetch(`${base}/voices/${encodeURIComponent(id)}`, {
			method: "DELETE",
			headers
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`ElevenLabs 删除失败（HTTP ${response.status}）${text === "" ? "" : `：${text.slice(0, 300)}`}`);
		}
		return {
			vendor: "elevenlabs",
			voice_id: id,
			deleted: true
		};
	}
	throw new Error(`当前渠道「${channel.name}」不提供厂商音色管理接口：仅 MiniMax 与 ElevenLabs 支持音色浏览/删除`);
}
function cap(options) {
	const limit = typeof options.limit === "number" && Number.isFinite(options.limit) ? Math.floor(options.limit) : 100;
	return Math.max(1, Math.min(500, limit));
}
/** Which official shared-voice filters are set (for the MiniMax "not supported" note). */
function serverFilterNote(filters) {
	if (filters === void 0) return void 0;
	const set = Object.entries(filters).filter(([, value]) => value !== void 0 && value !== false).map(([key]) => key);
	return set.length === 0 ? void 0 : `MiniMax 无服务端筛选端点：${set.join(", ")} 仅在本地按已有字段兜底过滤`;
}
function applyFilter(entries, options) {
	const keyword = options.keyword?.trim().toLowerCase() ?? "";
	const language = options.language?.trim().toLowerCase() ?? "";
	const source = options.source?.trim().toLowerCase() ?? "";
	const filters = options.serverFilters ?? {};
	const field = (value) => value?.trim().toLowerCase() ?? "";
	const count = cap(options);
	const matched = entries.filter((entry) => {
		if (source !== "" && entry.source !== source) return false;
		if (language !== "" && !languageMatches(entry.language, entry.locale, language)) return false;
		if (field(filters.accent) !== "" && field(entry.accent) !== field(filters.accent)) return false;
		if (field(filters.gender) !== "" && field(entry.gender) !== field(filters.gender)) return false;
		if (field(filters.age) !== "" && field(entry.age) !== field(filters.age)) return false;
		if (field(filters.use_case) !== "" && field(entry.use_case) !== field(filters.use_case)) return false;
		if (field(filters.category) !== "" && field(entry.category) !== field(filters.category)) return false;
		if (field(filters.locale) !== "" && field(entry.locale) !== field(filters.locale)) return false;
		const search = field(filters.search);
		if (search !== "") {
			if (![entry.name, entry.description ?? ""].join(" ").toLowerCase().includes(search)) return false;
		}
		if (keyword !== "") {
			const haystack = [
				entry.name,
				entry.description ?? "",
				entry.accent ?? "",
				entry.use_case ?? "",
				entry.gender ?? "",
				entry.age ?? "",
				entry.descriptive ?? "",
				...Object.values(entry.labels ?? {})
			].join(" ").toLowerCase();
			for (const token of keyword.split(/\s+/)) if (token !== "" && !haystack.includes(token)) return false;
		}
		return true;
	});
	matched.sort((a, b) => a.deletable === b.deletable ? 0 : a.deletable ? -1 : 1);
	return {
		voices: matched.slice(0, count),
		truncated: matched.length > count
	};
}
//#endregion
//#region src/voice-recommend.ts
/** 推荐记录上限（超出最旧淘汰，新记录永远插在最前）。 */
const RECORD_LIMIT = 50;
function recommendStorePath() {
	return path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "dsh-audiogen", "voice-recommends.json");
}
async function loadRecommendStore() {
	try {
		const text = await readFile(recommendStorePath(), "utf-8");
		const payload = JSON.parse(text);
		if (typeof payload === "object" && payload !== null && Array.isArray(payload.entries)) return {
			version: 1,
			updatedAt: String(payload.updatedAt ?? ""),
			entries: payload.entries
		};
	} catch {}
	return {
		version: 1,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		entries: []
	};
}
/** 追加一条 AI 推荐记录（最好努力：失败不阻断推荐结果返回）。 */
async function appendVoiceRecommendRecord(record) {
	const stored = {
		id: randomUUID(),
		createdAt: Date.now(),
		...record
	};
	try {
		const store = await loadRecommendStore();
		store.entries = [stored, ...store.entries.filter((entry) => entry.id !== stored.id)].slice(0, RECORD_LIMIT);
		store.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		const file = recommendStorePath();
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, JSON.stringify(store, null, 2) + "\n", "utf-8");
	} catch {}
	return stored;
}
/** 读取最近 N 条 AI 推荐记录（新→旧）。 */
async function listVoiceRecommendRecords(limit = 20) {
	return (await loadRecommendStore()).entries.slice(0, Math.max(1, Math.min(50, Math.floor(limit))));
}
/** 删除一条 AI 推荐记录（不存在的 id 幂等成功）。 */
async function removeVoiceRecommendRecord(id) {
	const store = await loadRecommendStore();
	const next = store.entries.filter((entry) => entry.id !== id);
	if (next.length === store.entries.length) return;
	const file = recommendStorePath();
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify({
		...store,
		entries: next,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	}, null, 2) + "\n", "utf-8");
}
/** 候选描述的截断长度（超出以 … 结尾）。 */
const MAX_DESCRIPTION_CHARS$1 = 400;
/** LLM 调用超时。 */
const RECOMMEND_TIMEOUT_MS = 45e3;
/** 输出 token 预算：默认模型多为推理模型，思考 token 计入输出，需留足预算。 */
const RECOMMEND_MAX_TOKENS = 8192;
/** 需求描述 + 候选池 → top-k 推荐（每条含 LLM 理由）。 */
async function recommendVoices(deps, requirement, candidates, topK) {
	const text = requirement.trim();
	if (text === "") throw new AudioGenError("需求描述为空，无法推荐音色", "recommend-empty-requirement");
	if (candidates.length === 0) throw new AudioGenError("候选音色池为空：请先确认渠道配置了音色库，或放宽筛选条件", "recommend-no-candidates");
	const value = (deps.settings.describe({ redactSecrets: true }) ?? []).find((candidate) => String(candidate.ns) === "agent-default-model")?.value ?? {};
	const provider = typeof value.provider === "string" && value.provider.trim() !== "" ? value.provider.trim() : "";
	const model = typeof value.model === "string" && value.model.trim() !== "" ? value.model.trim() : "";
	if (provider === "" || model === "") throw new AudioGenError("未找到 Agent 默认模型（agent-default-model）：请先在「设置 → 模型」中配置默认模型", "no-default-model");
	const runtime = deps.llm?.();
	if (runtime === void 0 || runtime.stream === void 0) throw new AudioGenError("宿主 LLM 服务不可用（ctx.llm 未注册）", "llm-unavailable");
	const messages = buildRecommendMessages(text, candidates, topK);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), RECOMMEND_TIMEOUT_MS);
	timer.unref?.();
	let output = "";
	let terminalFailure = "";
	try {
		for await (const chunk of runtime.stream({
			provider,
			model,
			messages: [{
				role: "user",
				content: [{
					type: "text",
					text: messages.user
				}]
			}],
			system: messages.system,
			temperature: .2,
			maxTokens: RECOMMEND_MAX_TOKENS,
			signal: controller.signal
		})) {
			const record = chunk;
			if (record.type === "text-delta" && typeof record.text === "string") output += record.text;
			else if (record.type === "block-end" && record.block !== void 0 && record.block.type === "text" && typeof record.block.text === "string") output += record.block.text;
			else if (record.type === "finish" && record.reason !== void 0 && record.reason.kind !== "stop" && record.reason.kind !== void 0 && terminalFailure === "") {
				const failure = record.reason.failure;
				terminalFailure = typeof failure?.message === "string" && failure.message.trim() !== "" ? `${failure.message}${typeof failure.code === "string" ? `（${failure.code}）` : ""}` : `stream ${record.reason.kind}`;
			}
		}
	} finally {
		clearTimeout(timer);
	}
	const content = stripFences(output.trim());
	if (content === "") {
		if (terminalFailure !== "") throw new AudioGenError(`音色推荐失败：LLM 调用出错（${terminalFailure}）。请检查「设置 → 模型」的默认模型是否可用`, "recommend-llm-error");
		throw new AudioGenError("模型未返回推荐内容：请检查「设置 → 模型」的默认模型是否可用（或稍后重试）", "recommend-empty-result");
	}
	const recommendations = parseVoiceRecommendations(content, candidates, topK);
	if (recommendations.length === 0) throw new AudioGenError("模型返回的推荐未能匹配候选池：请重试，或先用语言/关键词等条件缩小候选范围", "recommend-parse-failed");
	return recommendations;
}
/** 纯函数：解析 LLM 响应并把推荐校验为候选池成员；无效/编造 id 丢弃。
*
* 兼容三种返回形态（模型并不总守 JSON）：
*  1. JSON {"recommendations": [{"voice_id"|"voice_name": "...", "reason": "..."}]}
*  2. JSON 数组 [{"voice_id": "..."}, ...] 或单对象 {"voice_id": "..."}
*  3. 纯文本：按行/逗号/空白切分后，在候选池中做完全匹配（id 或 name，忽略大小写）
*/
function parseVoiceRecommendations(content, candidates, topK) {
	const limit = Math.max(1, Math.floor(Number.isFinite(topK) ? topK : 5));
	const results = [];
	const seen = /* @__PURE__ */ new Set();
	const findCandidate = (raw) => {
		const needle = String(raw).trim();
		if (needle === "") return void 0;
		const byId = candidates.find((candidate) => candidate.voice_id === needle);
		if (byId !== void 0) return byId;
		const byName = candidates.find((candidate) => candidate.name.toLowerCase() === needle.toLowerCase());
		if (byName !== void 0) return byName;
		const normalized = needle.toLowerCase().replace(/\s+/g, " ");
		return candidates.find((candidate) => candidate.voice_id.toLowerCase() === normalized || candidate.name.toLowerCase().replace(/\s+/g, " ") === normalized);
	};
	const push = (candidate, reason) => {
		if (candidate === void 0 || results.length >= limit) return;
		if (seen.has(candidate.voice_id)) return;
		seen.add(candidate.voice_id);
		results.push({
			...candidate,
			reason
		});
	};
	const data = loadJsonLoose(content);
	const rawItems = data === null ? void 0 : Array.isArray(data) ? data : typeof data === "object" ? data.recommendations : void 0;
	if (Array.isArray(rawItems)) for (const item of rawItems) {
		if (results.length >= limit) break;
		if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
		const record = item;
		const raw = record.voice_id ?? record.voice_name ?? record.name ?? record.id;
		const reason = typeof record.reason === "string" ? record.reason.trim() : "";
		push(findCandidate(String(raw)), reason);
	}
	if (results.length < limit) {
		const flat = content.replace(/```[a-zA-Z]*/g, " ");
		const lower = flat.toLowerCase();
		const found = candidates.filter((candidate) => {
			if (candidate.voice_id.length >= 3 && lower.includes(candidate.voice_id.toLowerCase())) return true;
			if (candidate.name.length >= 3 && lower.includes(candidate.name.toLowerCase())) return true;
			return false;
		}).sort((a, b) => {
			const ai = lower.indexOf(a.voice_id.toLowerCase());
			const aiAlt = lower.indexOf(a.name.toLowerCase());
			const bi = lower.indexOf(b.voice_id.toLowerCase());
			const biAlt = lower.indexOf(b.name.toLowerCase());
			const posA = ai === -1 ? aiAlt : ai === -1 ? ai : ai;
			const posB = bi === -1 ? biAlt : bi === -1 ? bi : bi;
			return (posA === -1 ? Number.MAX_SAFE_INTEGER : posA) - (posB === -1 ? Number.MAX_SAFE_INTEGER : posB);
		});
		for (const candidate of found) {
			if (results.length >= limit) break;
			push(candidate, "");
		}
		if (results.length < limit) {
			const tokens = flat.replace(/[{}[\],:;"'`\n，。！？、；：（）()【】《》]+/g, " ").split(/\s+/).map((token) => token.trim()).filter((token) => token !== "");
			for (const token of tokens) {
				if (results.length >= limit) break;
				push(findCandidate(token), "");
			}
		}
	}
	return results;
}
/** 构造推荐提示：系统（选角专家）+ 用户（需求 + 压缩候选 JSON）。 */
function buildRecommendMessages(requirement, candidates, topK) {
	const semantic = (entry) => entry.language !== void 0 && entry.language !== "" || entry.gender !== void 0 && entry.gender !== "" || entry.age !== void 0 && entry.age !== "" || entry.accent !== void 0 && entry.accent !== "" || entry.description !== void 0 && entry.description !== "";
	const shown = [...candidates].sort((a, b) => semantic(a) === semantic(b) ? 0 : semantic(a) ? -1 : 1).slice(0, 80);
	const note = candidates.length > shown.length ? `（注意：共 ${candidates.length} 条候选，仅展示前 ${shown.length} 条，其余候选未展示，请只从展示列表中挑选，或先用筛选条件缩小候选集。）` : "";
	const system = [
		"你是资深配音选角专家。根据用户描述的需求，从候选音色列表中挑选最合适的音色。",
		"要求：",
		"1. 只从候选列表中选，voice_id 必须与候选完全一致，不得编造。如果候选只有音色名没有语义字段，请结合名字里的语言/性别/年龄线索判断（如 Male_Young_、Chinese (Mandarin)_ 前缀）。",
		"2. 综合考虑语言、性别、年龄感、音色气质与需求的匹配度，以及配音用途（旁白/角色/广告/游戏等）。",
		`3. 只输出一个 JSON 对象：{"recommendations": [{"voice_id": "候选中的精确 voice_id", "reason": "简短中文理由"}]}，最多 ${Math.max(1, Math.floor(topK))} 条，按推荐优先级排序；候选的 voice_id 与 voice_name 可能相同或不同，一律用 voice_id 字段。`,
		"4. 同需求下避免推荐多个明显同质的音色；不要输出 JSON 以外的任何文字。"
	].join("\n");
	const compact = shown.map((entry) => ({
		voice_id: entry.voice_id,
		voice_name: entry.name,
		provider: entry.provider,
		source: entry.source,
		language: entry.language ?? null,
		locale: entry.locale ?? null,
		accent: entry.accent ?? null,
		gender: entry.gender ?? null,
		age: entry.age ?? null,
		category: entry.category ?? null,
		use_case: entry.use_case ?? null,
		descriptive: entry.descriptive ?? null,
		labels: entry.labels ?? null,
		description: truncate(entry.description, MAX_DESCRIPTION_CHARS$1),
		has_preview: entry.preview_url !== void 0 && entry.preview_url !== ""
	}));
	return {
		system,
		user: `需求：${requirement}\n\n候选音色（共 ${shown.length} 条）：\n${JSON.stringify(compact, null, 1)}\n${note}`
	};
}
function truncate(value, limit) {
	if (value === void 0) return null;
	return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
/** 去掉模型可能包裹的 ``` 代码围栏。 */
function stripFences(value) {
	if (value === "") return value;
	return value.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
}
/** 宽松 JSON 解析：整体失败时尝试提取第一个 { 到最后一个 }。 */
function loadJsonLoose(content) {
	const text = stripFences(content);
	try {
		return JSON.parse(text);
	} catch {
		const start = text.indexOf("{");
		const end = text.lastIndexOf("}");
		if (start === -1 || end <= start) return null;
		try {
			return JSON.parse(text.slice(start, end + 1));
		} catch {
			return null;
		}
	}
}
//#endregion
//#region src/audio-presets.ts
const AUDIO_PRESETS = [
	{
		id: "minimax",
		name: "MiniMax",
		apiUrl: "https://api.minimaxi.com",
		site: "https://www.minimaxi.com",
		hint: "MiniMax 官方音频：音色设计 / TTS / 音乐生成；建议点击「获取可用模型」拉取账号音色与模型",
		models: [
			{
				alias: "speech-2.8-hd",
				id: "speech-2.8-hd",
				category: "tts"
			},
			{
				alias: "speech-2.8-turbo",
				id: "speech-2.8-turbo",
				category: "tts"
			},
			{
				alias: "speech-2.6-hd",
				id: "speech-2.6-hd",
				category: "tts"
			},
			{
				alias: "speech-2.6-turbo",
				id: "speech-2.6-turbo",
				category: "tts"
			},
			{
				alias: "speech-02-hd",
				id: "speech-02-hd",
				category: "tts"
			},
			{
				alias: "speech-02-turbo",
				id: "speech-02-turbo",
				category: "tts"
			},
			{
				alias: "speech-01-hd",
				id: "speech-01-hd",
				category: "tts"
			},
			{
				alias: "speech-01-turbo",
				id: "speech-01-turbo",
				category: "tts"
			},
			{
				alias: "music-3.0",
				id: "music-3.0",
				category: "music"
			},
			{
				alias: "music-2.6",
				id: "music-2.6",
				category: "music"
			},
			{
				alias: "music-cover",
				id: "music-cover",
				category: "music"
			}
		]
	},
	{
		id: "elevenlabs",
		name: "ElevenLabs",
		apiUrl: "https://api.elevenlabs.io/v1",
		site: "https://elevenlabsai.cn",
		hint: "ElevenLabs 语音合成（TTS）与音乐生成（POST /v1/music，music_v2）；可点「获取可用模型」拉取音色与模型",
		models: [
			{
				alias: "Rachel",
				id: "21m00Tcm4TlvDq8ikWAM",
				category: "tts"
			},
			{
				alias: "Adam",
				id: "pNInz6obpgDQGcFmaJgB",
				category: "tts"
			},
			{
				alias: "Antoni",
				id: "ErXwobaYiN019PkySvjV",
				category: "tts"
			},
			{
				alias: "Bella",
				id: "EXAVITQu4vr4xnSDxMaL",
				category: "tts"
			},
			{
				alias: "eleven_multilingual_v2",
				id: "eleven_multilingual_v2",
				category: "tts"
			},
			{
				alias: "eleven_turbo_v2_5",
				id: "eleven_turbo_v2_5",
				category: "tts"
			},
			{
				alias: "eleven_flash_v2_5",
				id: "eleven_flash_v2_5",
				category: "tts"
			},
			{
				alias: "music_v2",
				id: "music_v2",
				category: "music"
			},
			{
				alias: "music_v1",
				id: "music_v1",
				category: "music"
			},
			{
				alias: "eleven_text_to_sound_v2",
				id: "eleven_text_to_sound_v2",
				category: "sfx"
			}
		]
	},
	{
		id: "stability-audio",
		name: "Stability AI（stable-audio）",
		apiUrl: "https://api.stability.ai/v2beta/audio",
		site: "https://stability.ai/stable-audio",
		hint: "Stability AI 文本到音频（TTS 描述 / 音乐 / 音效，stable-audio 系列；stable-audio-3 为异步任务）",
		models: [
			{
				alias: "stable-audio-3",
				id: "stable-audio-3",
				category: "music"
			},
			{
				alias: "stable-audio-2.5",
				id: "stable-audio-2.5",
				category: "music"
			},
			{
				alias: "stable-audio-2",
				id: "stable-audio-2",
				category: "music"
			}
		]
	}
];
/** Look up one built-in provider by id. */
function audioPresetById(id) {
	return AUDIO_PRESETS.find((preset) => preset.id === id);
}
//#endregion
//#region src/audio-models.ts
function isMiniMax(channel) {
	return channel.preset === "minimax" || /minimax/i.test(channel.apiUrl);
}
function isElevenLabs(channel) {
	return channel.preset === "elevenlabs" || /elevenlabs/i.test(channel.apiUrl);
}
function isStability(channel) {
	return channel.preset === "stability" || /stability\.ai/i.test(channel.apiUrl);
}
function baseUrl(url) {
	return url.trim().replace(/\/+$/, "");
}
/** Whether an upstream model id is audio-related at all. */
function categoryFor(id) {
	const value = id.toLowerCase();
	if (/(tts|speech|voice|t2a|talk|narration)/i.test(value)) return "tts";
	if (/(music|song|cover|lyrics|audio|melody|beat)/i.test(value)) return "music";
	if (/(sfx|sound.?effect|effect|foley)/i.test(value)) return "sfx";
}
async function fetchJson(url, init) {
	const response = await fetch(url, init);
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`HTTP ${response.status}${text === "" ? "" : `: ${text.slice(0, 300)}`}`);
	}
	return response.json();
}
async function postJson(url, apiKey, body) {
	return fetchJson(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey.trim()}`,
			"content-type": "application/json"
		},
		body: JSON.stringify(body)
	});
}
/** Discover available models/voices for a channel. */
async function discoverAudioModels(channel) {
	if (channel.apiUrl.trim() === "") throw new Error("API URL is not configured");
	if (channel.apiKey.trim() === "") throw new Error("API key is not configured");
	if (isMiniMax(channel)) return discoverMiniMax(channel);
	if (isElevenLabs(channel)) return discoverElevenLabs(channel);
	if (isStability(channel)) return discoverStability(channel);
	return discoverOpenAICompatible(channel);
}
async function discoverMiniMax(channel) {
	const url = `${baseUrl(channel.apiUrl).replace(/\/v1$/i, "")}/v1/get_voice`;
	try {
		const payload = await postJson(url, channel.apiKey, { voice_type: "all" });
		if (payload.base_resp?.status_code !== void 0 && payload.base_resp.status_code !== 0) throw new Error(payload.base_resp.status_msg ?? `MiniMax returned status ${payload.base_resp.status_code}`);
		const models = [];
		for (const voice of payload.system_voice ?? []) {
			const id = voice.voice_id?.trim() ?? "";
			if (id === "") continue;
			models.push({
				alias: voice.voice_name?.trim() || id,
				id,
				category: "tts",
				...voice.description !== void 0 && voice.description.length > 0 ? { description: voice.description.join("；") } : {}
			});
		}
		for (const voice of payload.voice_cloning ?? []) {
			const id = voice.voice_id?.trim() ?? "";
			if (id === "") continue;
			models.push({
				alias: id,
				id,
				category: "tts",
				...voice.description !== void 0 && voice.description.length > 0 ? { description: voice.description.join("；") } : {}
			});
		}
		for (const voice of payload.voice_generation ?? []) {
			const id = voice.voice_id?.trim() ?? "";
			if (id === "") continue;
			models.push({
				alias: id,
				id,
				category: "tts",
				...voice.description !== void 0 && voice.description.length > 0 ? { description: voice.description.join("；") } : {}
			});
		}
		const music = (audioPresetById("minimax")?.models ?? []).filter((model) => model.category === "music");
		for (const model of music) models.push({
			...model,
			category: "music"
		});
		return {
			models: dedupe(models),
			source: "MiniMax get_voice + music 目录"
		};
	} catch (error) {
		const fallback = (audioPresetById("minimax")?.models ?? []).map((model) => ({ ...model }));
		const message = error instanceof Error ? error.message : String(error);
		return {
			models: dedupe(fallback),
			source: `内置 MiniMax 目录（音色发现失败：${message.slice(0, 160)}）`
		};
	}
}
async function discoverElevenLabs(channel) {
	const base = baseUrl(channel.apiUrl);
	const headers = { "xi-api-key": channel.apiKey.trim() };
	const failures = [];
	const models = [];
	try {
		const payload = await fetchJson(`${base}/models`, { headers });
		for (const item of Array.isArray(payload) ? payload : []) {
			const id = item.model_id?.trim() ?? "";
			if (id === "") continue;
			if (item.capabilities?.text_to_speech !== true && item.capabilities?.voice_change !== true) continue;
			models.push({
				alias: item.name?.trim() || id,
				id,
				category: "tts",
				...item.description !== void 0 && item.description.trim() !== "" ? { description: item.description.trim() } : {}
			});
		}
	} catch (error) {
		failures.push(`模型列表：${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		const payload = await fetchJson(`${base}/voices`, { headers });
		for (const voice of Array.isArray(payload?.voices) ? payload.voices : []) {
			const id = voice.voice_id?.trim() ?? "";
			if (id === "") continue;
			models.push({
				alias: voice.name?.trim() || id,
				id,
				category: "tts",
				...voice.description !== void 0 && voice.description.trim() !== "" ? { description: voice.description.trim() } : {}
			});
		}
	} catch (error) {
		failures.push(`音色列表：${error instanceof Error ? error.message : String(error)}`);
	}
	if (models.length === 0) {
		const fallback = (audioPresetById("elevenlabs")?.models ?? []).map((model) => ({ ...model }));
		const detail = failures.length === 0 ? "" : `（发现失败：${failures.join("；").slice(0, 160)}）`;
		return {
			models: dedupe(fallback),
			source: `内置 ElevenLabs 目录${detail}`
		};
	}
	return {
		models: dedupe(models),
		source: "ElevenLabs /models + /voices"
	};
}
async function discoverStability(channel) {
	return {
		models: dedupe((audioPresetById("stability-audio")?.models ?? []).map((model) => ({ ...model }))),
		source: "Stability stable-audio 内置目录"
	};
}
async function discoverOpenAICompatible(channel) {
	const payload = await fetchJson(`${baseUrl(channel.apiUrl)}/models`, { headers: { authorization: `Bearer ${channel.apiKey.trim()}` } });
	const models = [];
	for (const item of payload.data ?? []) {
		const id = item.id?.trim() ?? "";
		if (id === "") continue;
		const category = categoryFor(id);
		if (category === void 0) continue;
		models.push({
			alias: id,
			id,
			category
		});
	}
	return {
		models: dedupe(models),
		source: "OpenAI-compatible /models（仅音频相关）"
	};
}
function dedupe(models) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const model of models) {
		if (seen.has(model.id)) continue;
		seen.add(model.id);
		out.push(model);
	}
	return out;
}
//#endregion
//#region src/audio-store.ts
/**
* Host-side persistence for generated audio and generation history.
* Files live under ~/.dsh/dsh-audiogen/audio/; history is one JSON document.
* The resource library lives under ~/.dsh/dsh-audiogen/library/ with one
* index JSON plus files organized by type (voice/music/sfx/tts) and category.
*/
function dshHome() {
	return process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
}
const AUDIO_DATA_DIR = path.join(dshHome(), "dsh-audiogen", "audio");
const HISTORY_FILE = path.join(dshHome(), "dsh-audiogen", "history.json");
const LIBRARY_DATA_DIR = path.join(dshHome(), "dsh-audiogen", "library");
const LIBRARY_INDEX_FILE = path.join(LIBRARY_DATA_DIR, "index.json");
async function ensureDir() {
	await mkdir(AUDIO_DATA_DIR, { recursive: true });
}
function safeName(id) {
	return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}
/** Persist one generated audio file. Returns its metadata and public id. */
async function saveAudioFile(data, mime, name) {
	await ensureDir();
	const id = randomUUID();
	const file = `${id}.${mime.split("/")[1]?.replace("mpeg", "mp3") ?? "bin"}`;
	await writeFile(path.join(AUDIO_DATA_DIR, file), data);
	return {
		id,
		file,
		mime,
		bytes: data.byteLength,
		...name === void 0 ? {} : { name }
	};
}
/** Read a persisted audio file by its id/file name. */
async function readAudioFile(file) {
	const safe = safeName(file);
	const full = path.join(AUDIO_DATA_DIR, safe);
	if (!full.startsWith(AUDIO_DATA_DIR)) return void 0;
	try {
		const data = await readFile(full);
		return {
			data,
			mime: mimeFromFile(safe),
			bytes: data.byteLength
		};
	} catch {
		return;
	}
}
function mimeFromFile(file) {
	switch (path.extname(file).toLowerCase()) {
		case ".wav": return "audio/wav";
		case ".mp3": return "audio/mpeg";
		case ".flac": return "audio/flac";
		case ".ogg": return "audio/ogg";
		case ".m4a": return "audio/mp4";
		case ".aac": return "audio/aac";
		case ".aiff": return "audio/aiff";
		default: return "application/octet-stream";
	}
}
async function readHistory() {
	try {
		const text = await readFile(HISTORY_FILE, "utf8");
		const parsed = JSON.parse(text);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
async function writeHistory(entries) {
	await mkdir(path.dirname(HISTORY_FILE), { recursive: true });
	await writeFile(HISTORY_FILE, JSON.stringify(entries, null, 2));
}
/** Append one history entry and enforce the cap. */
async function appendHistory(entry) {
	const list = await readHistory();
	const next = [{
		id: entry.id,
		createdAt: entry.createdAt,
		mode: entry.mode,
		model: entry.model,
		prompt: entry.prompt,
		...entry.voice === void 0 ? {} : { voice: entry.voice },
		...entry.voiceId === void 0 ? {} : { voiceId: entry.voiceId },
		...entry.previewText === void 0 ? {} : { previewText: entry.previewText },
		...entry.speed === void 0 ? {} : { speed: entry.speed },
		...entry.duration === void 0 ? {} : { duration: entry.duration },
		...entry.format === void 0 ? {} : { format: entry.format },
		audio: entry.audio.map((audio) => ({
			url: audio.url,
			mime: audio.mime,
			...audio.duration === void 0 ? {} : { duration: audio.duration },
			...audio.voiceId === void 0 ? {} : { voiceId: audio.voiceId }
		})),
		...entry.channelId === void 0 ? {} : { channelId: entry.channelId },
		...entry.channel === void 0 ? {} : { channel: entry.channel },
		...entry.params === void 0 ? {} : { params: entry.params }
	}, ...list].slice(0, 50);
	await writeHistory(next);
	return next;
}
async function listHistory() {
	return readHistory();
}
async function removeHistory(id) {
	const next = (await readHistory()).filter((entry) => entry.id !== id);
	await writeHistory(next);
	return next;
}
async function clearHistory() {
	await writeHistory([]);
	return [];
}
/** Library type dir names (whitelisted on the audio route too). */
const LIBRARY_TYPE_DIRS = {
	voice: "voice",
	music: "music",
	sfx: "sfx",
	tts: "tts"
};
/** Sanitize one path segment (cid or voice key). Falls back to 'default'. */
function sanitizeSegment(value) {
	const cleaned = value.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 60);
	return cleaned === "" ? "default" : cleaned;
}
/** Infer the category for a save when the client did not provide one. */
function defaultLibraryCategory(type, meta) {
	if (type === "voice") {
		const probe = `${meta.voiceId ?? ""} ${meta.voice ?? ""}`.toLowerCase();
		if (/female|女/.test(probe)) return "female";
		if (/male|男/.test(probe)) return "male";
		return "custom";
	}
	if (type === "tts") return sanitizeSegment(meta.voice ?? meta.voiceId ?? "default");
}
/** Default resource name from the prompt. */
function defaultLibraryName(prompt) {
	const flat = prompt.replace(/\s+/g, " ").trim();
	return flat === "" ? "未命名音频" : flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
}
async function readLibraryIndex() {
	try {
		const text = await readFile(LIBRARY_INDEX_FILE, "utf8");
		const parsed = JSON.parse(text);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isLibraryEntry);
	} catch {
		return [];
	}
}
function isLibraryEntry(value) {
	if (value === null || typeof value !== "object") return false;
	const raw = value;
	return typeof raw.id === "string" && typeof raw.name === "string" && (raw.type === "voice" || raw.type === "music" || raw.type === "sfx" || raw.type === "tts") && Array.isArray(raw.files) && typeof raw.createdAt === "number" && typeof raw.provenance === "object";
}
async function writeLibraryIndex(entries) {
	await mkdir(LIBRARY_DATA_DIR, { recursive: true });
	await writeFile(LIBRARY_INDEX_FILE, JSON.stringify(entries, null, 2));
}
/** Same-origin URL for a library-relative file path. */
function libraryUrlOf(rel) {
	return `${LIBRARY_API.audio}/${rel.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}
/** Merge-library-entry: copy one audio/ file into library/<type>/<category>/. */
async function copyIntoLibrary(input, typeDir, category) {
	const stored = await readAudioFile(input.file);
	if (stored === void 0) throw new Error(`音频文件不存在：${input.file}（请重新生成后再入库）`);
	const ext = path.extname(input.file).replace(".", "") || (stored.mime.split("/")[1]?.replace("mpeg", "mp3") ?? "bin");
	const rel = `${typeDir}/${category}/${input.id}.${ext}`;
	const target = path.join(LIBRARY_DATA_DIR, ...rel.split("/"));
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, stored.data);
	return {
		url: libraryUrlOf(rel),
		rel,
		mime: stored.mime,
		bytes: stored.bytes,
		...input.duration === void 0 ? {} : { duration: input.duration },
		...input.voiceId === void 0 ? {} : { voiceId: input.voiceId }
	};
}
/**
* Save one curated library entry: copies the referenced audio files into
* library/<type>/<category>/ (audio/ files stay untouched) and appends the
* entry to the index.
*/
async function saveToLibrary(input) {
	if (input.audioFiles.length === 0) throw new Error("没有可入库的音频文件");
	const typeDir = LIBRARY_TYPE_DIRS[input.type];
	const category = input.category !== void 0 && input.category.trim() !== "" ? sanitizeSegment(input.category.trim()) : defaultLibraryCategory(input.type, {
		voice: input.provenance.voice,
		voiceId: input.provenance.voiceId ?? input.audioFiles.find((file) => file.voiceId !== void 0)?.voiceId
	}) ?? "default";
	const files = await Promise.all(input.audioFiles.map((file) => copyIntoLibrary(file, typeDir, category)));
	const rawName = (input.name ?? "").trim();
	const entry = {
		id: randomUUID(),
		createdAt: Date.now(),
		type: input.type,
		category: category === "default" && input.type !== "voice" && input.type !== "tts" ? void 0 : category,
		name: rawName === "" ? defaultLibraryName(input.provenance.prompt) : rawName,
		tags: Array.isArray(input.tags) ? [...new Set(input.tags.map((tag) => tag.trim()).filter((tag) => tag !== ""))].slice(0, 20) : [],
		...input.note !== void 0 && input.note.trim() !== "" ? { note: input.note.trim() } : {},
		files,
		provenance: input.provenance
	};
	const entries = await readLibraryIndex();
	entries.unshift(entry);
	await writeLibraryIndex(entries);
	return entry;
}
/** Read library entries (newest first). */
async function listLibrary() {
	return [...await readLibraryIndex()].sort((a, b) => b.createdAt - a.createdAt);
}
/** Move one library-relative file to a new rel path (same volume rename, else copy). */
async function moveLibraryFile(fromRel, toRel) {
	const from = path.join(LIBRARY_DATA_DIR, ...fromRel.split("/"));
	const to = path.join(LIBRARY_DATA_DIR, ...toRel.split("/"));
	await mkdir(path.dirname(to), { recursive: true });
	try {
		await rename(from, to);
	} catch {
		await writeFile(to, await readFile(from));
		await unlink(from);
	}
}
/** Patch name/tags/note/type/category; moving type/category relocates files. */
async function updateLibraryEntry(id, patch) {
	const entries = await readLibraryIndex();
	const index = entries.findIndex((entry) => entry.id === id);
	if (index < 0) return void 0;
	const entry = {
		...entries[index],
		files: [...entries[index].files]
	};
	if (patch.type !== void 0 && LIBRARY_TYPES_VALID.includes(patch.type)) entry.type = patch.type;
	if (patch.name !== void 0) entry.name = patch.name.trim() === "" ? defaultLibraryName(entry.provenance.prompt) : patch.name.trim();
	if (patch.tags !== void 0) entry.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter((tag) => tag !== ""))].slice(0, 20);
	if (patch.note !== void 0) entry.note = patch.note.trim() === "" ? void 0 : patch.note.trim();
	if (patch.category !== void 0 && patch.category.trim() !== "") {
		const next = sanitizeSegment(patch.category.trim());
		if (entry.type === "voice" || entry.type === "tts") entry.category = next;
	}
	const oldCat = entries[index].category ?? "default";
	const newCat = entry.category ?? "default";
	if (entries[index].type !== entry.type || oldCat !== newCat) {
		const moved = [];
		for (const file of entry.files) {
			const fileName = file.rel.split("/").pop() ?? "";
			const fromRel = `${LIBRARY_TYPE_DIRS[entries[index].type]}/${oldCat}/${fileName}`;
			const toRel = `${LIBRARY_TYPE_DIRS[entry.type]}/${newCat}/${fileName}`;
			if (fromRel !== toRel) await moveLibraryFile(fromRel, toRel);
			moved.push({
				...file,
				rel: toRel,
				url: libraryUrlOf(toRel)
			});
		}
		entry.files = moved;
	}
	entries[index] = entry;
	await writeLibraryIndex(entries);
	return entry;
}
/** Remove entries and their audio files; best-effort prune empty dirs. */
async function removeLibraryEntries(ids) {
	const entries = await readLibraryIndex();
	const doomed = new Set(ids);
	const kept = entries.filter((entry) => !doomed.has(entry.id));
	for (const entry of entries) {
		if (!doomed.has(entry.id)) continue;
		for (const file of entry.files) try {
			await unlink(path.join(LIBRARY_DATA_DIR, ...file.rel.split("/")));
		} catch {}
	}
	for (const entry of entries) {
		if (!doomed.has(entry.id)) continue;
		try {
			await rmdir(path.dirname(path.join(LIBRARY_DATA_DIR, ...entry.files[0].rel.split("/"))), { recursive: false });
		} catch {}
	}
	await writeLibraryIndex(kept);
	return kept;
}
/** Read one library file by its rel path (whitelisted, traversal-safe). */
async function readLibraryFile(rel) {
	const segments = rel.split("/").filter((segment) => segment !== "");
	if (segments.length < 2 || segments.length > 3) return void 0;
	const [typeDir, category, fileName] = segments;
	if (typeDir === void 0 || !Object.values(LIBRARY_TYPE_DIRS).includes(typeDir)) return void 0;
	if (category === void 0 || sanitizeSegment(category) !== category || category.length > 60) return void 0;
	if (fileName === void 0 || !/^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(fileName)) return void 0;
	const full = path.join(LIBRARY_DATA_DIR, typeDir, category, fileName);
	if (!full.startsWith(path.join(LIBRARY_DATA_DIR, typeDir, category) + path.sep)) return void 0;
	try {
		const data = await readFile(full);
		return {
			data,
			mime: mimeFromFile(fileName),
			bytes: data.byteLength
		};
	} catch {
		return;
	}
}
const LIBRARY_TYPES_VALID = [
	"voice",
	"music",
	"sfx",
	"tts"
];
//#endregion
//#region src/routes.ts
const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;
/** 宿主侧任务取消注册表：taskId → 该任务当前在途请求的 AbortController 集合。 */
const taskAborts = /* @__PURE__ */ new Map();
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer"
	});
	res.end(payload);
}
async function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > maxBytes) return void 0;
		chunks.push(buffer);
	}
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : void 0;
	} catch {
		return;
	}
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
function parseGenerateRequest(body) {
	const mode = body.mode === "music" ? "music" : body.mode === "sfx" ? "sfx" : body.mode === "voice_design" ? "voice_design" : "tts";
	const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
	if (prompt === "") return void 0;
	const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
	const str = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
	const flag = (value) => typeof value === "boolean" ? value : void 0;
	const tone = Array.isArray(body.pronunciationTone) ? body.pronunciationTone.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : void 0;
	const voiceModifyRaw = body.voiceModify;
	const voiceModify = typeof voiceModifyRaw === "object" && voiceModifyRaw !== null ? {
		...num(voiceModifyRaw.pitch) !== void 0 ? { pitch: num(voiceModifyRaw.pitch) } : {},
		...num(voiceModifyRaw.intensity) !== void 0 ? { intensity: num(voiceModifyRaw.intensity) } : {},
		...num(voiceModifyRaw.timbre) !== void 0 ? { timbre: num(voiceModifyRaw.timbre) } : {},
		...str(voiceModifyRaw.soundEffects) !== void 0 ? { soundEffects: str(voiceModifyRaw.soundEffects) } : {}
	} : void 0;
	const timbreWeights = Array.isArray(body.timbreWeights) ? body.timbreWeights.filter((item) => typeof item === "object" && item !== null && typeof item.voiceId === "string" && typeof item.weight === "number").map((item) => ({
		voiceId: item.voiceId.trim(),
		weight: item.weight
	})).filter((item) => item.voiceId !== "") : void 0;
	return {
		mode,
		model: typeof body.model === "string" ? body.model.trim() : "",
		prompt,
		...typeof body.voice === "string" && body.voice.trim() !== "" ? { voice: body.voice.trim() } : {},
		...typeof body.previewText === "string" && body.previewText.trim() !== "" ? { previewText: body.previewText.trim() } : {},
		...num(body.speed) !== void 0 ? { speed: num(body.speed) } : {},
		...num(body.duration) !== void 0 ? { duration: num(body.duration) } : {},
		...typeof body.lyrics === "string" && body.lyrics.trim() !== "" ? { lyrics: body.lyrics.trim() } : {},
		...typeof body.isInstrumental === "boolean" ? { isInstrumental: body.isInstrumental } : {},
		...typeof body.loop === "boolean" ? { loop: body.loop } : {},
		...num(body.promptInfluence) !== void 0 ? { promptInfluence: num(body.promptInfluence) } : {},
		...num(body.seed) !== void 0 ? { seed: num(body.seed) } : {},
		...num(body.steps) !== void 0 ? { steps: num(body.steps) } : {},
		...num(body.cfgScale) !== void 0 ? { cfgScale: num(body.cfgScale) } : {},
		...typeof body.format === "string" && body.format.trim() !== "" ? { format: body.format.trim() } : {},
		...typeof body.channelId === "string" && body.channelId !== "" ? { channelId: body.channelId } : {},
		...typeof body.taskId === "string" && body.taskId.trim() !== "" ? { taskId: body.taskId.trim() } : {},
		...str(body.emotion) !== void 0 ? { emotion: str(body.emotion) } : {},
		...num(body.vol) !== void 0 ? { vol: num(body.vol) } : {},
		...num(body.pitch) !== void 0 ? { pitch: num(body.pitch) } : {},
		...flag(body.textNormalization) !== void 0 ? { textNormalization: flag(body.textNormalization) } : {},
		...flag(body.latexRead) !== void 0 ? { latexRead: flag(body.latexRead) } : {},
		...tone !== void 0 && tone.length > 0 ? { pronunciationTone: tone } : {},
		...num(body.sampleRate) !== void 0 ? { sampleRate: num(body.sampleRate) } : {},
		...num(body.bitrate) !== void 0 ? { bitrate: num(body.bitrate) } : {},
		...num(body.audioChannel) !== void 0 ? { audioChannel: num(body.audioChannel) } : {},
		...flag(body.forceCbr) !== void 0 ? { forceCbr: flag(body.forceCbr) } : {},
		...flag(body.subtitleEnable) !== void 0 ? { subtitleEnable: flag(body.subtitleEnable) } : {},
		...flag(body.aigcWatermark) !== void 0 ? { aigcWatermark: flag(body.aigcWatermark) } : {},
		...str(body.languageBoost) !== void 0 ? { languageBoost: str(body.languageBoost) } : {},
		...voiceModify !== void 0 ? { voiceModify } : {},
		...timbreWeights !== void 0 && timbreWeights.length > 0 ? { timbreWeights } : {},
		...flag(body.saveToLibrary) !== void 0 ? { saveToLibrary: flag(body.saveToLibrary) } : {}
	};
}
function toView(descriptor) {
	return {
		ns: String(descriptor.ns),
		schema: descriptor.schema,
		value: descriptor.value,
		...descriptor.base === void 0 ? {} : { base: descriptor.base },
		...descriptor.user === void 0 ? {} : { user: descriptor.user },
		...descriptor.secrets === void 0 ? {} : { secrets: descriptor.secrets.map((secret) => ({
			path: [...secret.path],
			set: secret.set
		})) },
		revision: descriptor.revision
	};
}
function failureOf(error) {
	if (error instanceof SettingsConflictError) return {
		ok: false,
		code: "settings-conflict",
		message: error.message
	};
	return {
		ok: false,
		code: "settings-rejected",
		message: error instanceof Error ? error.message : String(error)
	};
}
/**
* Resolve a requested model alias onto a concrete channel/upstream id.
*/
function resolveChannelRequest(request, view) {
	if (view.channels.length === 0) return {
		ok: false,
		code: "no-channels",
		message: "尚未配置任何渠道：请先在「设置 → 插件 → AI 音频」添加渠道并填写 API 地址与密钥"
	};
	const explicit = view.channels.find((candidate) => candidate.id === request.channelId);
	const defaults = view.channels.find((candidate) => candidate.id === view.defaultChannelId) ?? view.channels[0];
	const target = explicit ?? defaults;
	const asked = request.model.trim();
	if (request.mode === "voice_design") {
		if (target === void 0) return {
			ok: false,
			code: "no-channels",
			message: "尚未配置任何渠道"
		};
		return {
			ok: true,
			request: {
				...request,
				model: "",
				upstream: void 0,
				channelId: target.id,
				channel: target.name
			}
		};
	}
	if (asked === "") {
		const alias = target?.models[0]?.alias ?? "";
		if (alias === "") return {
			ok: false,
			code: "no-models",
			message: `渠道「${target?.name ?? ""}」尚未配置模型/音色，请先在设置中添加`
		};
		const mapping = target.models.find((model) => model.alias === alias);
		return {
			ok: true,
			request: {
				...request,
				model: alias,
				upstream: mapping.id,
				channelId: target.id,
				channel: target.name
			}
		};
	}
	const hosting = view.channels.filter((channel) => channel.models.some((model) => model.alias === asked));
	if (hosting.length === 0) return {
		ok: false,
		code: "audio-model-not-configured",
		message: `模型/音色「${asked}」未在任一渠道配置；可用：${[...new Set(view.channels.flatMap((channel) => channel.models.map((model) => model.alias)))].join("、") || "（无）"}`
	};
	const picked = target !== void 0 && target.models.some((model) => model.alias === asked) ? target : hosting[0];
	const mapping = picked.models.find((model) => model.alias === asked);
	return {
		ok: true,
		request: {
			...request,
			model: asked,
			upstream: mapping.id,
			channelId: picked.id,
			channel: picked.name
		}
	};
}
/** Build the library type from a generation mode (voice_design → voice). */
function libraryTypeOf$1(mode) {
	if (mode === "voice_design") return "voice";
	return mode;
}
/** Provenance snapshot straight from a resolved generate request. */
function provenanceOf(request, apiUrl, voiceId) {
	return {
		mode: request.mode,
		prompt: request.prompt,
		...request.channel === void 0 ? {} : { channel: request.channel },
		...request.channelId === void 0 ? {} : { channelId: request.channelId },
		...apiUrl === "" ? {} : { apiUrl },
		...request.model === void 0 || request.model === "" ? {} : { model: request.model },
		...request.upstream === void 0 || request.upstream === "" ? {} : { upstream: request.upstream },
		...request.voice === void 0 ? {} : { voice: request.voice },
		...request.previewText === void 0 ? {} : { previewText: request.previewText },
		...voiceId === void 0 || voiceId === "" ? {} : { voiceId },
		params: { ...request }
	};
}
const strOf = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
const strListOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : void 0;
const parseModeOf = (value) => value === "music" ? "music" : value === "sfx" ? "sfx" : value === "voice_design" ? "voice_design" : "tts";
const parseLibraryTypeOf = (value) => LIBRARY_TYPES.includes(value) ? value : void 0;
/** File name (audio/ id.ext) from a same-origin audio url. */
function historyFileIdOf(url) {
	try {
		return decodeURIComponent(new URL(url, "http://localhost").pathname.split("/").pop() ?? "");
	} catch {
		return "";
	}
}
/**
* Fill missing provenance fields from host-persisted history (which carries
* the resolved request snapshot) and the channel catalog. Client-supplied
* values win when present.
*/
async function mergeLibraryProvenance(given, files, channels) {
	const wanted = new Set(files.map((file) => file.file));
	const entry = (await listHistory()).find((candidate) => candidate.audio.some((audio) => wanted.has(historyFileIdOf(audio.url))));
	const params = entry?.params !== void 0 && typeof entry.params === "object" ? entry.params : void 0;
	const audioRef = entry?.audio.find((audio) => wanted.has(historyFileIdOf(audio.url)));
	const channel = channels.find((candidate) => candidate.id === (entry?.channelId ?? ""));
	return {
		mode: entry?.mode ?? given.mode,
		prompt: given.prompt !== "" ? given.prompt : entry?.prompt ?? "",
		...given.channel !== void 0 || entry?.channel !== void 0 ? { channel: given.channel ?? entry?.channel } : {},
		...given.channelId !== void 0 || entry?.channelId !== void 0 ? { channelId: given.channelId ?? entry?.channelId } : {},
		...(given.apiUrl ?? channel?.apiUrl ?? "") === "" ? {} : { apiUrl: given.apiUrl ?? channel?.apiUrl },
		...given.model !== void 0 || entry?.model !== void 0 ? { model: given.model ?? entry?.model } : {},
		...(given.upstream ?? (typeof params?.upstream === "string" ? params.upstream : void 0)) !== void 0 ? { upstream: given.upstream ?? (typeof params?.upstream === "string" ? params.upstream : void 0) } : {},
		...given.voice !== void 0 || entry?.voice !== void 0 ? { voice: given.voice ?? entry?.voice } : {},
		...given.previewText !== void 0 || entry?.previewText !== void 0 ? { previewText: given.previewText ?? entry?.previewText } : {},
		...given.voiceId !== void 0 || entry?.voiceId !== void 0 || audioRef?.voiceId !== void 0 ? { voiceId: given.voiceId ?? entry?.voiceId ?? audioRef?.voiceId } : {},
		...given.params !== void 0 || params !== void 0 ? { params: given.params ?? params } : {}
	};
}
/** 从请求体解析音色列表/推荐共用的筛选选项。 */
function voiceListOptionsOf(body) {
	const str = (key) => {
		const value = body?.[key];
		return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
	};
	const filters = {
		...str("search") === void 0 ? {} : { search: str("search") },
		...str("use_case") === void 0 ? {} : { use_case: str("use_case") },
		...str("accent") === void 0 ? {} : { accent: str("accent") },
		...str("gender") === void 0 ? {} : { gender: str("gender") },
		...str("age") === void 0 ? {} : { age: str("age") },
		...str("locale") === void 0 ? {} : { locale: str("locale") },
		...str("category") === void 0 ? {} : { category: str("category") },
		...str("sort") === void 0 ? {} : { sort: str("sort") },
		...body?.featured === true ? { featured: true } : {},
		...body?.free_users_allowed === true ? { free_users_allowed: true } : {},
		...body?.descriptive === true ? { descriptive: true } : {}
	};
	return {
		...str("language") === void 0 ? {} : { language: str("language") },
		...str("keyword") === void 0 ? {} : { keyword: str("keyword") },
		...str("source") === void 0 ? {} : { source: str("source") },
		...typeof body?.limit === "number" && Number.isFinite(body.limit) ? { limit: Math.floor(body.limit) } : {},
		...Object.keys(filters).length === 0 ? {} : { serverFilters: filters }
	};
}
/** 推荐记录的筛选条件快照（面板展示用，不含密钥）。 */
function recommendFiltersOf(body) {
	const str = (key) => {
		const value = body?.[key];
		return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
	};
	const out = {};
	for (const key of [
		"language",
		"keyword",
		"source",
		"search",
		"use_case",
		"accent",
		"gender",
		"age",
		"locale",
		"category",
		"sort"
	]) {
		const value = str(key);
		if (value !== void 0) out[key] = value;
	}
	if (body?.featured === true) out.featured = true;
	if (body?.free_users_allowed === true) out.free_users_allowed = true;
	return out;
}
/** Build every /api/dsh-audiogen route. */
function makeRoutes(deps) {
	const guard = (req, res, method) => {
		if (!isLoopbackRequest(req)) {
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return false;
		}
		if (req.method !== method) {
			writeJson(res, 405, { error: `method not allowed: ${req.method}` });
			return false;
		}
		return true;
	};
	/** Resolve the target channel by name/id, falling back to the default one. */
	const channelOf = (view, wanted) => {
		const usable = view.channels.filter((channel) => channel.apiUrl.trim() !== "" && channel.apiKey.trim() !== "");
		if (usable.length === 0) return void 0;
		const name = typeof wanted === "string" ? wanted.trim() : "";
		if (name !== "") {
			const direct = usable.find((channel) => channel.name === name || channel.id === name);
			if (direct !== void 0) return direct;
		}
		return usable.find((channel) => channel.id === view.defaultChannelId) ?? usable[0];
	};
	const audioFileFrom = (rawUrl, basePath) => {
		if (rawUrl === void 0) return void 0;
		let pathname;
		try {
			pathname = new URL(rawUrl, "http://localhost").pathname;
		} catch {
			return;
		}
		if (!pathname.startsWith(`${basePath}/`)) return void 0;
		return decodeURIComponent(pathname.slice(basePath.length + 1));
	};
	return [
		{
			kind: "exact",
			path: PRESETS_API,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				writeJson(res, 200, {
					ok: true,
					presets: AUDIO_PRESETS
				});
			}
		},
		{
			kind: "exact",
			path: LLM_MODELS_API,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				try {
					writeJson(res, 200, {
						ok: true,
						providers: await deps.llmModelOptions()
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: "llm-models-failed",
						message: messageOf(error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: MODEL_API.discover,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const view = deps.resolveChannels();
				const stored = view.channels.find((candidate) => candidate.id === (typeof body?.channelId === "string" ? body.channelId : void 0)) ?? view.channels.find((candidate) => candidate.id === view.defaultChannelId) ?? view.channels[0];
				const channel = {
					id: stored?.id ?? "preview",
					preset: typeof body?.preset === "string" ? body.preset.trim() : stored?.preset ?? "",
					name: stored?.name ?? "",
					apiUrl: typeof body?.apiUrl === "string" && body.apiUrl.trim() !== "" ? body.apiUrl.trim() : stored?.apiUrl ?? "",
					apiKey: typeof body?.apiKey === "string" && body.apiKey.trim() !== "" ? body.apiKey.trim() : stored?.apiKey ?? "",
					models: stored?.models ?? []
				};
				try {
					writeJson(res, 200, {
						ok: true,
						...await discoverAudioModels(channel)
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: "model-discovery-failed",
						message: messageOf(error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: VOICES_API.list,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const channel = channelOf(deps.resolveChannels(), body?.channel);
				if (channel === void 0) {
					writeJson(res, 200, {
						ok: false,
						code: "channel-not-configured",
						message: "没有可用的音频渠道（需要已配置 API 地址与密钥），请先在设置中添加。"
					});
					return;
				}
				try {
					const result = await listVendorVoicesWithFallback(channel, voiceListOptionsOf(body));
					writeJson(res, 200, {
						ok: true,
						vendor: result.vendor,
						channel: channel.name,
						voices: result.voices,
						truncated: result.truncated,
						...result.note === void 0 ? {} : { note: result.note }
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: "voice-list-failed",
						message: messageOf(error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: VOICES_API.delete,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const channel = channelOf(deps.resolveChannels(), body?.channel);
				if (channel === void 0) {
					writeJson(res, 200, {
						ok: false,
						code: "channel-not-configured",
						message: "没有可用的音频渠道（需要已配置 API 地址与密钥），请先在设置中添加。"
					});
					return;
				}
				const voiceId = typeof body?.voice_id === "string" ? body.voice_id.trim() : "";
				if (voiceId === "") {
					writeJson(res, 200, {
						ok: false,
						code: "voice-id-required",
						message: "voice_id 不能为空。"
					});
					return;
				}
				if (body?.confirm !== true) {
					writeJson(res, 200, {
						ok: false,
						code: "voice-delete-requires-confirm",
						message: "删除不可逆：请确认勾选后再执行。"
					});
					return;
				}
				try {
					writeJson(res, 200, {
						ok: true,
						...await deleteVendorVoice(channel, voiceId)
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: "voice-delete-failed",
						message: messageOf(error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: VOICES_API.recommend,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const requirement = typeof body?.requirement === "string" ? body.requirement.trim() : "";
				if (requirement === "") {
					writeJson(res, 200, {
						ok: false,
						code: "recommend-requirement-required",
						message: "需求描述（requirement）不能为空。"
					});
					return;
				}
				const channel = channelOf(deps.resolveChannels(), body?.channel);
				if (channel === void 0) {
					writeJson(res, 200, {
						ok: false,
						code: "channel-not-configured",
						message: "没有可用的音频渠道（需要已配置 API 地址与密钥），请先在设置中添加。"
					});
					return;
				}
				const rawTopK = body?.top_k;
				const topK = typeof rawTopK === "number" && Number.isFinite(rawTopK) ? Math.max(1, Math.min(10, Math.floor(rawTopK))) : 5;
				try {
					const result = await listVendorVoicesWithFallback(channel, {
						...voiceListOptionsOf(body),
						limit: 500
					});
					const recommendations = await deps.recommend(requirement, result.voices, topK);
					appendVoiceRecommendRecord({
						channel: channel.name,
						vendor: result.vendor,
						requirement,
						candidate_count: result.voices.length,
						top_k: topK,
						channel_id: channel.id,
						filters: recommendFiltersOf(body),
						recommendations: recommendations.map((item) => ({
							voice_id: item.voice_id,
							name: item.name,
							source: item.source,
							deletable: item.deletable,
							...item.language === void 0 ? {} : { language: item.language },
							...item.locale === void 0 ? {} : { locale: item.locale },
							...item.accent === void 0 ? {} : { accent: item.accent },
							...item.gender === void 0 ? {} : { gender: item.gender },
							...item.age === void 0 ? {} : { age: item.age },
							...item.use_case === void 0 ? {} : { use_case: item.use_case },
							...item.category === void 0 ? {} : { category: item.category },
							...item.labels === void 0 ? {} : { labels: item.labels },
							...item.descriptive === void 0 ? {} : { descriptive: item.descriptive },
							...item.description === void 0 ? {} : { description: item.description },
							...item.preview_url === void 0 ? {} : { preview_url: item.preview_url },
							reason: item.reason
						}))
					}).catch(() => {});
					writeJson(res, 200, {
						ok: true,
						vendor: result.vendor,
						channel: channel.name,
						requirement,
						candidate_count: result.voices.length,
						top_k: topK,
						recommendations,
						recorded: true,
						...result.note === void 0 ? {} : { note: result.note }
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: "voice-recommend-failed",
						message: messageOf(error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: VOICES_API.recommendHistory.list,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const rawLimit = (await readJsonBody(req))?.limit;
				const entries = await listVoiceRecommendRecords(typeof rawLimit === "number" && Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.floor(rawLimit))) : 20);
				writeJson(res, 200, {
					ok: true,
					count: entries.length,
					entries
				});
			}
		},
		{
			kind: "exact",
			path: VOICES_API.recommendHistory.remove,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const id = typeof body?.id === "string" ? body.id.trim() : "";
				if (id === "") {
					writeJson(res, 200, {
						ok: false,
						code: "record-id-required",
						message: "record id 不能为空。"
					});
					return;
				}
				try {
					await removeVoiceRecommendRecord(id);
					writeJson(res, 200, {
						ok: true,
						removed: id
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: "record-remove-failed",
						message: messageOf(error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: SETTINGS_API.describe,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const descriptor = deps.settings.describe({ redactSecrets: true }).find((candidate) => String(candidate.ns) === AUDIOGEN_SETTINGS_NAMESPACE);
				writeJson(res, 200, {
					ok: true,
					value: {
						namespaces: descriptor === void 0 ? [] : [toView(descriptor)],
						writable: deps.settings.writable !== false
					}
				});
			}
		},
		{
			kind: "exact",
			path: SETTINGS_API.mutate,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				if (body === void 0) {
					writeJson(res, 200, {
						ok: false,
						code: "settings-rejected",
						message: "unreadable JSON body"
					});
					return;
				}
				const ns = typeof body.ns === "string" ? body.ns : "";
				if (ns !== "dsh-audiogen" || !Array.isArray(body.ops)) {
					writeJson(res, 200, {
						ok: false,
						code: "settings-rejected",
						message: "malformed bridge settings request"
					});
					return;
				}
				const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : void 0;
				try {
					await deps.settings.mutate(ns, body.ops, expectedRevision);
				} catch (error) {
					writeJson(res, 200, failureOf(error));
					return;
				}
				const descriptor = deps.settings.describe({ redactSecrets: true }).find((candidate) => String(candidate.ns) === ns);
				if (descriptor === void 0) {
					writeJson(res, 200, {
						ok: false,
						code: "internal",
						message: `settings namespace "${ns}" was disposed after the mutate`
					});
					return;
				}
				writeJson(res, 200, {
					ok: true,
					value: toView(descriptor)
				});
			}
		},
		{
			kind: "exact",
			path: GENERATE_API,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const parsed = body === void 0 ? void 0 : parseGenerateRequest(body);
				if (parsed === void 0) {
					writeJson(res, 200, {
						ok: false,
						code: "bad-request",
						message: "prompt/text is required"
					});
					return;
				}
				const view = deps.resolveChannels();
				const resolved = resolveChannelRequest(parsed, view);
				if (!resolved.ok) {
					writeJson(res, 200, {
						ok: false,
						code: resolved.code,
						message: resolved.message
					});
					return;
				}
				const request = resolved.request;
				const channel = view.channels.find((candidate) => candidate.id === request.channelId);
				const taskId = typeof body?.taskId === "string" && body.taskId.trim() !== "" ? body.taskId.trim() : "";
				const controller = new AbortController();
				if (taskId !== "") {
					const set = taskAborts.get(taskId) ?? /* @__PURE__ */ new Set();
					set.add(controller);
					taskAborts.set(taskId, set);
				}
				try {
					const release = await deps.budget.acquire(controller.signal);
					let outputs;
					try {
						outputs = await generateAudio(channel, request, controller.signal);
					} finally {
						release();
					}
					const generated = [];
					for (const [index, output] of outputs.entries()) {
						const saved = await saveAudioFile(output.data, output.mime, `generated-${index + 1}`);
						generated.push({
							id: saved.id,
							file: saved.file,
							b64: Buffer.from(output.data).toString("base64"),
							mime: saved.mime,
							bytes: saved.bytes,
							url: `${AUDIO_API.file}/${encodeURIComponent(saved.file)}`,
							...output.voiceId === void 0 ? {} : { voiceId: output.voiceId }
						});
					}
					const paramsSnapshot = { ...request };
					let history;
					try {
						history = await appendHistory({
							id: randomUUID(),
							createdAt: Date.now(),
							mode: request.mode,
							model: request.model,
							prompt: request.prompt,
							...request.voice === void 0 ? {} : { voice: request.voice },
							...request.previewText === void 0 ? {} : { previewText: request.previewText },
							...request.speed === void 0 ? {} : { speed: request.speed },
							...request.duration === void 0 ? {} : { duration: request.duration },
							...request.format === void 0 ? {} : { format: request.format },
							audio: generated,
							...request.channelId === void 0 ? {} : { channelId: request.channelId },
							...request.channel === void 0 ? {} : { channel: request.channel },
							params: paramsSnapshot
						});
					} catch (error) {
						writeJson(res, 200, {
							ok: true,
							outputs: generated,
							historyError: messageOf(error)
						});
						return;
					}
					const wantSave = request.saveToLibrary === true || deps.autoSave() && request.saveToLibrary !== false;
					let resources;
					if (wantSave) try {
						const entry = await saveToLibrary({
							audioFiles: generated.map((audio) => ({
								id: audio.id,
								file: audio.file,
								mime: audio.mime,
								...audio.voiceId === void 0 ? {} : { voiceId: audio.voiceId }
							})),
							type: libraryTypeOf$1(request.mode),
							provenance: provenanceOf(request, channel.apiUrl, generated[0]?.voiceId)
						});
						resources = [{
							id: entry.id,
							name: entry.name,
							type: entry.type
						}];
					} catch {}
					const note = request.mode === "music" && request.isInstrumental !== true && (request.lyrics === void 0 || request.lyrics.trim() === "") ? "未提供歌词，已按纯音乐生成" : void 0;
					writeJson(res, 200, {
						ok: true,
						outputs: generated,
						history,
						...resources === void 0 ? {} : { resources },
						...note === void 0 ? {} : { note }
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: error instanceof AudioGenError ? error.code : "generate-failed",
						message: messageOf(error)
					});
				} finally {
					if (taskId !== "") {
						const set = taskAborts.get(taskId);
						set?.delete(controller);
						if (set !== void 0 && set.size === 0) taskAborts.delete(taskId);
					}
				}
			}
		},
		{
			kind: "exact",
			path: TASK_API.cancel,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const taskId = typeof body?.taskId === "string" ? body.taskId.trim() : "";
				if (taskId === "") {
					writeJson(res, 200, {
						ok: false,
						code: "bad-request",
						message: "taskId is required"
					});
					return;
				}
				const controllers = taskAborts.get(taskId);
				if (controllers !== void 0) {
					for (const controller of controllers) controller.abort();
					taskAborts.delete(taskId);
				}
				writeJson(res, 200, {
					ok: true,
					aborted: controllers !== void 0 ? controllers.size : 0
				});
			}
		},
		{
			kind: "exact",
			path: ENHANCE_API,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
				if (prompt === "") {
					writeJson(res, 200, {
						ok: false,
						code: "bad-request",
						message: "prompt is required"
					});
					return;
				}
				const mode = body?.mode === "music" ? "music" : body?.mode === "sfx" ? "sfx" : body?.mode === "voice_design" ? "voice_design" : "tts";
				try {
					writeJson(res, 200, {
						ok: true,
						enhanced: await deps.enhance(prompt, mode)
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: "enhance-failed",
						message: messageOf(error)
					});
				}
			}
		},
		{
			kind: "prefix",
			path: AUDIO_API.file,
			handler: async (req, res) => {
				if (!isLoopbackRequest(req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "GET") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const file = audioFileFrom(req.url, AUDIO_API.file);
				if (file === void 0) {
					writeJson(res, 400, { error: "invalid audio file" });
					return;
				}
				const stored = await readAudioFile(file);
				if (stored === void 0) {
					writeJson(res, 404, { error: "audio not found" });
					return;
				}
				res.writeHead(200, {
					"content-type": stored.mime,
					"content-length": stored.bytes,
					"cache-control": "private, max-age=3600"
				});
				res.end(stored.data);
			}
		},
		{
			kind: "exact",
			path: LIBRARY_API.list,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				writeJson(res, 200, {
					ok: true,
					entries: await listLibrary()
				});
			}
		},
		{
			kind: "exact",
			path: LIBRARY_API.save,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const audioFiles = Array.isArray(body?.audioFiles) ? body.audioFiles.filter((item) => typeof item === "object" && item !== null).map((item) => ({
					id: strOf(item.id) ?? "",
					file: strOf(item.file) ?? "",
					mime: strOf(item.mime) ?? "audio/mpeg",
					...strOf(item.voiceId) !== void 0 ? { voiceId: strOf(item.voiceId) } : {},
					...typeof item.duration === "number" && Number.isFinite(item.duration) ? { duration: item.duration } : {}
				})).filter((item) => item.id !== "" && item.file !== "") : [];
				if (audioFiles.length === 0) {
					writeJson(res, 200, {
						ok: false,
						code: "bad-request",
						message: "没有可入库的音频文件"
					});
					return;
				}
				const type = parseLibraryTypeOf(body?.type);
				if (type === void 0) {
					writeJson(res, 200, {
						ok: false,
						code: "bad-request",
						message: "资源类型无效（voice/music/sfx/tts）"
					});
					return;
				}
				const rawProvenance = typeof body?.provenance === "object" && body.provenance !== null ? body.provenance : {};
				const provenance = await mergeLibraryProvenance({
					mode: parseModeOf(rawProvenance.mode),
					prompt: typeof rawProvenance.prompt === "string" ? rawProvenance.prompt.trim() : "",
					...strOf(rawProvenance.channel) !== void 0 ? { channel: strOf(rawProvenance.channel) } : {},
					...strOf(rawProvenance.channelId) !== void 0 ? { channelId: strOf(rawProvenance.channelId) } : {},
					...strOf(rawProvenance.apiUrl) !== void 0 ? { apiUrl: strOf(rawProvenance.apiUrl) } : {},
					...strOf(rawProvenance.model) !== void 0 ? { model: strOf(rawProvenance.model) } : {},
					...strOf(rawProvenance.upstream) !== void 0 ? { upstream: strOf(rawProvenance.upstream) } : {},
					...strOf(rawProvenance.voice) !== void 0 ? { voice: strOf(rawProvenance.voice) } : {},
					...strOf(rawProvenance.previewText) !== void 0 ? { previewText: strOf(rawProvenance.previewText) } : {},
					...strOf(rawProvenance.voiceId) !== void 0 ? { voiceId: strOf(rawProvenance.voiceId) } : {},
					...typeof rawProvenance.params === "object" && rawProvenance.params !== null ? { params: rawProvenance.params } : {}
				}, audioFiles, deps.resolveChannels().channels);
				try {
					writeJson(res, 200, {
						ok: true,
						entry: await saveToLibrary({
							audioFiles,
							type,
							...strOf(body?.category) !== void 0 ? { category: strOf(body?.category) } : {},
							...strOf(body?.name) !== void 0 ? { name: strOf(body?.name) } : {},
							...strListOf(body?.tags) !== void 0 ? { tags: strListOf(body?.tags) } : {},
							...strOf(body?.note) !== void 0 ? { note: strOf(body?.note) } : {},
							provenance
						})
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: "library-save-failed",
						message: messageOf(error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: LIBRARY_API.update,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const id = strOf(body?.id);
				if (id === void 0) {
					writeJson(res, 200, {
						ok: false,
						code: "bad-request",
						message: "缺少资源 id"
					});
					return;
				}
				try {
					const entry = await updateLibraryEntry(id, {
						...strOf(body?.name) !== void 0 ? { name: strOf(body?.name) } : {},
						...strListOf(body?.tags) !== void 0 ? { tags: strListOf(body?.tags) } : {},
						...typeof body?.note === "string" ? { note: body.note } : {},
						...strOf(body?.category) !== void 0 ? { category: strOf(body?.category) } : {},
						...parseLibraryTypeOf(body?.type) !== void 0 ? { type: parseLibraryTypeOf(body?.type) } : {}
					});
					if (entry === void 0) {
						writeJson(res, 200, {
							ok: false,
							code: "not-found",
							message: "资源不存在"
						});
						return;
					}
					writeJson(res, 200, {
						ok: true,
						entry
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: "library-update-failed",
						message: messageOf(error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: LIBRARY_API.remove,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const ids = strListOf(body?.ids) ?? [];
				if (ids.length === 0) {
					writeJson(res, 200, {
						ok: false,
						code: "bad-request",
						message: "缺少资源 id"
					});
					return;
				}
				try {
					writeJson(res, 200, {
						ok: true,
						entries: await removeLibraryEntries(ids)
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: "library-remove-failed",
						message: messageOf(error)
					});
				}
			}
		},
		{
			kind: "prefix",
			path: LIBRARY_API.audio,
			handler: async (req, res) => {
				if (!isLoopbackRequest(req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "GET") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const rel = audioFileFrom(req.url, LIBRARY_API.audio);
				if (rel === void 0) {
					writeJson(res, 400, { error: "invalid library audio" });
					return;
				}
				const stored = await readLibraryFile(rel);
				if (stored === void 0) {
					writeJson(res, 404, { error: "library audio not found" });
					return;
				}
				res.writeHead(200, {
					"content-type": stored.mime,
					"content-length": stored.bytes,
					"cache-control": "private, max-age=3600"
				});
				res.end(stored.data);
			}
		},
		{
			kind: "exact",
			path: HISTORY_API.list,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				writeJson(res, 200, {
					ok: true,
					history: await listHistory()
				});
			}
		},
		{
			kind: "exact",
			path: HISTORY_API.clear,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				writeJson(res, 200, {
					ok: true,
					history: await clearHistory()
				});
			}
		},
		{
			kind: "exact",
			path: HISTORY_API.remove,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				writeJson(res, 200, {
					ok: true,
					history: await removeHistory(typeof body?.id === "string" ? body.id : "")
				});
			}
		},
		{
			kind: "prefix",
			path: HISTORY_API.audio,
			handler: async (req, res) => {
				if (!isLoopbackRequest(req)) {
					writeJson(res, 403, { error: "forbidden: loopback-only" });
					return;
				}
				if (req.method !== "GET") {
					writeJson(res, 405, { error: `method not allowed: ${req.method}` });
					return;
				}
				const file = audioFileFrom(req.url, HISTORY_API.audio);
				if (file === void 0) {
					writeJson(res, 400, { error: "invalid audio file" });
					return;
				}
				const stored = await readAudioFile(file);
				if (stored === void 0) {
					writeJson(res, 404, { error: "audio not found" });
					return;
				}
				res.writeHead(200, {
					"content-type": stored.mime,
					"content-length": stored.bytes,
					"cache-control": "private, max-age=3600"
				});
				res.end(stored.data);
			}
		}
	];
}
//#endregion
//#region src/voice-cast.ts
/**
* 角色音色选角（voice casting）：把「角色画像 → 候选音色 → 主音色 + 备用音色」
* 流水线落到插件里，等价于 standalone 音频工作室里 MiniMax/ElevenLabs 的选角逻辑。
*
* 分工（重要）：
*  - 本模块只做确定性的事：角色画像归一化、硬过滤（gender/age/use_case 严格，
*    accent 可放松）、投票校验（voice_id 必须属于该角色候选池、备份补齐、
*    lead/major 主音色不重复）、选定记录持久化。
*  - 「选谁」的推理/全局权衡由 Agent（DeepSeek Harness 当前模型）完成：
*    action=cast 拿到每个角色的候选列表后，Agent 在上下文中统一选角，
*    再把结果交给 action=save_cast 校验落盘。这样既防幻觉（工具校验），
*    又保留整组阵容的全局视野（Agent 推理）。
*
* 与 audio_studio_standalone 的对应关系：
*  - 输入结构  = tts/tools/build_character_adapter_input.py 的角色画像（主字段一致）
*  - 硬过滤    = elevenlabs/voice-selection/tools/elevenlabs_voice_selection.py
*                _map_gender / _map_age_filter / _filter_candidates_with_fallback
*  - 校验      = _validate_voice_selection_plan（成员校验 + 备份补齐 + 复用检查）
*/
const MAX_CANDIDATES_PER_CHARACTER = 60;
const MAX_SAMPLE_LINES = 3;
const MAX_DESCRIPTION_CHARS = 400;
const BACKUP_LIMIT = 2;
const LEAD_DIALOGUE_COUNT = 200;
const MAJOR_DIALOGUE_COUNT = 50;
/** 性状拆分：与 standalone 的 TRAIT_SPLIT_RE 一致。 */
const TRAIT_SPLIT_RE = /[；;、,，/|]+/;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number") return String(value);
	return "";
}
function asStringList(value) {
	if (Array.isArray(value)) return value.map((item) => asString(item)).filter((item) => item !== "");
	const text = asString(value);
	return text === "" ? [] : [text];
}
function splitTraits(value) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const raw of asStringList(value)) for (const part of raw.split(TRAIT_SPLIT_RE)) {
		const item = part.trim();
		if (item !== "" && !seen.has(item)) {
			seen.add(item);
			out.push(item);
		}
	}
	return out;
}
function asNumber(value) {
	const text = asString(value);
	if (text === "") return void 0;
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : void 0;
}
/** 从角色名生成稳定的 character_id（缺省时自动补，与上游 char_u<hex> 风格一致）。 */
function slugifyCharacterId(characterName, fallback) {
	let slug = "";
	for (const char of characterName.toLowerCase()) if (/[a-z0-9]/.test(char)) slug += char;
	else if (char === "-" || char === "_") slug += "_";
	else if (char.trim() !== "") slug += `${slug.endsWith("_") || slug === "" ? "" : "_"}u${char.codePointAt(0).toString(16)}`;
	slug = slug.split("_").filter((part) => part !== "").join("_") || fallback;
	return `char_${slug}`;
}
function importanceTier(dialogueCount, explicit) {
	if (explicit === "lead" || explicit === "major" || explicit === "supporting") return explicit;
	if (dialogueCount >= LEAD_DIALOGUE_COUNT) return "lead";
	if (dialogueCount >= MAJOR_DIALOGUE_COUNT) return "major";
	return "supporting";
}
/** 接受 JSON 数组 / 单个对象 / {characters: [...]} / JSON 字符串 → 角色剖面。 */
function parseCharacterProfiles(input) {
	let value = input;
	if (typeof value === "string") {
		const text = value.trim();
		if (text === "") throw new AudioGenError("characters 不能为空：请传入角色画像 JSON（数组或单个对象）或 JSON 字符串", "cast-characters-empty");
		try {
			value = JSON.parse(text);
		} catch {
			throw new AudioGenError("characters 无法解析为 JSON：请先把角色信息整理成类似 [{\"character_id\": \"char_xxx\", \"character_name\": \"名字\", \"gender\": \"女性\", \"age_stage\": \"少女\", \"voice_traits\": [\"清亮\"], \"personality_traits\": [\"活泼\"], \"appearance\": [\"…\"], \"dialogue_count\": 12}] 的结构再调用", "cast-characters-parse-failed");
		}
	}
	let list;
	if (Array.isArray(value)) list = value;
	else if (isRecord(value)) {
		const inner = value.characters ?? value.classified_characters;
		if (Array.isArray(inner)) list = inner;
		else list = [value];
	} else throw new AudioGenError("characters 必须是 JSON 数组、单个对象或 JSON 字符串", "cast-characters-invalid");
	const profiles = [];
	const missingNames = [];
	list.forEach((item, index) => {
		if (!isRecord(item)) {
			missingNames.push(`characters[${index}] 不是对象`);
			return;
		}
		const characterName = asString(item.character_name) || asString(item.name);
		if (characterName === "") {
			missingNames.push(`characters[${index}] 缺少 character_name`);
			return;
		}
		const characterId = asString(item.character_id) || slugifyCharacterId(characterName, `r${index}`);
		const sampleLines = (Array.isArray(item.sample_lines) ? item.sample_lines : typeof item.sample_lines === "string" ? item.sample_lines.split(/\n+/).map((line) => ({
			text: line.trim(),
			emotion_hint: ""
		})) : []).filter((entry) => typeof entry === "string" || isRecord(entry)).filter((entry) => {
			return (typeof entry === "string" ? entry.trim() : asString(entry.text) || asString(entry.dialogue)) !== "";
		}).slice(0, MAX_SAMPLE_LINES).map((entry) => {
			const text = typeof entry === "string" ? entry.trim() : asString(entry.text) || asString(entry.dialogue);
			const emotion = typeof entry === "string" ? "" : asString(entry.emotion_hint) || asString(entry.emotion);
			return {
				text,
				...emotion === "" ? {} : { emotion_hint: emotion }
			};
		});
		profiles.push({
			character_id: characterId,
			character_name: characterName,
			gender: asString(item.gender) || void 0,
			age_stage: asStringList(item.age_stage ?? item.age),
			...asString(item.age_stage_source) === "" ? {} : { age_stage_source: asString(item.age_stage_source) },
			voice_traits: splitTraits(item.voice_traits),
			personality_traits: splitTraits(item.personality_traits),
			appearance: asStringList(item.appearance),
			sample_lines: sampleLines,
			dialogue_count: asNumber(item.dialogue_count),
			importance_tier: asString(item.importance_tier) || asString(item.tier) || void 0,
			...asString(item.language) === "" ? {} : { language: asString(item.language) },
			...asString(item.use_case) === "" ? {} : { use_case: asString(item.use_case) }
		});
	});
	if (missingNames.length > 0) throw new AudioGenError(`characters 数据不完整：${missingNames.slice(0, 5).join("；")}（请为每个角色提供 character_name）`, "cast-character-missing-name");
	if (profiles.length === 0) throw new AudioGenError("characters 为空：请传入至少一个角色画像", "cast-characters-empty");
	return profiles;
}
/** 性别归一：女/female → female；男/male → male；其余 undefined（不过滤）。 */
function mapGender(text) {
	const value = (text ?? "").toLowerCase();
	if (value === "") return void 0;
	if (value.includes("女") || value.includes("female")) return "female";
	if (value.includes("男") || value.includes("male")) return "male";
}
/** 年龄段归一：老/老年→old；中年→middle_aged；少年/少女/青年/成年→young。 */
function mapAgeFilter(ageStages) {
	const text = (ageStages ?? []).join(" ");
	if (text.trim() === "") return [];
	if (text.includes("老") || text.includes("老年")) return ["old"];
	if (text.includes("中年") || text.includes("middle")) return ["middle_aged"];
	if (text.includes("少年") || text.includes("少女") || text.includes("少男") || text.includes("儿童") || text.includes("幼年") || text.includes("teen") || text.includes("child") || text.includes("young")) return ["young"];
	if (text.includes("青年") || text.includes("年轻") || text.includes("成年") || text.includes("youth") || text.includes("adult")) return ["young"];
	return [];
}
/** 一个角色对候选池的硬过滤（gender/age/use_case 严格，accent 可放松）。 */
function filterCandidatesWithFallback(pool, options) {
	const gender = options.gender;
	const ages = options.ages ?? [];
	const accent = options.accent;
	const useCase = options.use_case;
	const language = options.language;
	const matches = (voice, checkAccent) => {
		if (gender !== void 0 && (voice.gender ?? "").toLowerCase() !== gender.toLowerCase()) return false;
		if (ages.length > 0 && !ages.includes((voice.age ?? "").toLowerCase())) return false;
		if (language !== void 0 && !languageMatchesEntry(voice, language)) return false;
		if (useCase !== void 0 && useCase !== "" && (voice.use_case ?? "").toLowerCase() !== useCase.toLowerCase()) return false;
		if (checkAccent && accent !== void 0 && accent !== "" && (voice.accent ?? "").toLowerCase() !== accent.toLowerCase()) return false;
		return true;
	};
	const strict = pool.filter((voice) => matches(voice, true));
	const applied = [];
	if (gender !== void 0) applied.push(`gender=${gender}`);
	if (ages.length > 0) applied.push(`age=${ages.join("/")}`);
	if (useCase !== void 0 && useCase !== "") applied.push(`use_case=${useCase}`);
	if (accent !== void 0 && accent !== "") applied.push("accent");
	if (language !== void 0 && language !== "") applied.push(`language=${language}`);
	const appliedText = applied.join("+") === "" ? "none" : applied.join("+");
	if (strict.length > 0) return {
		candidates: strict,
		relaxedAccent: false,
		notes: `candidate_filter=${appliedText}`
	};
	const relaxed = pool.filter((voice) => matches(voice, false));
	if (relaxed.length > 0) return {
		candidates: relaxed,
		relaxedAccent: true,
		notes: `candidate_filter=${appliedText}；accent 已放松`
	};
	return {
		candidates: [],
		relaxedAccent: false,
		notes: "candidate_filter=empty；严格过滤后无候选（可放宽 use_case 或换渠道）"
	};
}
function languageMatchesEntry(voice, needle) {
	const haystack = [
		voice.language ?? "",
		voice.locale ?? "",
		voice.name ?? ""
	].join(" ").toLowerCase();
	const value = needle.trim().toLowerCase();
	if (value === "") return true;
	if (haystack.includes(value)) return true;
	for (const alias of {
		zh: [
			"zh",
			"chinese",
			"mandarin",
			"cantonese"
		],
		en: ["en", "english"],
		ja: ["ja", "japanese"],
		ko: ["ko", "korean"],
		es: ["es", "spanish"],
		fr: ["fr", "french"],
		de: ["de", "german"],
		ru: ["ru", "russian"],
		it: ["it", "italian"],
		pt: ["pt", "portuguese"],
		ar: ["ar", "arabic"],
		hi: ["hi", "hindi"]
	}[value] ?? []) if (haystack.includes(alias)) return true;
	return false;
}
function toSlimVoice(voice) {
	const trimmed = voice.description !== void 0 && voice.description.length > MAX_DESCRIPTION_CHARS ? `${voice.description.slice(0, MAX_DESCRIPTION_CHARS - 1)}…` : voice.description;
	return {
		voice_id: voice.voice_id,
		name: voice.name,
		source: voice.source,
		deletable: voice.deletable,
		...voice.language === void 0 ? {} : { language: voice.language },
		...voice.locale === void 0 ? {} : { locale: voice.locale },
		...voice.accent === void 0 ? {} : { accent: voice.accent },
		...voice.gender === void 0 ? {} : { gender: voice.gender },
		...voice.age === void 0 ? {} : { age: voice.age },
		...voice.use_case === void 0 ? {} : { use_case: voice.use_case },
		...voice.category === void 0 ? {} : { category: voice.category },
		...voice.labels === void 0 ? {} : { labels: voice.labels },
		...voice.descriptive === void 0 ? {} : { descriptive: voice.descriptive },
		...trimmed === void 0 ? {} : { description: trimmed },
		...voice.preview_url === void 0 ? {} : { preview_url: voice.preview_url }
	};
}
async function fetchPool(channel, options) {
	if (channel.apiUrl.trim() === "") throw new AudioGenError("渠道未配置 API 地址", "audio-api-not-configured");
	if (channel.apiKey.trim() === "") throw new AudioGenError("渠道未配置 API 密钥", "audio-api-not-configured");
	const useCase = options.use_case !== void 0 && options.use_case !== "" ? options.use_case : void 0;
	const result = await listVendorVoicesWithFallback(channel, {
		limit: 500,
		...options.language !== void 0 && options.language !== "" ? { language: options.language } : {},
		...useCase === void 0 ? {} : { serverFilters: { use_case: useCase } }
	});
	return {
		vendor: result.vendor,
		pool: result.voices,
		...result.note === void 0 ? {} : { note: result.note }
	};
}
/** action=cast：角色画像 → 每个角色的硬过滤候选列表（不选角色，不调 LLM）。 */
async function prepareVoiceCast(channel, profiles, options = {}) {
	const { vendor, pool, note } = await fetchPool(channel, options);
	const fallbackPool = pool.some((entry) => entry.source === "configured");
	const hasMetadata = vendor !== "minimax" && !fallbackPool;
	const views = [];
	for (const profile of profiles) {
		const gender = hasMetadata ? mapGender(profile.gender) : void 0;
		const ages = hasMetadata ? mapAgeFilter(profile.age_stage) : [];
		const language = hasMetadata ? profile.language ?? options.language : void 0;
		const useCase = hasMetadata ? profile.use_case ?? options.use_case : void 0;
		const accent = hasMetadata ? options.accent : void 0;
		const dialogueCount = profile.dialogue_count ?? 0;
		const tier = importanceTier(dialogueCount, profile.importance_tier);
		const filtered = filterCandidatesWithFallback(pool, {
			...gender === void 0 ? {} : { gender },
			...ages.length > 0 ? { ages } : {},
			...accent === void 0 || accent === "" ? {} : { accent },
			...useCase === void 0 || useCase === "" ? {} : { use_case: useCase },
			...language === void 0 || language === "" ? {} : { language }
		});
		const candidates = filtered.candidates.slice(0, MAX_CANDIDATES_PER_CHARACTER);
		const mapped = {
			...gender === void 0 ? {} : { gender },
			...ages.length > 0 ? { age: ages } : {},
			...accent === void 0 || accent === "" ? {} : { accent },
			...useCase === void 0 || useCase === "" ? {} : { use_case: useCase },
			...language === void 0 || language === "" ? {} : { language },
			notes: `age_stage=${(profile.age_stage ?? []).join("/") || "unknown"}; ${filtered.notes}${vendor === "minimax" ? "；MiniMax 音色无性别/年龄/用途元数据，实际仅按语言与名称/描述筛选" : ""}`
		};
		const slim = {
			character_id: profile.character_id,
			character_name: profile.character_name,
			dialogue_count: dialogueCount,
			importance_tier: tier
		};
		if (profile.gender !== void 0) slim.gender = profile.gender;
		if ((profile.age_stage ?? []).length > 0) slim.age_stage = profile.age_stage;
		if (profile.age_stage_source !== void 0) slim.age_stage_source = profile.age_stage_source;
		if ((profile.voice_traits ?? []).length > 0) slim.voice_traits = profile.voice_traits;
		if ((profile.personality_traits ?? []).length > 0) slim.personality_traits = profile.personality_traits;
		if ((profile.appearance ?? []).length > 0) slim.appearance = profile.appearance;
		if ((profile.sample_lines ?? []).length > 0) slim.sample_lines = profile.sample_lines;
		if (profile.language !== void 0) slim.language = profile.language;
		if (profile.use_case !== void 0) slim.use_case = profile.use_case;
		views.push({
			character: slim,
			mapped_filters: mapped,
			candidate_count: candidates.length,
			candidate_voices: candidates.map(toSlimVoice),
			...filtered.candidates.length > candidates.length ? { note: `candidates truncated: ${filtered.candidates.length} → ${candidates.length}` } : {}
		});
	}
	return {
		vendor,
		channel: channel.name,
		pool_size: pool.length,
		use_case_filter: options.use_case ?? "",
		accent_preference: options.accent ?? "",
		character_count: profiles.length,
		characters: views,
		...note === void 0 ? {} : { note }
	};
}
/** action=save_cast：Agent 选角结果 → 校验 + 补齐 + 落盘（选定记录）。 */
async function saveVoiceCast(channel, profiles, selectionInputs, options = {}) {
	const prepared = await prepareVoiceCast(channel, profiles, options);
	new Map(prepared.characters.map((view) => [String(view.character.character_id), view]));
	const inputByCharacter = /* @__PURE__ */ new Map();
	for (const input of selectionInputs) {
		if (input === null || typeof input !== "object") continue;
		const characterId = asString(input.character_id);
		if (characterId !== "") inputByCharacter.set(characterId, input);
	}
	const entries = [];
	const issues = [];
	const sawReuse = /* @__PURE__ */ new Map();
	for (const view of prepared.characters) {
		const characterId = String(view.character.character_id ?? "");
		const characterName = String(view.character.character_name ?? characterId);
		const candidates = view.candidate_voices;
		const input = inputByCharacter.get(characterId);
		const dialogueCount = asNumber(view.character.dialogue_count) ?? 0;
		const tier = String(view.character.importance_tier ?? importanceTier(dialogueCount));
		let primary = asString(input?.voice_id ?? "");
		let status = "ok";
		const recordIssues = [];
		if (primary === "" || !candidates.some((voice) => voice.voice_id === primary)) {
			const fallback = candidates[0]?.voice_id ?? "";
			if (fallback !== "") {
				recordIssues.push("voice_id_not_in_candidates; fallback=first_candidate");
				primary = fallback;
				status = "tool_fallback";
			}
		}
		const requiredBackupCount = Math.min(BACKUP_LIMIT, Math.max(candidates.length - 1, 0));
		const backups = [];
		const rawBackups = Array.isArray(input?.backup_voice_ids) ? input.backup_voice_ids : [];
		for (const raw of rawBackups) {
			const id = asString(raw);
			if (id === "" || id === primary || backups.includes(id)) continue;
			if (!candidates.some((voice) => voice.voice_id === id)) continue;
			backups.push(id);
			if (backups.length >= requiredBackupCount) break;
		}
		if (backups.length < requiredBackupCount) {
			for (const voice of candidates) {
				if (backups.length >= requiredBackupCount) break;
				if (voice.voice_id === primary || backups.includes(voice.voice_id)) continue;
				backups.push(voice.voice_id);
			}
			if (status === "ok") status = "fixed";
			recordIssues.push("backup_voice_ids_auto_filled");
		}
		const primaryVoice = candidates.find((voice) => voice.voice_id === primary);
		const reason = asString(input?.reason ?? "");
		const record = {
			character_id: characterId,
			character_name: asString(input?.character_name) || characterName,
			voice_id: primary,
			voice_name: primaryVoice?.name ?? "",
			backup_voice_ids: backups,
			reason: reason === "" ? status === "tool_fallback" ? "tool fallback: selected from filtered candidates" : "" : reason,
			dialogue_count: dialogueCount,
			importance_tier: tier,
			selection_status: status,
			issues: recordIssues,
			selected_at: (/* @__PURE__ */ new Date()).toISOString()
		};
		entries.push(record);
		sawReuse.set(primary, [...sawReuse.get(primary) ?? [], {
			character_id: characterId,
			character_name: characterName,
			tier
		}]);
	}
	for (const [voiceId, users] of sawReuse) {
		const important = users.filter((user) => user.tier === "lead" || user.tier === "major");
		if (important.length > 1) for (const user of important) issues.push({
			character_id: user.character_id,
			character_name: user.character_name,
			issue: "primary_voice_reused",
			detail: `主音色 ${voiceId} 被 ${important.map((item) => item.character_name).join("、")} 复用；lead/major 角色应尽量使用不同主音色`
		});
	}
	const storePath = await writeCastSelections(channel, entries);
	return {
		vendor: prepared.vendor,
		channel: channel.name,
		store_path: storePath,
		count: entries.length,
		entries,
		issues
	};
}
function castSelectionsPath() {
	return path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "dsh-audiogen", "cast-selections.json");
}
async function loadCastSelections() {
	try {
		const text = await readFile(castSelectionsPath(), "utf-8");
		const payload = JSON.parse(text);
		if (typeof payload === "object" && payload !== null && typeof payload.channels === "object") return payload;
	} catch {}
	return {
		version: 1,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		channels: {}
	};
}
/** 按渠道合并选定记录（同 character_id 覆盖），写回本地 JSON。 */
async function writeCastSelections(channel, records) {
	const store = await loadCastSelections();
	const bucket = store.channels[channel.id] ?? {
		provider: channel.preset || "custom",
		name: channel.name,
		updatedAt: "",
		entries: {}
	};
	for (const record of records) bucket.entries[record.character_id] = record;
	bucket.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
	store.channels[channel.id] = bucket;
	store.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
	const file = castSelectionsPath();
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(store, null, 2) + "\n", "utf-8");
	return file;
}
//#endregion
//#region src/agent-audio-tools.ts
const audioRefSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: {
			type: "string",
			required: true
		},
		url: {
			type: "string",
			required: true
		},
		mime: {
			type: "string",
			required: true
		},
		bytes: {
			type: "integer",
			required: true
		},
		voiceId: { type: "string" }
	}
};
const resultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: {
			type: "string",
			required: true
		},
		message: {
			type: "string",
			required: true
		},
		mode: {
			type: "string",
			required: true,
			enum: [
				"tts",
				"music",
				"sfx",
				"voice_design"
			]
		},
		model: {
			type: "string",
			required: true
		},
		audio: {
			type: "array",
			required: true,
			items: audioRefSchema
		},
		resources: {
			type: "array",
			items: { type: "string" }
		},
		groups: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					model: {
						type: "string",
						required: true
					},
					audio: {
						type: "array",
						required: true,
						items: audioRefSchema
					},
					resources: {
						type: "array",
						items: { type: "string" }
					},
					error: { type: "string" }
				}
			}
		},
		error: { type: "string" }
	}
};
function renderResult(value) {
	return [{
		type: "text",
		text: JSON.stringify(value)
	}];
}
function resolveModel(config, requested) {
	const entries = config.channels.flatMap((channel) => channel.models.map((model) => ({
		channel,
		alias: model.alias,
		upstream: model.id
	})));
	if (entries.length === 0) throw new AudioGenError("No audio models/voices are configured. Open Settings > Plugins > AI Audio and add at least one.", "no-models-configured");
	const wanted = typeof requested === "string" && requested.trim() !== "" ? requested.trim() : "";
	if (wanted === "") {
		if (entries.length === 1) return entries[0];
		throw new AudioGenError(`Multiple audio models/voices are available — ask the user which channel and model to use, then call again. Options: ${entries.map((entry) => `"${entry.channel.name} · ${entry.alias}"`).join(", ")}.`, "model-choice-required");
	}
	const hosting = entries.filter((entry) => entry.alias === wanted);
	if (hosting.length === 0) throw new AudioGenError(`Audio model/voice "${wanted}" is not configured. Choose one of: ${[...new Set(entries.map((entry) => entry.alias))].join(", ")}.`, "audio-model-not-configured");
	return hosting.find((entry) => entry.channel.id === config.defaultChannelId) ?? hosting[0];
}
function ensureConfigured(config) {
	if (!config.enabled) throw new AudioGenError("AI audio generation is disabled. Open Settings > Plugins > AI Audio and enable it.", "plugin-disabled");
	if (!config.allowAgentAudioGeneration) throw new AudioGenError("Agent audio generation is disabled in Settings > Plugins > AI Audio.", "agent-generation-disabled");
	if (!config.channels.some((channel) => channel.apiUrl.trim() !== "" && channel.apiKey.trim() !== "")) throw new AudioGenError("Audio API credentials are not configured. Open Settings > Plugins > AI Audio, add a channel and fill its API URL and API key.", "audio-api-not-configured");
}
/** Library type from the generation mode, with an explicit override. */
function libraryTypeOf(mode, override) {
	if (override === "voice" || override === "music" || override === "sfx" || override === "tts") return override;
	if (mode === "voice_design") return "voice";
	return mode;
}
/** Register the Agent audio tool. */
function registerAgentAudioTools(ctx, resolve) {
	const disposer = ctx.tools.register(defineTool({
		name: "generate_audio",
		description: "Generate audio with the configured audio provider. Supports text-to-speech, music generation, sound effects and voice design (MiniMax /v1/voice_design, ElevenLabs /v1/text-to-voice/design). The tool call waits for the upstream result and returns same-origin audio URLs; pass those URLs to the user for playback or download. If multiple models are configured, first ask the user which one to use or pass model explicitly.",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "For tts, the text to speak. For music/sfx, a descriptive prompt."
			},
			mode: {
				type: "string",
				enum: [
					"tts",
					"music",
					"sfx",
					"voice_design"
				],
				description: "Generation mode. Defaults to tts."
			},
			model: {
				type: "string",
				description: "One of the configured audio models/voices. Defaults to the first configured model."
			},
			models: {
				type: "array",
				items: { type: "string" },
				description: "Optional: several configured model aliases to generate the SAME prompt with each one, sequentially, for comparison (e.g. [\"speech-2.8-hd\",\"speech-2.6-hd\"]). Cannot be combined with model; when present, models wins."
			},
			model_params: {
				type: "object",
				additionalProperties: true,
				description: "Optional per-model parameter overrides used with \"models\" (automatic by default = all models share the global params). Keys are model aliases; values are partial param objects using the same param names (format, duration, voice, speed, emotion, vol, pitch, sample_rate, bitrate, lyrics, is_instrumental, loop, prompt_influence, seed, steps, cfg_scale, subtitle_enable, aigc_watermark, language_boost, pronunciation_tone, voice_modify, timbre_weights). Unset fields fall back to the global values."
			},
			voice: {
				type: "string",
				description: "Optional voice id/name for TTS providers. Required for MiniMax TTS (e.g. male-qn-qingse, female-shaonv); fetch the account voices in Settings > Plugins > AI Audio."
			},
			preview_text: {
				type: "string",
				description: "Optional preview text for voice_design."
			},
			enhance_prompt: {
				type: "boolean",
				description: "Enhance the prompt with the agent default model before generating (uses the configured model settings, no extra key). Best-effort: on failure the original prompt is used."
			},
			speed: {
				type: "number",
				description: "Optional speaking rate / speed multiplier where supported. MiniMax range 0.5-2.0 (default 1)."
			},
			duration: {
				type: "number",
				description: "Requested duration in seconds for music/sfx."
			},
			lyrics: {
				type: "string",
				description: "Lyrics for music generation (MiniMax music-3.0/music-cover). Required unless is_instrumental is true. Split verses with an empty line."
			},
			is_instrumental: {
				type: "boolean",
				description: "Generate purely instrumental music without vocals/lyrics (MiniMax is_instrumental). When true, lyrics may be omitted."
			},
			loop: {
				type: "boolean",
				description: "Create a seamlessly looping sound effect (ElevenLabs sound generation loop, only for eleven_text_to_sound_v2)."
			},
			prompt_influence: {
				type: "number",
				description: "Sound effect prompt influence 0-1 (ElevenLabs prompt_influence, default 0.3): higher follows the prompt more closely, lower is more variable."
			},
			seed: {
				type: "integer",
				description: "Stable Audio random seed 0-4294967294 (default 0 = random); same seed yields reproducible audio."
			},
			steps: {
				type: "integer",
				description: "Stable Audio sampling steps, model-dependent: stable-audio-2 30-100, stable-audio-2.5/3 4-8 (out-of-range auto-clamped)."
			},
			cfg_scale: {
				type: "number",
				description: "Stable Audio prompt adherence 1-25 (stable-audio-2 default 7, 2.5/3 default 1); higher follows the prompt more strictly."
			},
			format: {
				type: "string",
				description: "Output format. MiniMax music: mp3/wav/pcm. ElevenLabs sound effects: codec name mp3/pcm/ulaw/alaw/opus (combined with sample_rate and bitrate into the single output_format codec_sample_rate_bitrate, e.g. mp3_22050_32; pcm/ulaw/alaw carry no bitrate)."
			},
			emotion: {
				type: "string",
				description: "MiniMax TTS emotion, e.g. happy/sad/angry/nervous/fearful/bored (voice_setting.emotion)."
			},
			vol: {
				type: "number",
				description: "MiniMax TTS volume 0-10, default 1 (voice_setting.vol)."
			},
			pitch: {
				type: "integer",
				description: "MiniMax TTS pitch shift -12..12 semitones, default 0 (voice_setting.pitch)."
			},
			text_normalization: {
				type: "boolean",
				description: "MiniMax TTS text normalization switch (voice_setting.text_normalization)."
			},
			latex_read: {
				type: "boolean",
				description: "MiniMax TTS math formula reading switch (voice_setting.latex_read)."
			},
			pronunciation_tone: {
				type: "array",
				items: { type: "string" },
				description: "MiniMax TTS pronunciation dictionary tone entries, each \"word/pronunciation\", e.g. [\"处理/(chu3)(li3)\", \"危险/dangerous\"] (pronunciation_dict.tone)."
			},
			sample_rate: {
				type: "integer",
				description: "Sample rate in Hz. MiniMax: music 16000/24000/32000/44100 (default 44100), tts default 32000 (audio_setting.sample_rate). ElevenLabs sound effects: 8000/16000/22050/24000/32000/44100/48000, combined with format and bitrate into the single output_format codec_sample_rate_bitrate."
			},
			bitrate: {
				type: "integer",
				description: "Bitrate. MiniMax in bps: 32000/64000/128000/256000 (music default 256000, tts default 128000). ElevenLabs sound effects in kbps: 32/48/64/96/128/192 (mp3/opus only; 192 kbps needs Creator plan or above), combined with format and sample_rate into the single output_format codec_sample_rate_bitrate."
			},
			channel: {
				type: "integer",
				description: "MiniMax TTS audio channels: 1 or 2, default 1 (audio_setting.channel)."
			},
			force_cbr: {
				type: "boolean",
				description: "MiniMax TTS force CBR encoding (audio_setting.force_cbr)."
			},
			subtitle_enable: {
				type: "boolean",
				description: "MiniMax TTS subtitle output switch (subtitle_enable)."
			},
			aigc_watermark: {
				type: "boolean",
				description: "MiniMax TTS AIGC watermark switch (aigc_watermark)."
			},
			language_boost: {
				type: "string",
				description: "MiniMax TTS language boost, e.g. 中英混读 (language_boost, model-dependent)."
			},
			voice_modify: {
				type: "object",
				additionalProperties: false,
				properties: {
					pitch: {
						type: "integer",
						description: "Pitch shift for voice modification."
					},
					intensity: {
						type: "integer",
						description: "Intensity for voice modification."
					},
					timbre: {
						type: "integer",
						description: "Timbre shift for voice modification."
					},
					sound_effects: {
						type: "string",
						description: "Sound effect for voice modification, e.g. 耳语."
					}
				},
				description: "MiniMax TTS voice modification (voice_modify, supported by speech-2.8+)."
			},
			timbre_weights: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						voice_id: {
							type: "string",
							required: true
						},
						weight: {
							type: "integer",
							required: true
						}
					}
				},
				description: "MiniMax TTS dual-voice blend weights (timbre_weights)."
			},
			save_to_library: {
				type: "boolean",
				description: "Save the generated audio into the local resource library after success. Also enabled globally by the \"auto save to library\" setting; pass false to skip a single run."
			},
			library_name: {
				type: "string",
				description: "Resource name in the library. Defaults to the prompt."
			},
			library_type: {
				type: "string",
				enum: [
					"voice",
					"music",
					"sfx",
					"tts"
				],
				description: "Resource type in the library. Defaults to the generation mode (voice_design → voice)."
			},
			library_tags: {
				type: "array",
				items: { type: "string" },
				description: "Tags for the library resource."
			}
		},
		output: {
			schema: resultSchema,
			render: (_args, value) => renderResult(value)
		},
		timeoutMs: 3e5,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const config = resolve();
			ensureConfigured(config);
			const mode = args.mode === "music" ? "music" : args.mode === "sfx" ? "sfx" : args.mode === "voice_design" ? "voice_design" : "tts";
			/** 把生成参数（snake_case 入参或 model_params 片段）映射为请求字段。 */
			const mapParams = (raw) => {
				const voiceModify = typeof raw.voice_modify === "object" && raw.voice_modify !== null ? (() => {
					const src = raw.voice_modify;
					const out = {};
					if (typeof src.pitch === "number") out.pitch = src.pitch;
					if (typeof src.intensity === "number") out.intensity = src.intensity;
					if (typeof src.timbre === "number") out.timbre = src.timbre;
					if (typeof src.sound_effects === "string" && src.sound_effects.trim() !== "") out.soundEffects = src.sound_effects.trim();
					return Object.keys(out).length > 0 ? out : void 0;
				})() : void 0;
				const timbreWeights = Array.isArray(raw.timbre_weights) ? raw.timbre_weights.filter((item) => typeof item === "object" && item !== null && typeof item.voice_id === "string" && typeof item.weight === "number").map((item) => ({
					voiceId: item.voice_id.trim(),
					weight: item.weight
				})).filter((item) => item.voiceId !== "") : void 0;
				const stringOrEmpty = (key) => {
					const value = raw[key];
					return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
				};
				const finiteOrUndefined = (key) => {
					const value = raw[key];
					return typeof value === "number" && Number.isFinite(value) ? value : void 0;
				};
				return {
					...stringOrEmpty("voice") !== void 0 ? { voice: stringOrEmpty("voice") } : {},
					...stringOrEmpty("preview_text") !== void 0 ? { previewText: stringOrEmpty("preview_text") } : {},
					...finiteOrUndefined("speed") !== void 0 ? { speed: finiteOrUndefined("speed") } : {},
					...finiteOrUndefined("duration") !== void 0 ? { duration: finiteOrUndefined("duration") } : {},
					...stringOrEmpty("lyrics") !== void 0 ? { lyrics: stringOrEmpty("lyrics") } : {},
					...typeof raw.is_instrumental === "boolean" ? { isInstrumental: raw.is_instrumental } : {},
					...typeof raw.loop === "boolean" ? { loop: raw.loop } : {},
					...finiteOrUndefined("prompt_influence") !== void 0 ? { promptInfluence: finiteOrUndefined("prompt_influence") } : {},
					...finiteOrUndefined("seed") !== void 0 ? { seed: finiteOrUndefined("seed") } : {},
					...finiteOrUndefined("steps") !== void 0 ? { steps: finiteOrUndefined("steps") } : {},
					...finiteOrUndefined("cfg_scale") !== void 0 ? { cfgScale: finiteOrUndefined("cfg_scale") } : {},
					...stringOrEmpty("format") !== void 0 ? { format: stringOrEmpty("format") } : {},
					...stringOrEmpty("emotion") !== void 0 ? { emotion: stringOrEmpty("emotion") } : {},
					...finiteOrUndefined("vol") !== void 0 ? { vol: finiteOrUndefined("vol") } : {},
					...finiteOrUndefined("pitch") !== void 0 ? { pitch: finiteOrUndefined("pitch") } : {},
					...typeof raw.text_normalization === "boolean" ? { textNormalization: raw.text_normalization } : {},
					...typeof raw.latex_read === "boolean" ? { latexRead: raw.latex_read } : {},
					...Array.isArray(raw.pronunciation_tone) && raw.pronunciation_tone.length > 0 ? { pronunciationTone: raw.pronunciation_tone.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) } : {},
					...finiteOrUndefined("sample_rate") !== void 0 ? { sampleRate: finiteOrUndefined("sample_rate") } : {},
					...finiteOrUndefined("bitrate") !== void 0 ? { bitrate: finiteOrUndefined("bitrate") } : {},
					...finiteOrUndefined("channel") !== void 0 ? { audioChannel: finiteOrUndefined("channel") } : {},
					...typeof raw.force_cbr === "boolean" ? { forceCbr: raw.force_cbr } : {},
					...typeof raw.subtitle_enable === "boolean" ? { subtitleEnable: raw.subtitle_enable } : {},
					...typeof raw.aigc_watermark === "boolean" ? { aigcWatermark: raw.aigc_watermark } : {},
					...stringOrEmpty("language_boost") !== void 0 ? { languageBoost: stringOrEmpty("language_boost") } : {},
					...voiceModify !== void 0 ? { voiceModify } : {},
					...timbreWeights !== void 0 && timbreWeights.length > 0 ? { timbreWeights } : {}
				};
			};
			const buildRequest = (picked) => {
				const base = mapParams(args);
				let override = {};
				if (typeof args.model_params === "object" && args.model_params !== null) {
					const perModel = args.model_params[picked.alias];
					if (typeof perModel === "object" && perModel !== null) override = mapParams(perModel);
				}
				return {
					mode,
					model: picked.alias,
					upstream: picked.upstream,
					channelId: picked.channel.id,
					channel: picked.channel.name,
					prompt: typeof args.prompt === "string" ? args.prompt.trim() : "",
					...base,
					...override
				};
			};
			/** 单模型执行：生成 + 保存文件 + 历史 + 可选资源库；错误收敛为分组结果。 */
			const runOne = async (picked) => {
				const request = buildRequest(picked);
				if (args.enhance_prompt === true && config.enhance !== void 0) try {
					request.prompt = await config.enhance(request.prompt, request.mode);
				} catch {}
				try {
					const release = await (config.budget?.acquire(exec.signal) ?? Promise.resolve(() => {}));
					let outputs;
					try {
						outputs = await generateAudio(picked.channel, request, exec.signal);
					} finally {
						release();
					}
					const audio = [];
					const saved = [];
					for (const [index, output] of outputs.entries()) {
						const stored = await saveAudioFile(output.data, output.mime, `generated-${index + 1}`);
						saved.push({
							id: stored.id,
							url: `/api/dsh-audiogen/audio/${encodeURIComponent(stored.file)}`,
							file: stored.file,
							mime: stored.mime,
							bytes: stored.bytes,
							...output.voiceId === void 0 ? {} : { voiceId: output.voiceId }
						});
						audio.push({
							id: stored.id,
							url: `/api/dsh-audiogen/audio/${encodeURIComponent(stored.file)}`,
							mime: stored.mime,
							bytes: stored.bytes,
							...output.voiceId === void 0 ? {} : { voiceId: output.voiceId }
						});
					}
					try {
						await appendHistory({
							id: randomUUID(),
							createdAt: Date.now(),
							mode: request.mode,
							model: picked.alias,
							prompt: request.prompt,
							...request.voice === void 0 ? {} : { voice: request.voice },
							...request.previewText === void 0 ? {} : { previewText: request.previewText },
							...request.speed === void 0 ? {} : { speed: request.speed },
							...request.duration === void 0 ? {} : { duration: request.duration },
							...request.format === void 0 ? {} : { format: request.format },
							audio: outputs.map((output, index) => ({
								id: saved[index].id,
								file: saved[index].file,
								b64: Buffer.from(output.data).toString("base64"),
								mime: saved[index].mime,
								bytes: saved[index].bytes,
								url: saved[index].url,
								...output.voiceId === void 0 ? {} : { voiceId: output.voiceId }
							})),
							channelId: picked.channel.id,
							channel: picked.channel.name,
							params: { ...request }
						});
					} catch {}
					const wantSave = args.save_to_library === true || config.autoSaveToLibrary && args.save_to_library !== false;
					let resources;
					if (wantSave) try {
						resources = [(await saveToLibrary({
							audioFiles: saved.map((item) => ({
								id: item.id,
								file: item.file,
								mime: item.mime,
								...item.voiceId === void 0 ? {} : { voiceId: item.voiceId }
							})),
							type: libraryTypeOf(request.mode, args.library_type),
							...typeof args.library_name === "string" && args.library_name.trim() !== "" ? { name: args.library_name.trim() } : {},
							...Array.isArray(args.library_tags) ? { tags: args.library_tags.filter((tag) => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim()) } : {},
							provenance: {
								mode: request.mode,
								prompt: request.prompt,
								channel: picked.channel.name,
								channelId: picked.channel.id,
								apiUrl: picked.channel.apiUrl,
								model: picked.alias,
								upstream: picked.upstream,
								...request.voice === void 0 ? {} : { voice: request.voice },
								...request.previewText === void 0 ? {} : { previewText: request.previewText },
								params: { ...request }
							}
						})).id];
					} catch {}
					return {
						model: picked.alias,
						audio,
						...resources === void 0 ? {} : { resources }
					};
				} catch (error) {
					if (exec.signal?.aborted === true) throw error;
					return {
						model: picked.alias,
						audio: [],
						error: error instanceof Error ? error.message : String(error)
					};
				}
			};
			const requestedModels = Array.isArray(args.models) ? [...new Set(args.models.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()))] : [];
			if (requestedModels.length > 0 && mode !== "voice_design") {
				const groups = [];
				let succeeded = 0;
				for (const alias of requestedModels) {
					let picked;
					try {
						picked = resolveModel(config, alias);
					} catch (error) {
						groups.push({
							model: alias,
							audio: [],
							error: error instanceof Error ? error.message : String(error)
						});
						continue;
					}
					const group = await runOne(picked);
					groups.push(group);
					if (group.error === void 0) succeeded++;
				}
				return {
					status: succeeded > 0 ? "completed" : "failed",
					message: succeeded > 0 ? `Generated ${succeeded}/${groups.length} model(s) with the same prompt for comparison. The audio files can be played/downloaded from the returned URLs.` : "All model generations failed.",
					mode,
					model: groups[0]?.model ?? requestedModels[0],
					audio: groups.flatMap((group) => group.audio),
					groups,
					...succeeded === 0 ? { error: groups.map((group) => `${group.model}: ${group.error ?? ""}`).filter((item) => !item.endsWith(": ")).join("；") } : {}
				};
			}
			const one = await runOne(mode === "voice_design" ? (() => {
				const usable = config.channels.filter((channel) => channel.apiUrl.trim() !== "" && channel.apiKey.trim() !== "");
				const target = usable.find((channel) => channel.id === config.defaultChannelId) ?? usable[0];
				if (target === void 0) throw new AudioGenError("No usable audio channel is configured for voice design.", "no-channel-available");
				return {
					channel: target,
					alias: "",
					upstream: ""
				};
			})() : resolveModel(config, args.model));
			if (one.error !== void 0) return {
				status: "failed",
				message: "Audio generation failed.",
				mode,
				model: one.model,
				audio: [],
				error: one.error
			};
			return {
				status: "completed",
				message: "Audio generation completed. The audio files can be played/downloaded from the returned URLs.",
				mode,
				model: one.model,
				audio: one.audio,
				...one.resources === void 0 ? {} : { resources: one.resources }
			};
		}
	}));
	const searchDisposer = ctx.tools.register(defineTool({
		name: "search_audio_library",
		description: "Search curated audio resources in the local resource library (voice / music / sfx / tts). Returns matching resources with type, category, name, tags, full provenance (channel, model, voiceId, prompt) and same-origin audio URLs the user can play. Use it before generating to reuse an existing voice, music bed or sound effect instead of generating a new one.",
		parameters: {
			type: {
				type: "string",
				enum: [
					"voice",
					"music",
					"sfx",
					"tts"
				],
				description: "Filter by resource type."
			},
			category: {
				type: "string",
				description: "Filter by category (voice: male/female/custom; tts: the speaking voice key)."
			},
			keyword: {
				type: "string",
				description: "Search name, tags, prompt and model."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					status: {
						type: "string",
						required: true,
						enum: ["ok"]
					},
					count: {
						type: "integer",
						required: true
					},
					entries: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: {
									type: "string",
									required: true
								},
								name: {
									type: "string",
									required: true
								},
								type: {
									type: "string",
									required: true,
									enum: [
										"voice",
										"music",
										"sfx",
										"tts"
									]
								},
								category: { type: "string" },
								tags: {
									type: "array",
									items: { type: "string" },
									required: true
								},
								prompt: {
									type: "string",
									required: true
								},
								model: { type: "string" },
								channel: { type: "string" },
								voiceId: { type: "string" },
								urls: {
									type: "array",
									items: { type: "string" },
									required: true
								}
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		isConcurrencySafe: () => true,
		async execute(args) {
			const keyword = typeof args.keyword === "string" ? args.keyword.trim().toLowerCase() : "";
			const wantedType = args.type === "voice" || args.type === "music" || args.type === "sfx" || args.type === "tts" ? args.type : void 0;
			const wantedCategory = typeof args.category === "string" && args.category.trim() !== "" ? args.category.trim() : void 0;
			const entries = (await listLibrary()).filter((entry) => {
				if (wantedType !== void 0 && entry.type !== wantedType) return false;
				if (wantedCategory !== void 0 && (entry.category ?? "") !== wantedCategory) return false;
				if (keyword !== "") {
					if (![
						entry.name,
						...entry.tags,
						entry.provenance.prompt,
						entry.provenance.model ?? "",
						entry.provenance.channel ?? ""
					].join(" ").toLowerCase().includes(keyword)) return false;
				}
				return true;
			}).slice(0, 30).map((entry) => ({
				id: entry.id,
				name: entry.name,
				type: entry.type,
				...entry.category === void 0 ? {} : { category: entry.category },
				tags: entry.tags,
				prompt: entry.provenance.prompt,
				...entry.provenance.model === void 0 ? {} : { model: entry.provenance.model },
				...entry.provenance.channel === void 0 ? {} : { channel: entry.provenance.channel },
				...entry.provenance.voiceId === void 0 ? {} : { voiceId: entry.provenance.voiceId },
				urls: entry.files.map((file) => file.url)
			}));
			return {
				status: "ok",
				count: entries.length,
				entries
			};
		}
	}));
	/** 单条音色条目 schema（voices / candidate_voices 共用）。 */
	const voiceItemSchema = {
		type: "object",
		additionalProperties: false,
		properties: {
			voice_id: {
				type: "string",
				required: true
			},
			name: {
				type: "string",
				required: true
			},
			source: {
				type: "string",
				required: true
			},
			deletable: {
				type: "boolean",
				required: true
			},
			language: { type: "string" },
			locale: { type: "string" },
			accent: { type: "string" },
			gender: { type: "string" },
			age: { type: "string" },
			use_case: { type: "string" },
			category: { type: "string" },
			descriptive: { type: "string" },
			labels: {
				type: "object",
				additionalProperties: true
			},
			description: { type: "string" },
			preview_url: { type: "string" }
		}
	};
	/** 厂商音色管理：浏览/筛选 + 按需求描述推荐 + 删除（仅自建）+ 角色选角（cast）。删除不可逆，必须 confirm=true。 */
	const managementDisposer = ctx.tools.register(defineTool({
		name: "manage_audio_voices",
		description: "Manage vendor voice libraries (MiniMax / ElevenLabs). action=list: browse available TTS voices of a channel — official/shared voices plus voices designed/cloned by the account; filtering supports the official /v1/shared-voices server-side filters (search/use_case/accent/gender/age/locale/category/sort/featured/free_users_allowed/descriptive) for the ElevenLabs shared library, plus local language/keyword/source filtering everywhere; returns voice_id/name/source/description/preview_url and whether each voice is deletable. Channels whose gateway lacks the vendor voice-library endpoints (e.g. new-api relays) automatically fall back to the configured model-alias catalog as the candidate pool (source=configured, name only). action=recommend: let the agent default model pick the top-k voices for a natural-language requirement (e.g. \"17岁清亮甜美的少女音，适合活泼女主角，英式口音\") from the same candidate pool — pass requirement (required) and optional top_k (1-10, default 5); returns ranked voices with a short reason each; voice_ids are validated against the pool (hallucinated ids are dropped). action=cast: 角色音色选角第一步 — pass characters (角色画像 JSON 数组/对象/JSON 字符串：character_id, character_name, gender 男/女, age_stage 少年/青年/中年/老年, voice_traits, personality_traits, appearance, sample_lines, dialogue_count, language, use_case) plus optional language/use_case/accent; the tool applies deterministic hard filters per character (gender/age/use_case strict; accent is a preference and is relaxed only when the strict pool is empty) and returns each character’s mapped filters + filtered candidate_voices (primary + backup slots). Then select voices globally in-context (lead/major 角色主音色不要复用), and call action=save_cast with the same characters plus selections [{character_id, voice_id, character_name?, backup_voice_ids?, reason?}] to validate membership, auto-fill backups, flag primary reuse and persist the cast plan to ~/.dsh/dsh-audiogen/cast-selections.json. action=delete: delete one OWNED voice (custom/owned only; official/shared/system voices are read-only and refused) — irreversible, so confirm must be true (pass the exact voice_id from action=list). Use the returned voice_id with generate_audio (mode=tts, voice=<voice_id>) to speak with the selected voice.",
		parameters: {
			action: {
				type: "string",
				enum: [
					"list",
					"recommend",
					"delete",
					"cast",
					"save_cast"
				],
				required: true,
				description: "list = browse/filter voices; recommend = pick voices for a requirement with the agent default model; cast = prepare per-character filtered candidate pools (deterministic hard filters, no LLM); save_cast = validate + persist a cast plan made in-context; delete = remove an owned voice."
			},
			channel: {
				type: "string",
				description: "Channel name or id (e.g. the channel shown in settings). Defaults to the default channel; required when more than one channel is configured."
			},
			characters: {
				type: "json",
				description: "Required for cast/save_cast: 角色画像 — JSON array of profile objects, a single profile object, or a JSON string. Each profile: character_id (optional, auto-derived from character_name), character_name (required), gender (男/女 or male/female), age_stage (少年/青年/中年/老年…, string or array), age_stage_source (explicit/appearance_inferred/unknown), voice_traits, personality_traits, appearance (string or string[]), sample_lines ([{text, emotion_hint?}] or text), dialogue_count (number), language (en/zh/ja…), use_case. Convert free-text character descriptions into this structure before calling."
			},
			selections: {
				type: "json",
				description: "Required for save_cast: the cast plan made by you — JSON array of {character_id, voice_id, character_name?, backup_voice_ids?, reason?}. voice_id must come from the cast action’s candidate_voices; the tool validates membership, fills missing backups, flags lead/major primary reuse and persists to ~/.dsh/dsh-audiogen/cast-selections.json."
			},
			language: {
				type: "string",
				description: "Filter for list/recommend: language substring (ISO code like en/zh/ja, or a label like Chinese (Mandarin)). For cast: pool language for the candidates (per-character language overrides it)."
			},
			keyword: {
				type: "string",
				description: "Filter for list/recommend: free text over voice name/description/accent/use_case."
			},
			source: {
				type: "string",
				enum: [
					"system",
					"custom",
					"owned",
					"shared"
				],
				description: "Filter for list/recommend: MiniMax system/custom; ElevenLabs owned (account) / shared (community)."
			},
			search: {
				type: "string",
				description: "Official /v1/shared-voices filter: free-text search over the ElevenLabs shared voice library (ElevenLabs only; local fallback elsewhere)."
			},
			use_case: {
				type: "string",
				description: "Official filter: use case, e.g. characters_animation / conversational / narration / gaming (ElevenLabs shared library). For cast: hard filter per character (default characters_animation for ElevenLabs; pass \"\" to disable)."
			},
			accent: {
				type: "string",
				description: "Official filter: accent, e.g. british / american / australian. For cast: accent is a preference (strict first, relaxed when the strict pool is empty)."
			},
			gender: {
				type: "string",
				description: "Official filter: male / female."
			},
			age: {
				type: "string",
				description: "Official filter: age bracket, e.g. adult / young / middle_aged."
			},
			locale: {
				type: "string",
				description: "Official filter: language locale, e.g. en-us / en-gb."
			},
			category: {
				type: "string",
				description: "Official filter: voice category, e.g. animation / voice_actors."
			},
			sort: {
				type: "string",
				enum: [
					"most_used",
					"random",
					"oldest",
					"newest"
				],
				description: "Official sort for the shared library."
			},
			featured: {
				type: "boolean",
				description: "Official filter: featured shared voices only (true only)."
			},
			free_users_allowed: {
				type: "boolean",
				description: "Official filter: voices allowed for free users only (true only)."
			},
			descriptive: {
				type: "boolean",
				description: "Official filter: voices with descriptions only (true only)."
			},
			requirement: {
				type: "string",
				description: "Required for recommend: the natural-language voice requirement, e.g. \"低沉磁性的中年男声，适合沉稳旁白\"."
			},
			top_k: {
				type: "integer",
				description: "Optional for recommend: how many voices to return (1-10, default 5)."
			},
			voice_id: {
				type: "string",
				description: "Required for delete: the exact voice_id from action=list."
			},
			confirm: {
				type: "boolean",
				description: "Required for delete: must be true; deletion is irreversible."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					status: {
						type: "string",
						required: true,
						enum: ["ok"]
					},
					kind: {
						type: "string",
						required: true,
						enum: [
							"list",
							"recommend",
							"delete",
							"cast",
							"save_cast"
						]
					},
					vendor: {
						type: "string",
						required: true
					},
					channel: {
						type: "string",
						required: true
					},
					count: { type: "integer" },
					truncated: { type: "boolean" },
					requirement: { type: "string" },
					candidate_count: { type: "integer" },
					voices: {
						type: "array",
						items: voiceItemSchema
					},
					recommendations: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								voice_id: {
									type: "string",
									required: true
								},
								name: {
									type: "string",
									required: true
								},
								source: {
									type: "string",
									required: true
								},
								deletable: {
									type: "boolean",
									required: true
								},
								language: { type: "string" },
								locale: { type: "string" },
								accent: { type: "string" },
								gender: { type: "string" },
								age: { type: "string" },
								use_case: { type: "string" },
								category: { type: "string" },
								descriptive: { type: "string" },
								labels: {
									type: "object",
									additionalProperties: true
								},
								description: { type: "string" },
								preview_url: { type: "string" },
								reason: {
									type: "string",
									required: true
								}
							}
						}
					},
					pool_size: { type: "integer" },
					use_case_filter: { type: "string" },
					accent_preference: { type: "string" },
					character_count: { type: "integer" },
					characters: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								character: {
									type: "object",
									additionalProperties: false,
									properties: {
										character_id: {
											type: "string",
											required: true
										},
										character_name: {
											type: "string",
											required: true
										},
										gender: { type: "string" },
										age_stage: {
											type: "array",
											items: { type: "string" }
										},
										age_stage_source: { type: "string" },
										voice_traits: {
											type: "array",
											items: { type: "string" }
										},
										personality_traits: {
											type: "array",
											items: { type: "string" }
										},
										appearance: {
											type: "array",
											items: { type: "string" }
										},
										sample_lines: {
											type: "array",
											items: {
												type: "object",
												additionalProperties: false,
												properties: {
													text: {
														type: "string",
														required: true
													},
													emotion_hint: { type: "string" }
												}
											}
										},
										dialogue_count: {
											type: "integer",
											required: true
										},
										importance_tier: {
											type: "string",
											required: true
										},
										language: { type: "string" },
										use_case: { type: "string" }
									}
								},
								mapped_filters: {
									type: "object",
									additionalProperties: false,
									properties: {
										gender: { type: "string" },
										age: {
											type: "array",
											items: { type: "string" }
										},
										fallback_age: {
											type: "array",
											items: { type: "string" }
										},
										accent: { type: "string" },
										use_case: { type: "string" },
										language: { type: "string" },
										notes: {
											type: "string",
											required: true
										}
									}
								},
								candidate_count: {
									type: "integer",
									required: true
								},
								candidate_voices: {
									type: "array",
									required: true,
									items: voiceItemSchema
								},
								note: { type: "string" }
							}
						}
					},
					selections: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								character_id: {
									type: "string",
									required: true
								},
								character_name: {
									type: "string",
									required: true
								},
								voice_id: {
									type: "string",
									required: true
								},
								voice_name: {
									type: "string",
									required: true
								},
								backup_voice_ids: {
									type: "array",
									items: { type: "string" },
									required: true
								},
								reason: {
									type: "string",
									required: true
								},
								dialogue_count: { type: "integer" },
								importance_tier: { type: "string" },
								selection_status: {
									type: "string",
									required: true
								},
								issues: {
									type: "array",
									items: { type: "string" },
									required: true
								},
								selected_at: { type: "string" }
							}
						}
					},
					issues: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								character_id: {
									type: "string",
									required: true
								},
								character_name: {
									type: "string",
									required: true
								},
								issue: {
									type: "string",
									required: true
								},
								detail: {
									type: "string",
									required: true
								}
							}
						}
					},
					store_path: { type: "string" },
					voice_id: { type: "string" },
					deleted: { type: "boolean" },
					message: { type: "string" },
					note: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		timeoutMs: 12e4,
		isConcurrencySafe: () => true,
		async execute(args) {
			const config = resolve();
			if (!config.enabled) throw new AudioGenError("AI audio is disabled. Open Settings > Plugins > AI Audio and enable it.", "plugin-disabled");
			const channel = resolveVoiceManagementChannel(config, args.channel);
			const action = args.action === "delete" ? "delete" : args.action === "recommend" ? "recommend" : args.action === "cast" ? "cast" : args.action === "save_cast" ? "save_cast" : "list";
			if (action === "cast" || action === "save_cast") {
				const characters = parseCharacterProfiles(args.characters);
				const defaultUseCase = isElevenLabs$1(channel) && typeof args.use_case !== "string" ? "characters_animation" : void 0;
				const castOptions = {
					...typeof args.use_case === "string" ? { use_case: args.use_case.trim() } : defaultUseCase === void 0 ? {} : { use_case: defaultUseCase },
					...typeof args.language === "string" && args.language.trim() !== "" ? { language: args.language.trim() } : {},
					...typeof args.accent === "string" && args.accent.trim() !== "" ? { accent: args.accent.trim() } : {}
				};
				if (action === "cast") {
					const prepared = await prepareVoiceCast(channel, characters, castOptions);
					return {
						status: "ok",
						kind: "cast",
						vendor: prepared.vendor,
						channel: prepared.channel,
						pool_size: prepared.pool_size,
						use_case_filter: prepared.use_case_filter,
						accent_preference: prepared.accent_preference,
						character_count: prepared.character_count,
						characters: prepared.characters,
						...prepared.note === void 0 ? {} : { note: prepared.note }
					};
				}
				const rawSelections = args.selections;
				const selectionInputs = Array.isArray(rawSelections) ? rawSelections : [];
				if (selectionInputs.length === 0) throw new AudioGenError("save_cast requires selections — an array of {character_id, voice_id, character_name?, backup_voice_ids?, reason?} matching the cast result", "cast-selections-required");
				const saved = await saveVoiceCast(channel, characters, selectionInputs, castOptions);
				return {
					status: "ok",
					kind: "save_cast",
					vendor: saved.vendor,
					channel: saved.channel,
					store_path: saved.store_path,
					count: saved.count,
					selections: saved.entries,
					issues: saved.issues
				};
			}
			if (action === "list" || action === "recommend") {
				const source = typeof args.source === "string" && [
					"system",
					"custom",
					"owned",
					"shared"
				].includes(args.source) ? args.source : void 0;
				const pick = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
				const serverFilters = {
					...pick(args.search) === void 0 ? {} : { search: pick(args.search) },
					...pick(args.use_case) === void 0 ? {} : { use_case: pick(args.use_case) },
					...pick(args.accent) === void 0 ? {} : { accent: pick(args.accent) },
					...pick(args.gender) === void 0 ? {} : { gender: pick(args.gender) },
					...pick(args.age) === void 0 ? {} : { age: pick(args.age) },
					...pick(args.locale) === void 0 ? {} : { locale: pick(args.locale) },
					...pick(args.category) === void 0 ? {} : { category: pick(args.category) },
					...typeof args.sort === "string" && [
						"most_used",
						"random",
						"oldest",
						"newest"
					].includes(args.sort) ? { sort: args.sort } : {},
					...args.featured === true ? { featured: true } : {},
					...args.free_users_allowed === true ? { free_users_allowed: true } : {},
					...args.descriptive === true ? { descriptive: true } : {}
				};
				const result = await listVendorVoicesWithFallback(channel, {
					...typeof args.language === "string" && args.language.trim() !== "" ? { language: args.language.trim() } : {},
					...typeof args.keyword === "string" && args.keyword.trim() !== "" ? { keyword: args.keyword.trim() } : {},
					...source === void 0 ? {} : { source },
					...Object.keys(serverFilters).length === 0 ? {} : { serverFilters },
					...action === "recommend" ? { limit: 500 } : {}
				});
				if (action === "recommend") {
					const requirement = typeof args.requirement === "string" ? args.requirement.trim() : "";
					if (requirement === "") throw new AudioGenError("recommend requires requirement (a natural-language voice description).", "recommend-requirement-required");
					const rawTopK = args.top_k;
					const topK = typeof rawTopK === "number" && Number.isFinite(rawTopK) ? Math.max(1, Math.min(10, Math.floor(rawTopK))) : 5;
					if (config.recommend === void 0) throw new AudioGenError("Voice recommendation is unavailable (LLM service not wired).", "recommend-unavailable");
					const recommendations = await config.recommend(requirement, result.voices, topK);
					appendVoiceRecommendRecord({
						channel: channel.name,
						vendor: result.vendor,
						requirement,
						candidate_count: result.voices.length,
						top_k: topK,
						channel_id: channel.id,
						filters: {
							...typeof args.language === "string" && args.language.trim() !== "" ? { language: args.language.trim() } : {},
							...typeof args.keyword === "string" && args.keyword.trim() !== "" ? { keyword: args.keyword.trim() } : {},
							...source === void 0 ? {} : { source },
							...typeof args.use_case === "string" && args.use_case.trim() !== "" ? { use_case: args.use_case.trim() } : {},
							...typeof args.accent === "string" && args.accent.trim() !== "" ? { accent: args.accent.trim() } : {}
						},
						recommendations: recommendations.map((item) => ({
							voice_id: item.voice_id,
							name: item.name,
							source: item.source,
							deletable: item.deletable,
							...item.language === void 0 ? {} : { language: item.language },
							...item.locale === void 0 ? {} : { locale: item.locale },
							...item.accent === void 0 ? {} : { accent: item.accent },
							...item.gender === void 0 ? {} : { gender: item.gender },
							...item.age === void 0 ? {} : { age: item.age },
							...item.use_case === void 0 ? {} : { use_case: item.use_case },
							...item.category === void 0 ? {} : { category: item.category },
							...item.labels === void 0 ? {} : { labels: item.labels },
							...item.descriptive === void 0 ? {} : { descriptive: item.descriptive },
							...item.description === void 0 ? {} : { description: item.description },
							...item.preview_url === void 0 ? {} : { preview_url: item.preview_url },
							reason: item.reason
						}))
					}).catch(() => {});
					return {
						status: "ok",
						kind: "recommend",
						vendor: result.vendor,
						channel: channel.name,
						requirement,
						candidate_count: result.voices.length,
						recommendations,
						...result.note === void 0 ? {} : { note: result.note }
					};
				}
				return {
					status: "ok",
					kind: "list",
					vendor: result.vendor,
					channel: channel.name,
					count: result.voices.length,
					...result.truncated ? { truncated: true } : {},
					voices: result.voices,
					...result.note === void 0 ? {} : { note: result.note }
				};
			}
			const voiceId = typeof args.voice_id === "string" ? args.voice_id.trim() : "";
			if (voiceId === "") throw new AudioGenError("delete requires voice_id (the exact voice_id from action=list).", "voice-id-required");
			if (args.confirm !== true) throw new AudioGenError("Deletion is irreversible: pass confirm=true after verifying the voice_id.", "voice-delete-requires-confirm");
			const deleted = await deleteVendorVoice(channel, voiceId);
			return {
				status: "ok",
				kind: "delete",
				vendor: deleted.vendor,
				channel: channel.name,
				voice_id: deleted.voice_id,
				deleted: true,
				message: `已删除音色 ${deleted.voice_id}（${channel.name}）`
			};
		}
	}));
	return () => {
		disposer();
		searchDisposer();
		managementDisposer();
	};
}
/** 解析工具目标渠道：默认渠道 > 唯一可用渠道；多渠道未指定时要求显式选择。 */
function resolveVoiceManagementChannel(config, requested) {
	const usable = config.channels.filter((channel) => channel.apiUrl.trim() !== "" && channel.apiKey.trim() !== "");
	if (usable.length === 0) throw new AudioGenError("Audio API credentials are not configured. Open Settings > Plugins > AI Audio, add a channel and fill its API URL and API key.", "audio-api-not-configured");
	const wanted = typeof requested === "string" ? requested.trim() : "";
	if (wanted === "") {
		if (usable.length === 1) return usable[0];
		const target = usable.find((channel) => channel.id === config.defaultChannelId);
		if (target !== void 0) return target;
		throw new AudioGenError(`Multiple audio channels are configured — specify the channel (one of: ${usable.map((channel) => `"${channel.name}"`).join(", ")}).`, "channel-choice-required");
	}
	const direct = usable.find((channel) => channel.name === wanted || channel.id === wanted);
	if (direct !== void 0) return direct;
	const partial = usable.filter((channel) => channel.name.toLowerCase().includes(wanted.toLowerCase()));
	if (partial.length === 1) return partial[0];
	throw new AudioGenError(`Audio channel "${wanted}" is not configured. Choose one of: ${usable.map((channel) => channel.name).join(", ")}.`, "channel-not-configured");
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "audiogen";
/** Services required before the surfaces can mount. */
const inject = ["webServer", "systemPrompt"];
/** The settings namespace of this plugin. */
const AudioGenSettingsNamespace = AUDIOGEN_SETTINGS_NAMESPACE;
const DEFAULT_MAX_CONCURRENT = 5;
const Config = z.object({
	enabled: z.boolean().default(true),
	announceToAgent: z.boolean().default(true),
	allowAgentAudioGeneration: z.boolean().default(true),
	channels: z.array(z.object({
		id: z.string(),
		preset: z.string().default(""),
		name: z.string().default(""),
		apiUrl: z.string().default(""),
		models: z.array(z.object({
			alias: z.string(),
			id: z.string()
		})).default([])
	})).default([]),
	channelSecrets: z.dict(z.string().role("secret")).default({}),
	defaultChannelId: z.string().default(""),
	defaultModel: z.string().default(""),
	autoSaveToLibrary: z.boolean().default(false),
	maxConcurrentGenerations: z.union([z.number(), z.string()]).default(DEFAULT_MAX_CONCURRENT),
	enhanceModel: z.string().default("")
});
const DEFAULT_ENABLED = true;
const DEFAULT_ANNOUNCE = true;
const DEFAULT_ALLOW_AGENT_AUDIO = true;
const SECTION_ORDER = 160;
const AUDIOGEN_GUIDANCE = "本机已安装 dsh-audiogen 插件（DSH AI 音频）：侧边栏「AI 音频」入口。能力：通过「渠道」对接多个音频生成厂商（OpenAI TTS、ElevenLabs、MiniMax、Stability Audio、自定义 OpenAI 兼容接口），支持 TTS 文本转语音、音乐生成和音效生成。API 地址与密钥在 GUI 设置中按渠道配置，密钥仅存于本机设置文档；生成请求由本地宿主代理转发。Agent 可直接调用 `generate_audio` 提交 TTS/音乐/音效任务，默认等待完成并返回同源音频 URL；可用 `manage_audio_voices` 浏览/筛选/删除厂商音色（MiniMax、ElevenLabs），也能用该工具的 action=recommend 按自然语言需求描述（如「清亮甜美的少女音」）让默认模型推荐 top-k 音色，再用选定音色的 voice_id 调用 `generate_audio` 生成。角色音色选角（小说/游戏配音 casting）：传角色画像（JSON 数组/对象，字段 character_id/character_name/gender/age_stage/voice_traits/personality_traits/appearance/sample_lines/dialogue_count/language；文本描述需先整理成该结构）调用 `manage_audio_voices` 的 action=cast，工具按性别/年龄/用途做确定性硬过滤（accent 为偏好、候选为空才放松）并返回每个角色的候选池，你在上下文中全局权衡主音色（lead/major 不复用）+ 备用音色后，用 action=save_cast 校验落盘（~/.dsh/dsh-audiogen/cast-selections.json），随后按选定 voice_id 生成 TTS；MiniMax 也可先用 `generate_audio(mode=voice_design)` 为角色创作专属音色再选角。限制：生成消耗上游 API 额度；音频内容由上游模型生成；模型只能使用用户在各渠道配置目录中的模型；音色管理仅 MiniMax 与 ElevenLabs 渠道支持。用户提到「音频 / 语音 / TTS / 配乐 / 音效 / AI 音频」时即指本插件，请据此协作。";
function guidanceFor(channels, defaultChannelId) {
	if (channels.length === 0) return `${AUDIOGEN_GUIDANCE} 尚未配置任何渠道：请先在「设置 → 插件 → AI 音频」添加渠道并填写 API 地址与密钥。`;
	const table = channels.map((channel) => {
		const aliases = channel.models.map((model) => model.alias).join("、");
		const mark = channel.id === defaultChannelId ? "（默认渠道）" : "";
		const key = channel.apiKey === "" ? "（未填密钥）" : "";
		const models = channel.models.length === 0 ? "未配置模型/音色" : `可用模型/音色：${aliases}`;
		return `渠道「${channel.name}」${mark}[${channel.apiUrl}] ${models}${key}`;
	}).join("；");
	return `${AUDIOGEN_GUIDANCE} 当前渠道与模型：${table}。`;
}
/**
* 把随包分发的技能（skills/<id>/SKILL.md，含 frontmatter）同步到 DSH 用户技能根
* `~/.dsh/skills/<id>/SKILL.md` —— DSH web 会话的 skill-filesystem（standard 等
* preset 行）会扫描用户根，使会话可直接触发这些技能。仅创建缺失文件，绝不覆盖
* 用户已有内容；任何失败仅告警，不影响插件本身。
*/
function syncBundledSkills() {
	try {
		const sourceRoot = join(dirname(dirname(fileURLToPath(import.meta.url))), "skills");
		if (existsSync(sourceRoot) !== true) return;
		const targetRoot = join(process.env.DSH_HOME ?? join(process.env.HOME ?? "", ".dsh"), "skills");
		for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
			if (entry.isDirectory() !== true) continue;
			const sourceFile = join(sourceRoot, entry.name, "SKILL.md");
			if (existsSync(sourceFile) !== true) continue;
			const targetDir = join(targetRoot, entry.name);
			const targetFile = join(targetDir, "SKILL.md");
			if (existsSync(targetFile)) continue;
			mkdirSync(targetDir, { recursive: true });
			copyFileSync(sourceFile, targetFile);
		}
	} catch {}
}
function normalizeChannels(value) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const item of value) {
		if (item === null || typeof item !== "object") continue;
		const raw = item;
		const id = typeof raw.id === "string" ? raw.id.trim() : "";
		if (id === "") continue;
		const models = [];
		if (Array.isArray(raw.models)) for (const entry of raw.models) {
			if (entry === null || typeof entry !== "object") continue;
			const record = entry;
			const alias = typeof record.alias === "string" ? record.alias.trim() : "";
			const upstream = typeof record.id === "string" ? record.id.trim() : "";
			if (alias === "") continue;
			models.push({
				alias,
				id: upstream === "" ? alias : upstream
			});
		}
		out.push({
			id,
			preset: typeof raw.preset === "string" ? raw.preset : "",
			name: typeof raw.name === "string" ? raw.name.trim() : "",
			apiUrl: typeof raw.apiUrl === "string" ? raw.apiUrl.trim() : "",
			models
		});
	}
	return out;
}
function apply(ctx, config) {
	syncBundledSkills();
	let current = () => config ?? {};
	const resolve = () => {
		const value = current() ?? {};
		const channels = normalizeChannels(value.channels);
		const secrets = { ...value.channelSecrets ?? {} };
		const named = channels.map((channel) => ({
			...channel,
			name: channel.name === "" ? audioPresetById(channel.preset)?.name ?? "未命名渠道" : channel.name
		}));
		const defaultChannelId = typeof value.defaultChannelId === "string" && named.some((channel) => channel.id === value.defaultChannelId) ? value.defaultChannelId : named[0]?.id ?? "";
		return {
			enabled: value.enabled ?? DEFAULT_ENABLED,
			announceToAgent: value.announceToAgent ?? DEFAULT_ANNOUNCE,
			allowAgentAudioGeneration: value.allowAgentAudioGeneration ?? DEFAULT_ALLOW_AGENT_AUDIO,
			channels: named.map((channel) => ({
				...channel,
				apiKey: typeof secrets[channel.id] === "string" ? secrets[channel.id] : ""
			})),
			defaultChannelId,
			defaultModel: typeof value.defaultModel === "string" ? value.defaultModel.trim() : "",
			enhanceModel: typeof value.enhanceModel === "string" ? value.enhanceModel.trim() : "",
			autoSaveToLibrary: value.autoSaveToLibrary === true,
			maxConcurrentGenerations: (() => {
				const rawMax = value.maxConcurrentGenerations;
				const parsedMax = typeof rawMax === "number" ? rawMax : typeof rawMax === "string" && rawMax.trim() !== "" ? Number(rawMax.trim()) : NaN;
				return Number.isFinite(parsedMax) ? Math.max(1, Math.min(20, Math.floor(parsedMax))) : DEFAULT_MAX_CONCURRENT;
			})()
		};
	};
	const budget = createGenerationBudget(() => resolve().maxConcurrentGenerations);
	const enhance = async (prompt, mode) => {
		const seam = ctx.get("settings");
		if (seam?.describe === void 0) throw new AudioGenError("设置服务不可用，无法增强提示词", "settings-unavailable");
		return enhancePromptText({
			settings: seam,
			llm: () => ctx.get("llm")
		}, prompt, mode, enhanceSelectionOf(resolve()));
	};
	/** 解析设置的增强模型（"provider|model"）；空/非法值返回 undefined = 跟随默认。 */
	const enhanceSelectionOf = (config) => {
		const raw = config.enhanceModel ?? "";
		const sep = raw.indexOf("|");
		if (sep <= 0 || sep >= raw.length - 1) return void 0;
		const provider = raw.slice(0, sep).trim();
		const model = raw.slice(sep + 1).trim();
		return provider !== "" && model !== "" ? {
			provider,
			model
		} : void 0;
	};
	const recommend = async (requirement, candidates, topK) => {
		const seam = ctx.get("settings");
		if (seam?.describe === void 0) throw new AudioGenError("设置服务不可用，无法推荐音色", "settings-unavailable");
		return recommendVoices({
			settings: seam,
			llm: () => ctx.get("llm")
		}, requirement, candidates, topK);
	};
	/** 读取「设置 → 模型」目录：各提供方 + 可广播的模型列表（增强模型下拉候选）。 */
	const llmModelOptions = async () => {
		const llm = ctx.get("llm");
		if (llm === void 0 || llm.listProviders === void 0 || llm.listModels === void 0) return [];
		const options = [];
		const directory = /* @__PURE__ */ new Map();
		if (llm.listConfigurableProviders !== void 0) {
			for (const entry of llm.listConfigurableProviders() ?? []) if (typeof entry.provider === "string" && entry.provider !== "" && typeof entry.displayName === "string") directory.set(entry.provider, entry.displayName);
		}
		for (const info of llm.listProviders() ?? []) {
			const provider = typeof info.id === "string" ? info.id : "";
			if (provider === "") continue;
			let models = [];
			try {
				models = await llm.listModels(provider) ?? [];
			} catch {
				models = [];
			}
			for (const model of models) {
				const id = typeof model.id === "string" ? model.id.trim() : "";
				if (id === "") continue;
				const name = typeof model.name === "string" && model.name.trim() !== "" ? model.name.trim() : id;
				options.push({
					provider,
					providerName: directory.get(provider) ?? provider,
					id,
					name
				});
			}
		}
		return options;
	};
	const channelsView = () => {
		const value = resolve();
		return {
			channels: value.channels,
			defaultChannelId: value.defaultChannelId
		};
	};
	ctx.inject(["settings", "webServer"], (sctx) => {
		const seam = sctx.get("settings");
		sctx.effect(() => {
			const disposers = makeRoutes({
				settings: seam,
				resolveChannels: channelsView,
				autoSave: () => resolve().autoSaveToLibrary,
				budget,
				enhance,
				recommend,
				llmModelOptions
			}).map((route) => ctx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-audiogen: routes");
	});
	ctx.inject(["tools"], (tctx) => {
		tctx.effect(() => registerAgentAudioTools(tctx, () => {
			const value = resolve();
			return {
				enabled: value.enabled,
				allowAgentAudioGeneration: value.allowAgentAudioGeneration,
				channels: value.channels,
				defaultChannelId: value.defaultChannelId,
				autoSaveToLibrary: value.autoSaveToLibrary,
				budget,
				enhance,
				recommend
			};
		}), "dsh-audiogen: agent audio tools");
	});
	let disposeSection;
	const sync = () => {
		if (disposeSection !== void 0) {
			disposeSection();
			disposeSection = void 0;
		}
		const value = resolve();
		if (!value.enabled || !value.announceToAgent) return;
		disposeSection = ctx.systemPrompt.section({
			name: "plugin:dsh-audiogen",
			order: SECTION_ORDER,
			text: guidanceFor(value.channels, value.defaultChannelId)
		});
	};
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, AudioGenSettingsNamespace, Config, config ?? {}, {
			setSource: (source) => {
				current = source;
				sync();
			},
			onChange: sync
		});
	});
	sync();
}
//#endregion
export { AUDIOGEN_GUIDANCE, AudioGenSettingsNamespace, Config, apply, inject, name };
