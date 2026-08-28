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
	if (request.mode === "voice_design" && !isMiniMax$1(channel)) throw new AudioGenError("音色设计当前仅支持 MiniMax 渠道", "voice-design-unsupported");
	if (isElevenLabs$1(channel)) return elevenLabs(channel, request, signal);
	if (isMiniMax$1(channel)) return minimax(channel, request, signal);
	if (isStability$1(channel)) return stabilityAudio(channel, request, signal);
	if (isOpenAICompatible(channel, request.mode)) return openAITTS(channel, request, signal);
	return genericAudio(channel, request, signal);
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
		hint: "ElevenLabs 语音合成（TTS）；建议点击「获取可用模型」拉取音色与模型",
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
			}
		]
	},
	{
		id: "stability-audio",
		name: "Stability AI（stable-audio）",
		apiUrl: "https://api.stability.ai/v2beta/audio",
		site: "https://stability.ai/stable-audio",
		hint: "Stability AI 音乐 / 音效生成（stable-audio 系列）",
		models: [{
			alias: "stable-audio-2.0",
			id: "stable-audio-2.0",
			category: "music"
		}, {
			alias: "stable-audio-1.0",
			id: "stable-audio-1.0",
			category: "music"
		}]
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
		...timbreWeights !== void 0 && timbreWeights.length > 0 ? { timbreWeights } : {}
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
					channelId: target.id,
					channel: target.name
				}
			};
		}
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
							url: `${AUDIO_API.file}/${encodeURIComponent(saved.file)}`,
							...output.voiceId === void 0 ? {} : { voiceId: output.voiceId }
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
					},
					voiceId: { type: "string" }
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
		description: "Generate audio with the configured audio provider. Supports text-to-speech, music generation, sound effects and MiniMax voice design. The tool call waits for the upstream result and returns same-origin audio URLs; pass those URLs to the user for playback or download. If multiple models are configured, first ask the user which one to use or pass model explicitly.",
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
			voice: {
				type: "string",
				description: "Optional voice id/name for TTS providers. Required for MiniMax TTS (e.g. male-qn-qingse, female-shaonv); fetch the account voices in Settings > Plugins > AI Audio."
			},
			preview_text: {
				type: "string",
				description: "Optional preview text for voice_design."
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
				description: "MiniMax TTS sample rate: 16000/24000/32000/44100/48000, default 32000 (audio_setting.sample_rate)."
			},
			bitrate: {
				type: "integer",
				description: "MiniMax TTS bitrate in bps: 64000-320000, default 128000 (audio_setting.bitrate)."
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
						voice_id: { type: "string" },
						weight: { type: "integer" }
					},
					required: ["voice_id", "weight"]
				},
				description: "MiniMax TTS dual-voice blend weights (timbre_weights)."
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
			const picked = mode === "voice_design" ? (() => {
				const usable = config.channels.filter((channel) => channel.apiUrl.trim() !== "" && channel.apiKey.trim() !== "");
				const target = usable.find((channel) => channel.id === config.defaultChannelId) ?? usable[0];
				if (target === void 0) throw new AudioGenError("No usable audio channel is configured for voice design.", "no-channel-available");
				return {
					channel: target,
					alias: "",
					upstream: ""
				};
			})() : resolveModel(config, args.model);
			const voiceModify = typeof args.voice_modify === "object" && args.voice_modify !== null ? (() => {
				const raw = args.voice_modify;
				const out = {};
				if (typeof raw.pitch === "number") out.pitch = raw.pitch;
				if (typeof raw.intensity === "number") out.intensity = raw.intensity;
				if (typeof raw.timbre === "number") out.timbre = raw.timbre;
				if (typeof raw.sound_effects === "string" && raw.sound_effects.trim() !== "") out.soundEffects = raw.sound_effects.trim();
				return Object.keys(out).length > 0 ? out : void 0;
			})() : void 0;
			const timbreWeights = Array.isArray(args.timbre_weights) ? args.timbre_weights.filter((item) => typeof item === "object" && item !== null && typeof item.voice_id === "string" && typeof item.weight === "number").map((item) => ({
				voiceId: item.voice_id.trim(),
				weight: item.weight
			})).filter((item) => item.voiceId !== "") : void 0;
			const request = {
				mode,
				model: picked.alias,
				upstream: picked.upstream,
				channelId: picked.channel.id,
				channel: picked.channel.name,
				prompt: args.prompt.trim(),
				...typeof args.voice === "string" && args.voice.trim() !== "" ? { voice: args.voice.trim() } : {},
				...typeof args.preview_text === "string" && args.preview_text.trim() !== "" ? { previewText: args.preview_text.trim() } : {},
				...typeof args.speed === "number" ? { speed: args.speed } : {},
				...typeof args.duration === "number" ? { duration: args.duration } : {},
				...typeof args.lyrics === "string" && args.lyrics.trim() !== "" ? { lyrics: args.lyrics.trim() } : {},
				...typeof args.is_instrumental === "boolean" ? { isInstrumental: args.is_instrumental } : {},
				...typeof args.format === "string" && args.format.trim() !== "" ? { format: args.format.trim() } : {},
				...typeof args.emotion === "string" && args.emotion.trim() !== "" ? { emotion: args.emotion.trim() } : {},
				...typeof args.vol === "number" && Number.isFinite(args.vol) ? { vol: args.vol } : {},
				...typeof args.pitch === "number" && Number.isFinite(args.pitch) ? { pitch: args.pitch } : {},
				...typeof args.text_normalization === "boolean" ? { textNormalization: args.text_normalization } : {},
				...typeof args.latex_read === "boolean" ? { latexRead: args.latex_read } : {},
				...Array.isArray(args.pronunciation_tone) && args.pronunciation_tone.length > 0 ? { pronunciationTone: args.pronunciation_tone.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) } : {},
				...typeof args.sample_rate === "number" && Number.isFinite(args.sample_rate) ? { sampleRate: args.sample_rate } : {},
				...typeof args.bitrate === "number" && Number.isFinite(args.bitrate) ? { bitrate: args.bitrate } : {},
				...typeof args.channel === "number" && Number.isFinite(args.channel) ? { audioChannel: args.channel } : {},
				...typeof args.force_cbr === "boolean" ? { forceCbr: args.force_cbr } : {},
				...typeof args.subtitle_enable === "boolean" ? { subtitleEnable: args.subtitle_enable } : {},
				...typeof args.aigc_watermark === "boolean" ? { aigcWatermark: args.aigc_watermark } : {},
				...typeof args.language_boost === "string" && args.language_boost.trim() !== "" ? { languageBoost: args.language_boost.trim() } : {},
				...voiceModify !== void 0 ? { voiceModify } : {},
				...timbreWeights !== void 0 && timbreWeights.length > 0 ? { timbreWeights } : {}
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
						bytes: saved.bytes,
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
							id: audio[index].id,
							b64: Buffer.from(output.data).toString("base64"),
							mime: audio[index].mime,
							bytes: audio[index].bytes,
							url: audio[index].url,
							...output.voiceId === void 0 ? {} : { voiceId: output.voiceId }
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
