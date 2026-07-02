export const MAX_ANALYSIS_SECONDS = 60;
export const SEGMENT_SECONDS = 10;

export const referenceSamples = [
  {
    price: 5000,
    wood: "红木",
    tone: "入门演奏级，音头直接、亮度清楚，适合作为基础颗粒感与触弦稳定性的参考。",
  },
  {
    price: 8000,
    wood: "桐木",
    tone: "声音轻快直接，响应灵敏，中低音开始有一定承托，适合作为入门进阶阶段的均衡参考。",
  },
  {
    price: 10000,
    wood: "黑檀木",
    tone: "高音保持清透，中低频更稳，音头和尾音之间的衔接更自然。",
  },
  {
    price: 13000,
    wood: "黑胡桃木",
    tone: "中频圆润度和木质纹理更清楚，泛音边缘收束较自然，整体听感比基础档更稳。",
  },
  {
    price: 16000,
    wood: "紫檀木",
    tone: "颗粒独立、出音滑润，音与音之间的边界清楚，适合快速指序和轻巧段落。",
  },
  {
    price: 17000,
    wood: "非洲柚木",
    tone: "声底饱满，尾音偏暖，整体听感沉稳，慢板和抒情段落更容易铺开。",
  },
  {
    price: 20000,
    wood: "阔叶黄檀",
    tone: "共鸣、厚度与穿透力较平衡，中低音过渡自然，舞台独奏的空间感更足。",
  },
  {
    price: 70000,
    wood: "老红木",
    tone: "收藏级取向，声场完整、质感细腻，强弱层次和余韵都更从容。",
  },
].map((sample) => ({
  ...sample,
  file: `${sample.price}.flac`,
  path: `/voices/${sample.price}.flac`,
}));

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatMoney(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function parseSampleName(name) {
  const price = Number(name.replace(/\.[^.]+$/, "").match(/\d+/)?.[0]);
  if (!price) return null;
  return referenceSamples.find((sample) => sample.price === price) || null;
}

export function mixToMono(audioBuffer, maxDurationSeconds = MAX_ANALYSIS_SECONDS) {
  const sourceLength = Math.min(audioBuffer.length, Math.floor(audioBuffer.sampleRate * maxDurationSeconds));
  const maxPoints = 180000;
  const stride = Math.max(1, Math.ceil(sourceLength / maxPoints));
  const total = Math.ceil(sourceLength / stride);
  const samples = new Float32Array(total);

  for (let i = 0; i < total; i += 1) {
    const sourceIndex = i * stride;
    let sum = 0;
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      sum += audioBuffer.getChannelData(channel)[sourceIndex] || 0;
    }
    samples[i] = sum / audioBuffer.numberOfChannels;
  }

  return {
    samples,
    sampleRate: audioBuffer.sampleRate / stride,
    duration: sourceLength / audioBuffer.sampleRate,
    wasTrimmed: audioBuffer.duration > maxDurationSeconds,
    originalDuration: audioBuffer.duration,
  };
}

export function extractFeatures(samples, sampleRate, duration) {
  let sumSquares = 0;
  let peak = 0;
  let zeroCrossings = 0;
  const waveform = sampleWaveform(samples, 960);

  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (i > 0 && Math.sign(value) !== Math.sign(samples[i - 1])) {
      zeroCrossings += 1;
    }
  }

  const envelope = buildEnvelope(samples, sampleRate);
  const sortedEnvelope = [...envelope.values].sort((a, b) => a - b);
  const p20 = percentile(sortedEnvelope, 0.2);
  const p50 = percentile(sortedEnvelope, 0.5);
  const p85 = percentile(sortedEnvelope, 0.85);
  const p95 = percentile(sortedEnvelope, 0.95);
  const dynamicDb = clamp(20 * Math.log10((p95 + 0.00001) / (p20 + 0.00001)), 5, 28);
  const resonance = estimateResonance(envelope, sampleRate, duration);
  const spectrum = computeSpectrum(samples, sampleRate);
  const transientRatio = clamp(p95 / (p50 + 0.00001), 1, 12);
  const pluckContrast = clamp(p85 / (p20 + 0.00001), 1, 18);
  const centroidLift = (spectrum.centroid - 550) / 30;
  const highPresence = spectrum.highRatio * 58;
  const lowMasking = spectrum.lowRatio * 22;
  const brightness = clamp(34 + centroidLift + highPresence + transientRatio * 2.2 - lowMasking, 28, 98);
  const warmth = clamp(spectrum.lowRatio * 72 + spectrum.midRatio * 38 + resonance * 3.5, 16, 98);
  const purity = clamp(96 - (zeroCrossings / samples.length) * 98 + spectrum.midRatio * 16, 35, 98);
  const body = clamp(spectrum.lowRatio * 62 + spectrum.midRatio * 34 + dynamicDb * 0.75, 16, 97);
  const noise = clamp((zeroCrossings / samples.length) * 120, 0, 34);

  return {
    rms: Math.sqrt(sumSquares / Math.max(samples.length, 1)),
    peak,
    dynamicDb,
    resonance,
    spectrum,
    waveform,
    envelope,
    brightness,
    warmth,
    purity,
    body,
    noise,
    transientRatio,
    pluckContrast,
    duration,
  };
}

export function analyzeSegments(samples, sampleRate, duration, segmentSeconds = SEGMENT_SECONDS) {
  const segmentLength = Math.max(1, Math.floor(sampleRate * segmentSeconds));
  const totalSegments = Math.max(1, Math.ceil(samples.length / segmentLength));
  return Array.from({ length: totalSegments }, (_, index) => {
    const start = index * segmentLength;
    const end = Math.min(samples.length, start + segmentLength);
    const segmentSamples = samples.slice(start, end);
    const startSecond = index * segmentSeconds;
    const endSecond = Math.min(duration, startSecond + segmentSeconds);
    const features = extractFeatures(segmentSamples, sampleRate, Math.max(0.1, endSecond - startSecond));
    const scores = buildDimensionScores(features);
    return {
      index: index + 1,
      startSecond: Math.round(startSecond),
      endSecond: Math.round(endSecond),
      balance: scores.balance,
      purity: scores.purity,
      brightness: scores.brightness,
      resonance: scores.resonance,
      texture: scores.texture,
      control: scores.control,
      dynamicDb: Number(features.dynamicDb.toFixed(1)),
      resonanceSeconds: Number(features.resonance.toFixed(1)),
      centroidHz: Math.round(features.spectrum.centroid),
      lowRatio: Number(features.spectrum.lowRatio.toFixed(3)),
      midRatio: Number(features.spectrum.midRatio.toFixed(3)),
      highRatio: Number(features.spectrum.highRatio.toFixed(3)),
      summary: summarizeSegment(features),
    };
  });
}

export function createReferenceProfile(features, sample) {
  return {
    price: sample.price,
    wood: sample.wood,
    centroid: features.spectrum.centroid,
    lowRatio: features.spectrum.lowRatio,
    midRatio: features.spectrum.midRatio,
    highRatio: features.spectrum.highRatio,
    resonance: features.resonance,
    dynamicDb: features.dynamicDb,
    brightness: features.brightness,
    warmth: features.warmth,
    purity: features.purity,
    body: features.body,
    transientRatio: features.transientRatio,
    pluckContrast: features.pluckContrast,
  };
}

export function assessGuzhengLikelihood(features, referenceProfiles = []) {
  if (features.duration < 1.2 || features.rms < 0.002 || features.peak < 0.01) {
    return {
      isGuzheng: false,
      score: 12,
      reasons: ["音频过短或音量过低，无法可靠识别古筝音色。"],
    };
  }

  let heuristic = 0;
  const reasons = [];
  const centroid = features.spectrum.centroid;

  if (centroid >= 450 && centroid <= 2600) heuristic += 16;
  else reasons.push("频谱重心偏离常见古筝拨弦区间。");

  if (features.spectrum.midRatio >= 0.2 && features.spectrum.midRatio <= 0.58) heuristic += 14;
  else reasons.push("中频能量分布与古筝样本差异较大。");

  if (features.spectrum.highRatio >= 0.05 && features.spectrum.highRatio <= 0.48) heuristic += 12;
  else reasons.push("高频泛音比例异常。");

  if (features.resonance >= 2.1 && features.resonance <= 6.6) heuristic += 13;
  else reasons.push("尾音衰减不像古筝弦体共鸣。");

  if (features.dynamicDb >= 8 && features.dynamicDb <= 28) heuristic += 12;
  else reasons.push("动态范围不符合拨弦类乐器特征。");

  if (features.transientRatio >= 1.8 && features.pluckContrast >= 2.3) heuristic += 13;
  else reasons.push("音头和衰减对比不足，缺少拨弦瞬态。");

  if (features.purity >= 48 && features.noise <= 32) heuristic += 10;
  else reasons.push("噪声或连续性特征偏离古筝独奏。");

  if (features.body >= 30 && features.warmth >= 28) heuristic += 10;
  else reasons.push("木质厚度与低中频支撑不足。");

  const similarity = referenceProfiles.length ? compareToReferences(features, referenceProfiles) : heuristic;
  const score = Math.round(clamp(referenceProfiles.length ? similarity * 0.4 + heuristic * 0.6 : heuristic, 0, 100));
  const threshold = referenceProfiles.length ? 45 : 38;

  return {
    isGuzheng: score >= threshold,
    score,
    reasons: reasons.slice(0, 3),
  };
}

export function buildReport(features, sourceName, sampleMeta, guzhengCheck, options = {}) {
  const matchedSample = sampleMeta || nearestReference(features);
  const dimensionScores = buildDimensionScores(features);
  const objectiveScore =
    dimensionScores.balance * 0.28 +
    dimensionScores.purity * 0.26 +
    dimensionScores.resonance * 0.26 +
    dimensionScores.control * 0.2;
  const score = Math.round(clamp(objectiveScore + (sampleMeta?.price ? priceToBonus(sampleMeta.price) * 0.35 : 0), 42, 98));
  const wood = inferWood(features, matchedSample);
  const traits = inferTraits(features);
  const weaknesses = inferWeaknesses(features, score, dimensionScores);
  const age = Math.round(clamp(45 + score * 0.42 + features.resonance * 4.2 - features.noise * 0.35, 58, 92));
  const styleFit = inferStyleFit(features, dimensionScores);
  const spectrumDetail = buildSpectrumDetail(features, options.segmentAnalyses || []);
  const spectrumSummary = inferSpectrumSummary(features);
  const priceHint = matchedSample?.price
    ? `声学轮廓接近 ¥${formatMoney(matchedSample.price)} ${matchedSample.wood} 档位`
    : "声学轮廓处于成熟演奏琴区间";
  const displayName = sourceName?.replace(/\.[^.]+$/, "") || "当前上传音频";

  return {
    sourceName: displayName,
    score,
    dimensionScores,
    traits,
    matchedSample,
    summary: `AI 识别「${displayName}」：${toneSentence(features)}，${priceHint}。`,
    dynamicValue: `${features.dynamicDb.toFixed(1)} dB`,
    dynamicText: features.dynamicDb >= 17 ? "强弱层次开阔" : features.dynamicDb >= 12 ? "层次自然" : "层次偏收敛",
    resonanceValue: `${features.resonance.toFixed(1)} 秒`,
    resonanceText: features.resonance >= 4.2 ? "尾音绵长" : features.resonance >= 3 ? "收束稳定" : "余韵略短",
    woodValue: wood.main,
    woodText: wood.detail,
    ageValue: `约开声 ${age}%`,
    ageText: age >= 78 ? "声音已经较成熟" : "仍有继续开声空间",
    weaknesses,
    styleFit,
    spectrumSummary,
    spectrumDetail,
    spectrumLabel: `${Math.round(features.spectrum.centroid)} Hz 重心`,
    guzhengConfidence: guzhengCheck?.score ?? 100,
    analyzedDuration: options.analyzedDuration,
    originalDuration: options.originalDuration,
    wasTrimmed: options.wasTrimmed,
    segmentAnalyses: options.segmentAnalyses || [],
    deepseekContext: {
      sourceName: displayName,
      score,
      dimensionScores,
      scoringBasis: "评分依据音区均衡、音色纯净、共鸣表现、音色控制四项，不按价格直接给高分。",
      dynamicDb: Number(features.dynamicDb.toFixed(1)),
      resonanceSeconds: Number(features.resonance.toFixed(1)),
      spectralCentroidHz: Math.round(features.spectrum.centroid),
      lowRatio: Number(features.spectrum.lowRatio.toFixed(3)),
      midRatio: Number(features.spectrum.midRatio.toFixed(3)),
      highRatio: Number(features.spectrum.highRatio.toFixed(3)),
      transientRatio: Number(features.transientRatio.toFixed(2)),
      pluckContrast: Number(features.pluckContrast.toFixed(2)),
      guzhengConfidence: guzhengCheck?.score ?? 100,
      inferredWood: wood.main,
      styleFit,
      weaknesses,
      spectrumDetail,
      segmentAnalyses: options.segmentAnalyses || [],
      analysisWindow: {
        analyzedSeconds: Number((options.analyzedDuration || features.duration).toFixed(1)),
        originalSeconds: Number((options.originalDuration || features.duration).toFixed(1)),
        trimmedToFirst60Seconds: Boolean(options.wasTrimmed),
      },
      sampleReference: matchedSample
        ? {
            price: matchedSample.price,
            wood: matchedSample.wood,
            refinedTone: matchedSample.tone,
          }
        : null,
    },
  };
}

export function buildRejectedReport(sourceName, check) {
  return {
    sourceName: sourceName?.replace(/\.[^.]+$/, "") || "当前上传音频",
    score: "--",
    dimensionScores: { balance: "--", purity: "--", resonance: "--", control: "--", brightness: "--", texture: "--" },
    traits: ["未通过古筝音色预检"],
    summary: `AI 预检认为这段音频不像古筝独奏，古筝置信度 ${check.score}/100，因此未生成音色评分。`,
    dynamicValue: "--",
    dynamicText: "未评分",
    resonanceValue: "--",
    resonanceText: "未评分",
    woodValue: "--",
    woodText: "未评分",
    ageValue: "--",
    ageText: "未评分",
    weaknesses: check.reasons.length ? check.reasons : ["音频特征与古筝参考声档差异较大。"],
    styleFit: "请上传古筝独奏、少混响、少环境噪声的音频后再分析。",
    spectrumSummary: "未进入正式评分",
    spectrumDetail: "未进入正式评分，频谱仅作预览参考。",
    spectrumLabel: "非古筝预检",
    guzhengConfidence: check.score,
    analyzedDuration: "--",
    originalDuration: "--",
    wasTrimmed: false,
    segmentAnalyses: [],
    deepseekContext: null,
  };
}

function buildDimensionScores(features) {
  const balance = scoreBalance(features);
  const purity = scorePurity(features);
  const resonance = scoreResonance(features);
  const control = scoreControl(features, balance, purity);
  return {
    balance: Math.round(balance),
    purity: Math.round(purity),
    resonance: Math.round(resonance),
    control: Math.round(control),
    brightness: Math.round(balance),
    texture: Math.round(purity),
  };
}

function scoreBalance(features) {
  const { lowRatio, midRatio, highRatio, centroid } = features.spectrum;
  const low = rangeScore(lowRatio, 0.1, 0.38, 0.16);
  const mid = rangeScore(midRatio, 0.24, 0.58, 0.16);
  const high = rangeScore(highRatio, 0.06, 0.42, 0.18);
  const centroidScore = rangeScore(centroid, 620, 2600, 850);
  const dynamicSupport = rangeScore(features.dynamicDb, 10, 24, 8);
  return clamp(low * 0.22 + mid * 0.28 + high * 0.2 + centroidScore * 0.22 + dynamicSupport * 0.08, 35, 98);
}

function scorePurity(features) {
  const { highRatio, lowRatio, centroid } = features.spectrum;
  const noiseScore = clamp(100 - features.noise * 1.9, 30, 100);
  const harshPenalty = highRatio > 0.46 || centroid > 3300 ? 8 : 0;
  const muddyPenalty = lowRatio > 0.45 ? 7 : 0;
  return clamp(features.purity * 0.46 + noiseScore * 0.3 + rangeScore(highRatio, 0.04, 0.44, 0.18) * 0.16 + rangeScore(lowRatio, 0.08, 0.42, 0.18) * 0.08 - harshPenalty - muddyPenalty, 32, 98);
}

function scoreResonance(features) {
  const resonanceLength = rangeScore(features.resonance, 3.0, 5.8, 1.35);
  const bodySupport = clamp(features.body, 30, 96);
  const warmthSupport = clamp(features.warmth, 28, 96);
  const loosePenalty = features.resonance > 6 || features.spectrum.lowRatio > 0.48 ? 7 : 0;
  return clamp(resonanceLength * 0.54 + bodySupport * 0.24 + warmthSupport * 0.22 - loosePenalty, 35, 98);
}

function scoreControl(features, balance, purity) {
  const dynamicControl = rangeScore(features.dynamicDb, 11, 24, 8);
  const transientControl = rangeScore(features.transientRatio, 1.8, 7.5, 4.2);
  const pluckControl = rangeScore(features.pluckContrast, 2.4, 13, 6);
  const overloadPenalty = features.peak > 0.98 ? 8 : 0;
  return clamp(dynamicControl * 0.34 + transientControl * 0.2 + pluckControl * 0.2 + balance * 0.14 + purity * 0.12 - overloadPenalty, 35, 98);
}

function rangeScore(value, minGood, maxGood, shoulder) {
  if (value >= minGood && value <= maxGood) return 96;
  const distance = value < minGood ? minGood - value : value - maxGood;
  return clamp(96 - (distance / Math.max(shoulder, 0.0001)) * 48, 25, 96);
}

function buildSpectrumDetail(features, segments) {
  const low = Math.round(features.spectrum.lowRatio * 100);
  const mid = Math.round(features.spectrum.midRatio * 100);
  const high = Math.round(features.spectrum.highRatio * 100);
  const drift = segments.length > 1 ? Math.max(...segments.map((s) => s.centroidHz)) - Math.min(...segments.map((s) => s.centroidHz)) : 0;
  const driftText = drift > 520 ? "各段频谱重心波动较大" : drift > 260 ? "各段频谱重心有轻微起伏" : "各段频谱重心较稳定";
  return `低频约 ${low}%、中频约 ${mid}%、高频约 ${high}%，重心 ${Math.round(features.spectrum.centroid)} Hz；${driftText}。`;
}

function summarizeSegment(features) {
  const tone = features.brightness > 75 ? "亮度较高" : features.brightness < 55 ? "亮度温和" : "亮度适中";
  const tail = features.resonance > 4.2 ? "尾音舒展" : features.resonance < 3 ? "尾音偏短" : "尾音稳定";
  const body = features.body > 70 ? "中低频扎实" : "中低频清秀";
  return `${tone}，${body}，${tail}`;
}

function compareToReferences(features, profiles) {
  const scales = {
    centroid: 950,
    lowRatio: 0.2,
    midRatio: 0.2,
    highRatio: 0.18,
    resonance: 1.5,
    dynamicDb: 6,
    brightness: 22,
    warmth: 24,
    purity: 24,
    body: 24,
    transientRatio: 3.5,
    pluckContrast: 5,
  };
  const distances = profiles.map((profile) => {
    const terms = [
      norm(features.spectrum.centroid - profile.centroid, scales.centroid),
      norm(features.spectrum.lowRatio - profile.lowRatio, scales.lowRatio),
      norm(features.spectrum.midRatio - profile.midRatio, scales.midRatio),
      norm(features.spectrum.highRatio - profile.highRatio, scales.highRatio),
      norm(features.resonance - profile.resonance, scales.resonance),
      norm(features.dynamicDb - profile.dynamicDb, scales.dynamicDb),
      norm(features.brightness - profile.brightness, scales.brightness),
      norm(features.warmth - profile.warmth, scales.warmth),
      norm(features.purity - profile.purity, scales.purity),
      norm(features.body - profile.body, scales.body),
      norm(features.transientRatio - profile.transientRatio, scales.transientRatio),
      norm(features.pluckContrast - profile.pluckContrast, scales.pluckContrast),
    ];
    return Math.sqrt(terms.reduce((sum, value) => sum + value * value, 0) / terms.length);
  });
  const bestDistance = Math.min(...distances);
  return clamp(100 - bestDistance * 38, 0, 100);
}

function norm(value, scale) {
  return value / scale;
}

function sampleWaveform(samples, points) {
  const chunk = Math.max(1, Math.floor(samples.length / points));
  const waveform = [];
  for (let i = 0; i < samples.length; i += chunk) {
    let min = 1;
    let max = -1;
    for (let j = i; j < Math.min(i + chunk, samples.length); j += 1) {
      min = Math.min(min, samples[j]);
      max = Math.max(max, samples[j]);
    }
    waveform.push({ min, max });
  }
  return waveform;
}

function buildEnvelope(samples, sampleRate) {
  const chunk = Math.max(64, Math.floor(sampleRate * 0.055));
  const values = [];
  for (let i = 0; i < samples.length; i += chunk) {
    let sum = 0;
    const end = Math.min(i + chunk, samples.length);
    for (let j = i; j < end; j += 1) {
      sum += samples[j] * samples[j];
    }
    values.push(Math.sqrt(sum / Math.max(end - i, 1)));
  }
  return { values, chunk };
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = clamp(Math.floor(sorted.length * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function estimateResonance(envelope, sampleRate, duration) {
  const max = Math.max(...envelope.values, 0.001);
  const peakIndex = envelope.values.indexOf(max);
  const threshold = max * 0.14;
  let lastAbove = peakIndex;
  let calmFrames = 0;

  for (let i = peakIndex; i < envelope.values.length; i += 1) {
    if (envelope.values[i] > threshold) {
      lastAbove = i;
      calmFrames = 0;
    } else {
      calmFrames += 1;
      if (calmFrames > 12) break;
    }
  }

  const seconds = ((lastAbove - peakIndex) * envelope.chunk) / sampleRate;
  const tailBonus = duration > 20 ? 0.5 : 0.15;
  return clamp(seconds + tailBonus, 1.8, 6.4);
}

function computeSpectrum(samples, sampleRate) {
  const binCount = 80;
  const frequencies = Array.from({ length: binCount }, (_, index) => {
    const min = 80;
    const max = Math.min(8200, sampleRate / 2 - 100);
    const ratio = index / (binCount - 1);
    return min * Math.pow(max / min, ratio);
  });
  const windowSize = Math.min(4096, Math.floor(samples.length / 4) || 1024);
  const starts = [0.18, 0.32, 0.46, 0.6, 0.74].map((ratio) =>
    clamp(Math.floor(samples.length * ratio), 0, Math.max(0, samples.length - windowSize)),
  );
  const magnitudes = new Array(binCount).fill(0);

  starts.forEach((start) => {
    frequencies.forEach((frequency, bin) => {
      let real = 0;
      let imaginary = 0;
      const step = Math.max(1, Math.floor(windowSize / 2048));
      for (let n = 0; n < windowSize; n += step) {
        const sample = samples[start + n] || 0;
        const windowValue = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (windowSize - 1));
        const angle = (2 * Math.PI * frequency * n) / sampleRate;
        real += sample * windowValue * Math.cos(angle);
        imaginary -= sample * windowValue * Math.sin(angle);
      }
      magnitudes[bin] += Math.sqrt(real * real + imaginary * imaginary);
    });
  });

  const maxMagnitude = Math.max(...magnitudes, 0.0001);
  const normalized = magnitudes.map((value) => value / maxMagnitude);
  const total = magnitudes.reduce((sum, value) => sum + value, 0.0001);
  const weighted = magnitudes.reduce((sum, value, index) => sum + value * frequencies[index], 0);

  return {
    frequencies,
    values: normalized,
    centroid: weighted / total,
    lowRatio: sumBand(magnitudes, frequencies, 80, 650) / total,
    midRatio: sumBand(magnitudes, frequencies, 650, 2600) / total,
    highRatio: sumBand(magnitudes, frequencies, 2600, 8200) / total,
  };
}

function sumBand(values, frequencies, min, max) {
  return values.reduce((sum, value, index) => {
    const frequency = frequencies[index];
    return frequency >= min && frequency < max ? sum + value : sum;
  }, 0);
}

function priceToBonus(price) {
  if (price >= 70000) return 9;
  if (price >= 20000) return 6;
  if (price >= 16000) return 4;
  if (price >= 10000) return 2;
  return 0;
}

function nearestReference(features) {
  const weightedScore = features.warmth * 0.35 + features.purity * 0.28 + features.resonance * 9 + features.dynamicDb * 1.1;
  return referenceSamples.reduce((best, sample) => {
    const target = 68 + priceToBonus(sample.price) * 3;
    const bestTarget = 68 + priceToBonus(best.price) * 3;
    return Math.abs(target - weightedScore) < Math.abs(bestTarget - weightedScore) ? sample : best;
  }, referenceSamples[0]);
}

function toneSentence(features) {
  const bright = features.brightness > 74 ? "高音明净、有穿透" : "高音柔和、不过分尖利";
  const body = features.body > 70 ? "中低频厚度较好" : "中低频偏清秀";
  const tail = features.resonance > 4.1 ? "余韵打开得比较充分" : "尾音收束较快";
  return `${bright}，${body}，${tail}`;
}

function inferTraits(features) {
  const traits = [];
  traits.push(features.brightness > 74 ? "高音清亮" : "高音温润");
  traits.push(features.spectrum.midRatio > 0.32 ? "中音圆润" : "中音通透");
  traits.push(features.body > 70 ? "低音有厚度" : "低音偏清秀");
  traits.push(features.resonance > 4.1 ? "共鸣绵长" : "尾音干净");
  if (features.dynamicDb > 17) traits.push("动态开阔");
  if (features.purity > 82) traits.push("颗粒独立");
  return traits;
}

function inferWeaknesses(features, score, scores) {
  const weaknesses = [];
  if (scores.balance < 62) weaknesses.push("高中低音区衔接不够均衡，扫弦时可能出现轻微断层。");
  if (scores.purity < 64) weaknesses.push("音色纯净度偏弱，连续音里可能带有杂散感或边界发虚。");
  if (scores.resonance < 64) weaknesses.push("尾音支撑偏短，共鸣箱展开感还不充分。");
  if (scores.control < 62) weaknesses.push("强弱变化转化不够清楚，音色控制余量偏小。");
  if (features.brightness > 84) weaknesses.push("高频偏亮，强触弦时需要控制尖锐感。");
  if (!weaknesses.length && score > 92) weaknesses.push("整体完成度高，仅需在强奏长音里继续控制高频锐度。");
  if (!weaknesses.length) weaknesses.push("暂无明显短板，声音表现均衡。");
  return weaknesses.slice(0, 4);
}

function inferWood(features, sampleMeta) {
  if (sampleMeta?.wood) {
    return {
      main: sampleMeta.wood,
      detail: sampleMeta.price ? `参考 ¥${formatMoney(sampleMeta.price)} 声档` : "由文件名参考识别",
    };
  }
  if (features.resonance > 4.5 && features.body > 74) {
    return { main: "阔叶黄檀 / 老红木", detail: "低频扎实，尾音厚而稳定" };
  }
  if (features.brightness > 78 && features.purity > 78) {
    return { main: "黑檀木 / 紫檀木", detail: "高频清亮，颗粒边界明显" };
  }
  if (features.body > 72) {
    return { main: "非洲柚木", detail: "中低频饱满，声底偏暖" };
  }
  return { main: "红木 / 泡桐面板", detail: "出音直接，明亮扎实" };
}

function inferStyleFit(features, scores) {
  const styles = [];
  if (scores.resonance >= 84 && scores.purity >= 70) styles.push("慢板抒情、山水意境、长线条吟揉类曲风");
  if (scores.balance >= 78 && scores.purity >= 76) styles.push("音区过渡顺滑、颗粒清楚的快速指序或轻巧明亮曲风");
  if (scores.control >= 76 && features.dynamicDb >= 14) styles.push("强弱层次较多、需要力度变化和触弦控制的舞台独奏曲风");
  if (features.body >= 68 && scores.resonance >= 72) styles.push("中低音承托较明显、叙事性和空间感较强的曲风");
  if (styles.length < 2) styles.push("清雅小品、教学展示、室内独奏类曲风");
  const caution =
    scores.control < 62 || scores.balance < 62
      ? "暂不建议承担强爆发、大开大合且音区跳跃频繁的曲风。"
      : scores.purity < 64
        ? "可尝试抒情曲风，但需要控制杂散音和强奏边界。"
        : "可尝试强弱对比较大的曲风，但需控制高频锐度。";
  return `${styles.slice(0, 3).join("；")}。${caution}`;
}

function inferSpectrumSummary(features) {
  if (features.spectrum.highRatio > 0.32) return "高频突出，明亮感强";
  if (features.spectrum.lowRatio > 0.34) return "低频充足，共鸣偏厚";
  if (features.spectrum.midRatio > 0.4) return "中频稳定，声底温润";
  return "频段均衡，听感自然";
}
