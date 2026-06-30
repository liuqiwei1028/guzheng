import { NextResponse } from "next/server";

const AI_ENDPOINT = "https://api.deepseek.com/chat/completions";
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitBuckets = new Map();

export async function POST(request) {
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(clientIp);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: `AI 报告生成过于频繁，请 ${rateLimit.retryAfterSeconds} 秒后再试。`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON" }, { status: 400 });
  }

  const context = payload?.context;
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!context) {
    return NextResponse.json({ error: "缺少音色分析上下文" }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({
      source: "local-fallback",
      report: buildFallbackReport(context),
      warning: "未配置 AI API Key，已使用本地兜底报告。",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        temperature: 0.55,
        messages: [
          {
            role: "system",
            content:
              "你是古筝音色鉴赏师。请基于结构化音频特征写专业、克制、可读的中文报告。不要编造具体品牌，不要承诺声学绝对结论。不要使用 Markdown 标题、星号或项目符号，输出分成 4-5 个自然段，每段有明确结论。",
          },
          {
            role: "user",
            content: `请分析这段古筝音频。要求：分维度阐述清亮度、共鸣厚度、颗粒质感、动态层次、频谱结构、曲风适配，最后给综合评价。请重点解读 spectrumDetail、lowRatio、midRatio、highRatio、spectralCentroidHz 和 segmentAnalyses，说明每 10 秒一段的音色变化趋势。若 analysisWindow.trimmedToFirst60Seconds 为 true，请说明只分析了前 60 秒。控制在 450-650 字。\n\n音频特征：${JSON.stringify(
              context,
              null,
              2,
            )}`,
          },
        ],
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({
        source: "local-fallback",
        report: buildFallbackReport(context),
        warning: `AI API 返回失败：HTTP ${response.status} ${errorText.slice(0, 180)}`,
      });
    }

    const data = await response.json();
    const report = data.choices?.[0]?.message?.content?.trim();

    return NextResponse.json({
      source: report ? "deepseek" : "local-fallback",
      report: report || buildFallbackReport(context),
      warning: report ? "" : "AI 未返回正文，已使用本地兜底报告。",
    });
  } catch (error) {
    clearTimeout(timeout);
    return NextResponse.json({
      source: "local-fallback",
      report: buildFallbackReport(context),
      warning:
        error.name === "AbortError"
          ? "AI 请求超时，已使用本地兜底报告。"
          : `AI 请求失败：${error.message}`,
    });
  }
}

function getClientIp(request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || "local";
}

function checkRateLimit(clientIp) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(clientIp) || [];
  const recent = bucket.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - recent[0])) / 1000);
    rateLimitBuckets.set(clientIp, recent);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  recent.push(now);
  rateLimitBuckets.set(clientIp, recent);

  if (rateLimitBuckets.size > 1000) {
    for (const [ip, timestamps] of rateLimitBuckets) {
      const alive = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
      if (alive.length) rateLimitBuckets.set(ip, alive);
      else rateLimitBuckets.delete(ip);
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

function buildFallbackReport(context) {
  const { dimensionScores, dynamicDb, resonanceSeconds, spectralCentroidHz, lowRatio, midRatio, highRatio } = context;
  const resonanceGood = dimensionScores.resonance >= 84;
  const dynamicGood = dynamicDb >= 15;
  const tailGood = resonanceSeconds >= 4.2;
  const segments = Array.isArray(context.segmentAnalyses) ? context.segmentAnalyses : [];
  const segmentSummary = segments.length
    ? segments
        .map((segment) => `${segment.startSecond}-${segment.endSecond}s ${segment.summary}，频谱重心 ${segment.centroidHz} Hz`)
        .join("；")
    : "暂无可用分段数据";
  const windowText = context.analysisWindow?.trimmedToFirst60Seconds
    ? `本次仅分析前 ${context.analysisWindow.analyzedSeconds} 秒，原音频约 ${context.analysisWindow.originalSeconds} 秒。`
    : "";

  return [
    `综合来看，这段声音的核心优势在于${resonanceGood ? "共鸣延展和声底稳定性" : "清晰的音头与自然的声部过渡"}。三项主评分中，清亮度 ${dimensionScores.brightness} 分，共鸣厚度 ${dimensionScores.resonance} 分，颗粒质感 ${dimensionScores.texture} 分，整体呈现出${context.inferredWood}取向的声学性格。${windowText}`,
    `频谱方面，重心约 ${spectralCentroidHz} Hz，低频占比 ${Math.round(lowRatio * 100)}%，中频占比 ${Math.round(midRatio * 100)}%，高频占比 ${Math.round(highRatio * 100)}%。${context.spectrumDetail || "这说明声音在泛音明度、木质厚度和中频支撑之间形成当前平衡。"}动态范围约 ${dynamicDb} dB，${dynamicGood ? "强弱对比具备舞台表达空间" : "层次变化较温和，适合细腻表达"}。`,
    `分段观察：${segmentSummary}。这些变化可以帮助判断音色是否在连续演奏中保持稳定，也能看出高频亮度与尾音支撑是否随段落发生漂移。`,
    `共鸣时间约 ${resonanceSeconds} 秒，${tailGood ? "尾音有较好的留白和空间感" : "尾音收束较快，声音干净但气息略短"}。曲风上更适合${context.styleFit} 综合评价：这张琴的声音气质清雅、辨识度较高，适合以音色细节和余韵审美取胜；若用于大动态曲风，需要进一步关注低频承托和高频锐度控制。`,
  ].join("\n\n");
}
