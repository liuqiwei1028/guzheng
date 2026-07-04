import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { MAX_ANALYSIS_SECONDS } from "@/lib/audioReport";

const SAMPLE_RATE = 44100;

export async function decodeMediaBufferToMono(buffer, filename, maxDurationSeconds = MAX_ANALYSIS_SECONDS) {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    throw new Error("服务器未找到 ffmpeg，可安装 ffmpeg 或重新安装 ffmpeg-static");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "guzheng-media-"));
  const safeName = sanitizeFilename(filename || "upload.media");
  const inputPath = path.join(tempDir, safeName);

  try {
    await writeFile(inputPath, Buffer.from(buffer));
    const { stdout, stderr } = await runFfmpeg(ffmpegPath, [
      "-hide_banner",
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-t",
      String(maxDurationSeconds),
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "f32le",
      "pipe:1",
    ]);

    if (!stdout.length) {
      throw new Error("未检测到可用音频，请换一个音频文件重试");
    }

    const samples = bufferToFloat32(stdout);
    const analyzedDuration = samples.length / SAMPLE_RATE;
    const originalDuration = parseFfmpegDuration(stderr) || analyzedDuration;

    return {
      samples,
      sampleRate: SAMPLE_RATE,
      duration: analyzedDuration,
      originalDuration,
      wasTrimmed: originalDuration > maxDurationSeconds + 0.2,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  const candidates = [
    path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("音频解析超时，请尝试裁剪到 60 秒以内后重新上传"));
    }, 90_000);

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        reject(new Error(ffmpegErrorMessage(stderr)));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function bufferToFloat32(buffer) {
  const length = Math.floor(buffer.length / 4);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = buffer.readFloatLE(index * 4);
  }
  return samples;
}

function parseFfmpegDuration(stderr) {
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function ffmpegErrorMessage(stderr) {
  if (/Stream map '0:a:0' matches no streams/i.test(stderr)) {
    return "未检测到可用音频，请换一个音频文件重试";
  }
  if (/Invalid data found|moov atom not found|could not find/i.test(stderr)) {
    return "音频文件无法解析，请换用 M4A、MP3、WAV 或 FLAC";
  }
  return "音频解析失败，请换一个文件重试";
}

function sanitizeFilename(filename) {
  const base = path.basename(String(filename)).replace(/[^\w\u4e00-\u9fa5.-]+/g, "_");
  return base || "upload.media";
}
