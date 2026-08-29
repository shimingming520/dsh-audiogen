import { SettingsConflictError, installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path, { dirname, join } from "node:path";
import z from "schemastery";
import { randomUUID } from "node:crypto";
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
/** Host-mediated model/voice discovery endpoint. */
const MODEL_API = { discover: "/api/dsh-audiogen/models/discover" };
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
function isElevenLabs$1(channel) {
	return isPreset(channel, "elevenlabs") || /elevenlabs/i.test(channel.apiUrl);
}
function isMiniMax$1(channel) {
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
async function elevenLabs(channel, request, signal) {
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
		const body = {
			model_id: (request.upstream ?? request.model) || "music_v1",
			prompt: request.prompt,
			...request.duration !== void 0 && Number.isFinite(request.duration) ? { music_length_ms: Math.round(Math.min(6e5, Math.max(3e3, request.duration * 1e3))) } : {},
			...request.lyrics !== void 0 && request.lyrics.trim() !== "" ? { lyrics_text: request.lyrics.trim() } : {},
			...request.isInstrumental !== void 0 ? { force_instrumental: request.isInstrumental } : {}
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
		const body = {
			text: request.prompt,
			model_id: sfxModel,
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
		if (lyrics === "" && request.isInstrumental !== true) throw new AudioGenError("MiniMax 音乐生成需要歌词（lyrics 参数），或在「纯音乐」模式（is_instrumental=true）下生成；也可让面板/Agent 先为提示词创作一段歌词。", "lyrics-required");
		const endpoint = `${base}/music_generation`;
		const body = {
			model,
			prompt: request.prompt,
			...lyrics === "" ? {} : { lyrics },
			...request.isInstrumental !== void 0 ? { is_instrumental: request.isInstrumental } : {},
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
	if (request.mode === "voice_design" && !isMiniMax$1(channel) && !isElevenLabs$1(channel)) throw new AudioGenError("音色设计当前仅支持 MiniMax（/v1/voice_design）与 ElevenLabs（/v1/text-to-voice/design）渠道", "voice-design-unsupported");
	if (isElevenLabs$1(channel)) return elevenLabs(channel, request, signal);
	if (isMiniMax$1(channel)) return minimax(channel, request, signal);
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
/** 读取 Agent 默认模型并调用 LLM 增强，返回增强后的文本。 */
async function enhancePromptText(deps, prompt, mode) {
	const text = prompt.trim();
	if (text === "") throw new AudioGenError("提示词为空，无法增强", "enhance-empty-prompt");
	const value = (deps.settings.describe({ redactSecrets: true }) ?? []).find((candidate) => String(candidate.ns) === "agent-default-model")?.value ?? {};
	const provider = typeof value.provider === "string" && value.provider.trim() !== "" ? value.provider.trim() : "";
	const model = typeof value.model === "string" && value.model.trim() !== "" ? value.model.trim() : "";
	if (provider === "" || model === "") throw new AudioGenError("未找到 Agent 默认模型（agent-default-model）：请先在「设置 → 模型」中配置默认模型", "no-default-model");
	const runtime = deps.llm?.();
	if (runtime === void 0 || runtime.stream === void 0) throw new AudioGenError("宿主 LLM 服务不可用（ctx.llm 未注册）", "llm-unavailable");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), 3e4);
	timer.unref?.();
	let output = "";
	try {
		for await (const chunk of runtime.stream({
			provider,
			model,
			messages: [{
				role: "user",
				content: text
			}],
			system: instructionsFor(mode),
			temperature: .7,
			maxTokens: 1200,
			signal: controller.signal
		})) {
			const record = chunk;
			if (record.type === "text-delta" && typeof record.text === "string") output += record.text;
			else if (record.type === "block-end" && record.block !== void 0 && record.block.type === "text" && typeof record.block.text === "string") output += record.block.text;
		}
	} finally {
		clearTimeout(timer);
	}
	const result = stripFences(output.trim());
	if (result === "") throw new AudioGenError("模型未返回增强内容：请检查「设置 → 模型」的默认模型是否可用（或稍后重试）", "enhance-empty-result");
	return result;
}
/** 去掉模型可能包裹的 ``` 代码围栏。 */
function stripFences(value) {
	if (value === "") return value;
	return value.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
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
function provenanceOf(request, apiUrl) {
	return {
		mode: request.mode,
		prompt: request.prompt,
		...request.channel === void 0 ? {} : { channel: request.channel },
		...request.channelId === void 0 ? {} : { channelId: request.channelId },
		...apiUrl === "" ? {} : { apiUrl },
		...request.model === void 0 || request.model === "" ? {} : { model: request.model },
		...request.upstream === void 0 || request.upstream === "" ? {} : { upstream: request.upstream },
		...request.voice === void 0 ? {} : { voice: request.voice },
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
		...given.voiceId !== void 0 || entry?.voiceId !== void 0 ? { voiceId: given.voiceId ?? entry?.voiceId } : {},
		...given.params !== void 0 || params !== void 0 ? { params: given.params ?? params } : {}
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
							provenance: provenanceOf(request, channel.apiUrl)
						});
						resources = [{
							id: entry.id,
							name: entry.name,
							type: entry.type
						}];
					} catch {}
					writeJson(res, 200, {
						ok: true,
						outputs: generated,
						history,
						...resources === void 0 ? {} : { resources }
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
				description: "Output format such as mp3 or wav. MiniMax music supports mp3/wav/pcm."
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
				description: "MiniMax sample rate: music 16000/24000/32000/44100 (default 44100); tts default 32000 (audio_setting.sample_rate)."
			},
			bitrate: {
				type: "integer",
				description: "MiniMax bitrate in bps: 32000/64000/128000/256000 (music default 256000, tts default 128000; audio_setting.bitrate)."
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
	return () => {
		disposer();
		searchDisposer();
	};
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "audiogen";
/** Services required before the surfaces can mount. */
const inject = ["webServer", "systemPrompt"];
/** The branded settings namespace of this plugin. */
const AudioGenSettingsNamespace = settingsNamespace(AUDIOGEN_SETTINGS_NAMESPACE);
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
	maxConcurrentGenerations: z.union([z.number(), z.string()]).default(DEFAULT_MAX_CONCURRENT)
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
		}, prompt, mode);
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
				enhance
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
				enhance
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
