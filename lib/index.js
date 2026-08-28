import { SettingsConflictError, installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
/** Host-mediated built-in provider catalog (channels the user can instantiate). */
const PRESETS_API = "/api/dsh-audiogen/presets";
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
	return value.split(";")[0].trim().toLowerCase();
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
function isElevenLabs(channel) {
	return isPreset(channel, "elevenlabs") || /elevenlabs/i.test(channel.apiUrl);
}
function isMiniMax(channel) {
	return isPreset(channel, "minimax") || /minimax/i.test(channel.apiUrl);
}
function isStability(channel) {
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
		"link"
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
		const base64 = findBase64Audio(parsed);
		if (base64 !== void 0 && base64.length > 0) {
			let data;
			try {
				data = new Uint8Array(Buffer.from(base64, "base64"));
			} catch {
				throw new AudioGenError("audio endpoint returned invalid base64", "audio-bad-response");
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
async function elevenLabs(channel, request, signal) {
	const base = endpointBase(channel.apiUrl);
	const model = (request.upstream ?? request.model) || "eleven_multilingual_v2";
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
		headers: {
			"xi-api-key": channel.apiKey.trim(),
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
async function minimax(channel, request, signal) {
	const base = endpointBase(channel.apiUrl);
	const endpoint = /\/t2a_v2(\?|$)/i.test(base) ? base : `${base}/t2a_v2`;
	const model = (request.upstream ?? request.model) || "speech-01-turbo";
	const voice = request.voice ?? request.model ?? "";
	const body = {
		model,
		text: request.prompt,
		stream: false,
		...voice === "" ? {} : { voice_setting: {
			voice_id: voice,
			...request.speed !== void 0 ? { speed: request.speed } : {},
			vol: 1,
			pitch: 0
		} },
		audio_setting: {
			format: request.format ?? "mp3",
			sample_rate: 32e3,
			bitrate: 128e3
		}
	};
	return normalizeAudioResponse(await fetchWithTimeout(endpoint, {
		method: "POST",
		redirect: "error",
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
async function stabilityAudio(channel, request, signal) {
	const base = endpointBase(channel.apiUrl);
	const endpoint = /\/generation(\?|$)/i.test(base) ? base : `${base}/generation`;
	const body = {
		model: (request.upstream ?? request.model) || "stable-audio-2.0",
		prompt: request.prompt,
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
	if (isElevenLabs(channel)) return elevenLabs(channel, request, signal);
	if (isMiniMax(channel)) return minimax(channel, request, signal);
	if (isStability(channel)) return stabilityAudio(channel, request, signal);
	if (isOpenAICompatible(channel, request.mode)) return openAITTS(channel, request, signal);
	return genericAudio(channel, request, signal);
}
//#endregion
//#region src/audio-presets.ts
const AUDIO_PRESETS = [
	{
		id: "openai-tts",
		name: "OpenAI · TTS",
		apiUrl: "https://api.openai.com/v1",
		hint: "OpenAI 官方语音合成接口（/audio/speech）",
		models: [
			{
				alias: "tts-1",
				id: "tts-1"
			},
			{
				alias: "tts-1-hd",
				id: "tts-1-hd"
			},
			{
				alias: "gpt-4o-mini-tts",
				id: "gpt-4o-mini-tts"
			}
		]
	},
	{
		id: "elevenlabs",
		name: "ElevenLabs",
		apiUrl: "https://api.elevenlabs.io/v1",
		hint: "ElevenLabs TTS；模型列表请填写你的 Voice ID（如 Rachel / Adam 等别名）",
		models: [
			{
				alias: "Rachel",
				id: "21m00Tcm4TlvDq8ikWAM"
			},
			{
				alias: "Adam",
				id: "pNInz6obpgDQGcFmaJgB"
			},
			{
				alias: "Antoni",
				id: "ErXwobaYiN019PkySvjV"
			},
			{
				alias: "Bella",
				id: "EXAVITQu4vr4xnSDxMaL"
			}
		]
	},
	{
		id: "minimax",
		name: "MiniMax",
		apiUrl: "https://api.minimax.chat/v1",
		hint: "MiniMax 语音合成（T2A）；需在 API URL 后按官方要求携带 GroupId 或使用完整接口地址",
		models: [
			{
				alias: "speech-01-turbo",
				id: "speech-01-turbo"
			},
			{
				alias: "speech-01-hd",
				id: "speech-01-hd"
			},
			{
				alias: "speech-02-turbo",
				id: "speech-02-turbo"
			},
			{
				alias: "speech-02-hd",
				id: "speech-02-hd"
			}
		]
	},
	{
		id: "stability-audio",
		name: "Stability AI · 音频",
		apiUrl: "https://api.stability.ai/v2beta/audio",
		hint: "Stability AI 音乐/音效生成（stable-audio 系列）",
		models: [{
			alias: "stable-audio-2.0",
			id: "stable-audio-2.0"
		}, {
			alias: "stable-audio-1.0",
			id: "stable-audio-1.0"
		}]
	},
	{
		id: "custom",
		name: "自定义渠道",
		apiUrl: "",
		hint: "任意兼容接口；支持 OpenAI 兼容 TTS，或返回音频字节 / JSON 的通用 POST",
		models: []
	}
];
/** Look up one built-in provider by id. */
function audioPresetById(id) {
	return AUDIO_PRESETS.find((preset) => preset.id === id);
}
//#endregion
//#region src/audio-store.ts
/**
* Host-side persistence for generated audio and generation history.
* Files live under ~/.dsh/dsh-audiogen/audio/; history is one JSON document.
*/
function dshHome() {
	return process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
}
const AUDIO_DATA_DIR = path.join(dshHome(), "dsh-audiogen", "audio");
const HISTORY_FILE = path.join(dshHome(), "dsh-audiogen", "history.json");
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
		...entry.speed === void 0 ? {} : { speed: entry.speed },
		...entry.duration === void 0 ? {} : { duration: entry.duration },
		...entry.format === void 0 ? {} : { format: entry.format },
		audio: entry.audio.map((audio) => ({
			url: audio.url,
			mime: audio.mime,
			...audio.duration === void 0 ? {} : { duration: audio.duration }
		})),
		...entry.channelId === void 0 ? {} : { channelId: entry.channelId },
		...entry.channel === void 0 ? {} : { channel: entry.channel }
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
//#endregion
//#region src/routes.ts
const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;
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
	const mode = body.mode === "music" ? "music" : body.mode === "sfx" ? "sfx" : "tts";
	const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
	if (prompt === "") return void 0;
	return {
		mode,
		model: typeof body.model === "string" ? body.model.trim() : "",
		prompt,
		...typeof body.voice === "string" && body.voice.trim() !== "" ? { voice: body.voice.trim() } : {},
		...typeof body.speed === "number" ? { speed: body.speed } : {},
		...typeof body.duration === "number" ? { duration: body.duration } : {},
		...typeof body.format === "string" && body.format.trim() !== "" ? { format: body.format.trim() } : {},
		...typeof body.channelId === "string" && body.channelId !== "" ? { channelId: body.channelId } : {}
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
					await deps.settings.mutate(settingsNamespace(ns), body.ops, expectedRevision);
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
				try {
					const outputs = await generateAudio(channel, request);
					const generated = [];
					for (const [index, output] of outputs.entries()) {
						const saved = await saveAudioFile(output.data, output.mime, `generated-${index + 1}`);
						generated.push({
							id: saved.id,
							b64: Buffer.from(output.data).toString("base64"),
							mime: saved.mime,
							bytes: saved.bytes,
							url: `${AUDIO_API.file}/${encodeURIComponent(saved.file)}`
						});
					}
					let history;
					try {
						history = await appendHistory({
							id: randomUUID(),
							createdAt: Date.now(),
							mode: request.mode,
							model: request.model,
							prompt: request.prompt,
							...request.voice === void 0 ? {} : { voice: request.voice },
							...request.speed === void 0 ? {} : { speed: request.speed },
							...request.duration === void 0 ? {} : { duration: request.duration },
							...request.format === void 0 ? {} : { format: request.format },
							audio: generated,
							...request.channelId === void 0 ? {} : { channelId: request.channelId },
							...request.channel === void 0 ? {} : { channel: request.channel }
						});
					} catch (error) {
						writeJson(res, 200, {
							ok: true,
							outputs: generated,
							historyError: messageOf(error)
						});
						return;
					}
					writeJson(res, 200, {
						ok: true,
						outputs: generated,
						history
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						code: error instanceof AudioGenError ? error.code : "generate-failed",
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
//#region src/agent-audio-tools.ts
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
				"sfx"
			]
		},
		model: {
			type: "string",
			required: true
		},
		audio: {
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
					}
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
/** Register the Agent audio tool. */
function registerAgentAudioTools(ctx, resolve) {
	return ctx.tools.register(defineTool({
		name: "generate_audio",
		description: "Generate audio with the configured audio provider. Supports text-to-speech, music generation and sound effects. The tool call waits for the upstream result and returns same-origin audio URLs; pass those URLs to the user for playback or download. If multiple models are configured, first ask the user which one to use or pass model explicitly.",
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
					"sfx"
				],
				description: "Generation mode. Defaults to tts."
			},
			model: {
				type: "string",
				description: "One of the configured audio models/voices. Defaults to the first configured model."
			},
			voice: {
				type: "string",
				description: "Optional voice id/name for TTS providers."
			},
			speed: {
				type: "number",
				description: "Optional speaking rate / speed multiplier where supported."
			},
			duration: {
				type: "number",
				description: "Requested duration in seconds for music/sfx."
			},
			format: {
				type: "string",
				description: "Output format such as mp3 or wav."
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
			const picked = resolveModel(config, args.model);
			const request = {
				mode: args.mode === "music" ? "music" : args.mode === "sfx" ? "sfx" : "tts",
				model: picked.alias,
				upstream: picked.upstream,
				channelId: picked.channel.id,
				channel: picked.channel.name,
				prompt: args.prompt.trim(),
				...typeof args.voice === "string" && args.voice.trim() !== "" ? { voice: args.voice.trim() } : {},
				...typeof args.speed === "number" ? { speed: args.speed } : {},
				...typeof args.duration === "number" ? { duration: args.duration } : {},
				...typeof args.format === "string" && args.format.trim() !== "" ? { format: args.format.trim() } : {}
			};
			try {
				const outputs = await generateAudio(picked.channel, request, exec.signal);
				const audio = [];
				for (const [index, output] of outputs.entries()) {
					const saved = await saveAudioFile(output.data, output.mime, `generated-${index + 1}`);
					audio.push({
						id: saved.id,
						url: `/api/dsh-audiogen/audio/${encodeURIComponent(saved.file)}`,
						mime: saved.mime,
						bytes: saved.bytes
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
						...request.speed === void 0 ? {} : { speed: request.speed },
						...request.duration === void 0 ? {} : { duration: request.duration },
						...request.format === void 0 ? {} : { format: request.format },
						audio: outputs.map((output, index) => ({
							id: audio[index].id,
							b64: Buffer.from(output.data).toString("base64"),
							mime: audio[index].mime,
							bytes: audio[index].bytes,
							url: audio[index].url
						})),
						channelId: picked.channel.id,
						channel: picked.channel.name
					});
				} catch {}
				return {
					status: "completed",
					message: "Audio generation completed. The audio files can be played/downloaded from the returned URLs.",
					mode: request.mode,
					model: picked.alias,
					audio
				};
			} catch (error) {
				if (exec.signal?.aborted === true) throw error;
				return {
					status: "failed",
					message: "Audio generation failed.",
					mode: request.mode,
					model: picked.alias,
					audio: [],
					error: error instanceof Error ? error.message : String(error)
				};
			}
		}
	}));
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "audiogen";
/** Services required before the surfaces can mount. */
const inject = ["webServer", "systemPrompt"];
/** The branded settings namespace of this plugin. */
const AudioGenSettingsNamespace = settingsNamespace(AUDIOGEN_SETTINGS_NAMESPACE);
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
	defaultModel: z.string().default("")
});
const DEFAULT_ENABLED = true;
const DEFAULT_ANNOUNCE = true;
const DEFAULT_ALLOW_AGENT_AUDIO = true;
const SECTION_ORDER = 160;
const AUDIOGEN_GUIDANCE = "本机已安装 dsh-audiogen 插件（DSH AI 音频）：侧边栏「AI 音频」入口。能力：通过「渠道」对接多个音频生成厂商（OpenAI TTS、ElevenLabs、MiniMax、Stability Audio、自定义 OpenAI 兼容接口），支持 TTS 文本转语音、音乐生成和音效生成。API 地址与密钥在 GUI 设置中按渠道配置，密钥仅存于本机设置文档；生成请求由本地宿主代理转发。Agent 可直接调用 `generate_audio` 提交 TTS/音乐/音效任务，默认等待完成并返回同源音频 URL。限制：生成消耗上游 API 额度；音频内容由上游模型生成；模型只能使用用户在各渠道配置目录中的模型。用户提到「音频 / 语音 / TTS / 配乐 / 音效 / AI 音频」时即指本插件，请据此协作。";
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
			defaultModel: typeof value.defaultModel === "string" ? value.defaultModel.trim() : ""
		};
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
				resolveChannels: channelsView
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
				defaultChannelId: value.defaultChannelId
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
	installSettingsSection(ctx, AudioGenSettingsNamespace, Config, config ?? {}, {
		setSource: (source) => {
			current = source;
			sync();
		},
		onChange: sync
	});
	sync();
}
//#endregion
export { AUDIOGEN_GUIDANCE, AudioGenSettingsNamespace, Config, apply, inject, name };
