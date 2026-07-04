import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

import {
  MAX_ANALYSIS_SECONDS,
  SEGMENT_SECONDS,
  analyzeSegments,
  assessGuzhengLikelihood,
  buildRejectedReport,
  buildReport,
  createReferenceProfile,
  extractFeatures,
  parseSampleName,
  referenceSamples,
} from "@/lib/audioReport";
import { decodeMediaBufferToMono } from "@/lib/serverMediaAudio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 220 * 1024 * 1024;
let referenceProfilesPromise = null;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "缺少媒体文件" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "文件过大，请上传 220MB 以内的视频或音频" }, { status: 413 });
    }

    const filename = file.name || "upload.media";
    const sampleMeta = parseSampleName(filename);
    const buffer = await file.arrayBuffer();
    const mono = await decodeMediaBufferToMono(buffer, filename, MAX_ANALYSIS_SECONDS);
    const features = extractFeatures(mono.samples, mono.sampleRate, mono.duration);
    const segmentAnalyses = analyzeSegments(mono.samples, mono.sampleRate, mono.duration, SEGMENT_SECONDS);
    const referenceProfiles = await getServerReferenceProfiles();
    const guzhengCheck = assessGuzhengLikelihood(features, referenceProfiles);

    if (!sampleMeta && !guzhengCheck.isGuzheng) {
      const rejected = buildRejectedReport(filename, guzhengCheck);
      return NextResponse.json({
        report: rejected,
        waveform: { waveform: features.waveform, envelope: features.envelope },
        spectrum: features.spectrum,
        media: buildMediaMeta(mono, "server-ffmpeg"),
      });
    }

    const report = buildReport(features, filename, sampleMeta, guzhengCheck, {
      segmentAnalyses,
      analyzedDuration: mono.duration,
      originalDuration: mono.originalDuration,
      wasTrimmed: mono.wasTrimmed,
    });

    return NextResponse.json({
      report,
      waveform: { waveform: features.waveform, envelope: features.envelope },
      spectrum: features.spectrum,
      media: buildMediaMeta(mono, "server-ffmpeg"),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "媒体解析失败" }, { status: 500 });
  }
}

async function getServerReferenceProfiles() {
  if (!referenceProfilesPromise) {
    referenceProfilesPromise = Promise.all(
      referenceSamples.map(async (sample) => {
        const filePath = path.join(process.cwd(), "public", "voices", sample.file);
        const buffer = await readFile(filePath);
        const mono = await decodeMediaBufferToMono(buffer, sample.file, MAX_ANALYSIS_SECONDS);
        const features = extractFeatures(mono.samples, mono.sampleRate, mono.duration);
        return createReferenceProfile(features, sample);
      }),
    ).catch((error) => {
      referenceProfilesPromise = null;
      console.warn("服务端参考声纹初始化失败，将使用规则预检。", error);
      return [];
    });
  }
  return referenceProfilesPromise;
}

function buildMediaMeta(mono, source) {
  return {
    source,
    analyzedDuration: Number(mono.duration.toFixed(1)),
    originalDuration: Number(mono.originalDuration.toFixed(1)),
    wasTrimmed: mono.wasTrimmed,
  };
}
