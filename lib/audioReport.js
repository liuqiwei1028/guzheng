export const referenceSamples = [
  {
    price: 5000,
    wood: "红木",
    tone: "入门演奏级，音头直接、亮度清楚，适合作为基础颗粒感与触弦稳定性的参考。",
  },
  {
    price: 8000,
    wood: "黑檀木",
    tone: "在明亮感之外开始出现木质厚度，中低音更有存在感，整体比基础档更舒展。",
  },
  {
    price: 10000,
    wood: "黑檀木",
    tone: "高音保持清透，中低频更稳，音头和尾音之间的衔接更自然。",
  },
  {
    price: 13000,
    wood: "黑檀木",
    tone: "质感更细，泛音边缘收得更干净，中低音区开始显出更明确的纹理。",
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

export function mixToMono(audioBuffer) {
  const maxPoints = 180000;
  const stride = Math.max(1, Math.ceil(audioBuffer.length / maxPoints));
  const total = Math.ceil(audioBuffer.length / stride);
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
  const brightness = clamp((spectrum.centroid - 850) / 25 + spectrum.highRatio * 62, 18, 97);
  const warmth = clamp(spectrum.lowRatio * 72 + spectrum.midRatio * 38 + resonance * 3.5, 16, 98);
  const purity = clamp(96 - (zeroCrossings / samples.length) * 98 + spectrum.midRatio * 16, 35, 98);
  const body = clamp(spectrum.lowRatio * 62 + spectrum.midRatio * 34 + dynamicDb * 0.75, 16, 97);
  const noise = clamp((zeroCrossings / samples.length) * 120, 0, 34);
  const transientRatio = clamp(p95 / (p50 + 0.00001), 1, 12);
  const pluckContrast = clamp(p85 / (p20 + 0.00001), 1, 18);

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
  const score = Math.round(clamp(referenceProfiles.length ? similarity * 0.58 + heuristic * 0.42 : heuristic, 0, 100));

  return {
    isGuzheng: score >= 58,
    score,
    reasons: reasons.slice(0, 3),
  };
}

export function buildReport(features, sourceName, sampleMeta, guzhengCheck) {
  const matchedSample = sampleMeta || nearestReference(features);
  const dimensionScores = {
    brightness: Math.round(clamp(features.brightness, 50, 96)),
    resonance: Math.round(clamp(features.resonance * 15 + features.body * 0.22, 52, 97)),
    texture: Math.round(clamp(features.purity * 0.55 + features.warmth * 0.28 + features.dynamicDb * 1.1, 55, 98)),
  };
  const score = Math.round(
    clamp(
      dimensionScores.brightness * 0.26 +
        dimensionScores.resonance * 0.36 +
        dimensionScores.texture * 0.38 +
        (matchedSample?.price ? priceToBonus(matchedSample.price) : 0),
      74,
      98,
    ),
  );
  const wood = inferWood(features, matchedSample);
  const traits = inferTraits(features);
  const weaknesses = inferWeaknesses(features, score);
  const age = Math.round(clamp(45 + score * 0.42 + features.resonance * 4.2 - features.noise * 0.35, 58, 92));
  const styleFit = inferStyleFit(features, dimensionScores);
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
    spectrumLabel: `${Math.round(features.spectrum.centroid)} Hz 重心`,
    guzhengConfidence: guzhengCheck?.score ?? 100,
    deepseekContext: {
      sourceName: displayName,
      score,
      dimensionScores,
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
    dimensionScores: { brightness: "--", resonance: "--", texture: "--" },
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
    spectrumLabel: "非古筝预检",
    guzhengConfidence: check.score,
    deepseekContext: null,
  };
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

function inferWeaknesses(features, score) {
  const weaknesses = [];
  if (features.resonance < 3.15) weaknesses.push("低频尾音略短，共鸣没有完全铺开。");
  if (features.brightness > 84) weaknesses.push("高频偏亮，强触弦时可能显得锋利。");
  if (features.dynamicDb < 11.5) weaknesses.push("强弱层次偏窄，爆发段需要更大余量。");
  if (features.body < 58) weaknesses.push("中低频厚度不足，木质感略轻。");
  if (features.purity < 68) weaknesses.push("连续音边界略散，颗粒独立性还可提升。");
  if (!weaknesses.length && score > 92) weaknesses.push("整体完成度高，仅需控制高音长音的亮度。");
  if (!weaknesses.length) weaknesses.push("暂无明显短板，声音表现均衡。");
  return weaknesses;
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
  if (scores.resonance >= 84) styles.push("慢板抒情、山水意境、长线条吟揉类曲风");
  if (scores.brightness >= 78 && scores.texture >= 78) styles.push("颗粒清晰、快速指序、轻巧明亮的现代改编曲风");
  if (features.body >= 68 && features.dynamicDb >= 14) styles.push("叙事性较强、需要中低音支撑的舞台独奏曲风");
  if (styles.length < 2) styles.push("清雅小品、教学展示、室内独奏类曲风");
  const caution =
    features.dynamicDb < 12 || features.body < 58
      ? "暂不建议承担强爆发、大开大合的武曲风格。"
      : "可尝试强弱对比较大的曲风，但需控制高频锐度。";
  return `${styles.slice(0, 3).join("；")}。${caution}`;
}

function inferSpectrumSummary(features) {
  if (features.spectrum.highRatio > 0.32) return "高频突出，明亮感强";
  if (features.spectrum.lowRatio > 0.34) return "低频充足，共鸣偏厚";
  if (features.spectrum.midRatio > 0.4) return "中频稳定，声底温润";
  return "频段均衡，听感自然";
}
