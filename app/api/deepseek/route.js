import { NextResponse } from "next/server";

const AI_ENDPOINT = "https://api.deepseek.com/chat/completions";

export async function POST(request) {
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
              "你是古筝音色鉴赏师。请基于结构化音频特征写专业、克制、可读的中文报告。不要编造具体品牌，不要承诺声学绝对结论。输出分成 4-5 个自然段，每段有明确结论。",
          },
          {
            role: "user",
            content: `请分析这段古筝音频。要求：分维度阐述清亮度、共鸣厚度、颗粒质感、动态层次、频谱结构、曲风适配，最后给综合评价。控制在 450-650 字。\n\n音频特征：${JSON.stringify(
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

function buildFallbackReport(context) {
  const { dimensionScores, dynamicDb, resonanceSeconds, spectralCentroidHz, lowRatio, midRatio, highRatio } = context;
  const resonanceGood = dimensionScores.resonance >= 84;
  const dynamicGood = dynamicDb >= 15;
  const tailGood = resonanceSeconds >= 4.2;

  return [
    `综合来看，这段声音的核心优势在于${resonanceGood ? "共鸣延展和声底稳定性" : "清晰的音头与自然的声部过渡"}。三项主评分中，清亮度 ${dimensionScores.brightness} 分，共鸣厚度 ${dimensionScores.resonance} 分，颗粒质感 ${dimensionScores.texture} 分，整体呈现出${context.inferredWood}取向的声学性格。`,
    `频谱方面，重心约 ${spectralCentroidHz} Hz，低频占比 ${Math.round(lowRatio * 100)}%，中频占比 ${Math.round(midRatio * 100)}%，高频占比 ${Math.round(highRatio * 100)}%。这说明声音并非单纯追求亮度，而是在泛音明度、木质厚度和中频支撑之间形成当前平衡。动态范围约 ${dynamicDb} dB，${dynamicGood ? "强弱对比具备舞台表达空间" : "层次变化较温和，适合细腻表达"}。`,
    `共鸣时间约 ${resonanceSeconds} 秒，${tailGood ? "尾音有较好的留白和空间感" : "尾音收束较快，声音干净但气息略短"}。曲风上更适合${context.styleFit} 综合评价：这张琴的声音气质清雅、辨识度较高，适合以音色细节和余韵审美取胜；若用于大动态曲风，需要进一步关注低频承托和高频锐度控制。`,
  ].join("\n\n");
}
