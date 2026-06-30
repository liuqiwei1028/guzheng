"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Download, FileDown, ImageDown, Music2, Sparkles, UploadCloud, Volume2 } from "lucide-react";
import {
  assessGuzhengLikelihood,
  buildRejectedReport,
  buildReport,
  createReferenceProfile,
  extractFeatures,
  formatMoney,
  mixToMono,
  parseSampleName,
  referenceSamples,
} from "@/lib/audioReport";

const initialReport = {
  score: "--",
  dimensionScores: { brightness: "--", resonance: "--", texture: "--" },
  traits: ["高音清亮", "中音圆润", "低音厚重"],
  summary: "上传或选择一段古筝音频后，AI 将先判断是否为古筝声音，再生成音色评分、频谱分析与详细鉴赏报告。",
  dynamicValue: "--",
  dynamicText: "等待分析",
  resonanceValue: "--",
  resonanceText: "等待分析",
  woodValue: "--",
  woodText: "等待分析",
  ageValue: "--",
  ageText: "等待分析",
  weaknesses: ["等待音频进入分析。"],
  styleFit: "系统会根据清亮度、厚度、爆发力与尾音判断适合曲风。",
  spectrumSummary: "等待频谱分析",
  spectrumLabel: "未载入",
  guzhengConfidence: "--",
  deepseekContext: null,
};

export default function GuzhengExperience() {
  const [report, setReport] = useState(initialReport);
  const [status, setStatus] = useState("等待第一段声音进入鉴赏台");
  const [currentFile, setCurrentFile] = useState("尚未载入音频");
  const [fileState, setFileState] = useState("等待采样");
  const [activeSample, setActiveSample] = useState(null);
  const [aiReport, setAiReport] = useState("完成音频分析后，可生成 AI 详细鉴赏报告。");
  const [aiSource, setAiSource] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(true);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [waveform, setWaveform] = useState(null);
  const [spectrum, setSpectrum] = useState(null);
  const [referenceProfiles, setReferenceProfiles] = useState([]);
  const [reportImageUrl, setReportImageUrl] = useState("");

  const audioContextRef = useRef(null);
  const musicRef = useRef(null);
  const playerRef = useRef(null);
  const uploadInputRef = useRef(null);
  const reportCardRef = useRef(null);
  const aiReportRef = useRef(null);

  useEffect(() => {
    const audio = musicRef.current;
    if (!audio) return;
    audio.volume = 0.32;
    audio.loop = true;
    audio
      .play()
      .then(() => {
        setIsMusicPlaying(true);
        setAutoplayBlocked(false);
      })
      .catch(() => {
        setIsMusicPlaying(false);
        setAutoplayBlocked(true);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function prepareReferences() {
      try {
        const context = await ensureAudioContext();
        const profiles = [];
        for (const sample of referenceSamples) {
          const response = await fetch(sample.path);
          if (!response.ok) continue;
          const buffer = await response.arrayBuffer();
          const decoded = await context.decodeAudioData(buffer.slice(0));
          const mono = mixToMono(decoded);
          const features = extractFeatures(mono.samples, mono.sampleRate, decoded.duration);
          profiles.push(createReferenceProfile(features, sample));
        }
        if (!cancelled) setReferenceProfiles(profiles);
      } catch (error) {
        console.warn("参考声纹初始化失败，将使用规则预检。", error);
      }
    }
    prepareReferences();
    return () => {
      cancelled = true;
    };
  }, []);

  const scoreStyle = useMemo(() => ({ "--score": `${Number(report.score) || 0}%` }), [report.score]);
  const formattedAiReport = useMemo(() => formatAiReport(aiReport), [aiReport]);
  const canExport = report.score !== "--";

  async function ensureAudioContext({ resume = false } = {}) {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (resume && audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }

  async function analyzeArrayBuffer(arrayBuffer, sourceName, sampleMeta) {
    try {
      setStatus("正在解码音频，并进行古筝音色预检...");
      setFileState("预检中");
      setAiReport("AI 正在等待古筝音色预检结果。");
      setAiSource("");
      setReportImageUrl("");

      const context = await ensureAudioContext({ resume: true });
      const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
      const mono = mixToMono(decoded);
      const features = extractFeatures(mono.samples, mono.sampleRate, decoded.duration);
      const guzhengCheck = assessGuzhengLikelihood(features, referenceProfiles);

      setWaveform({ waveform: features.waveform, envelope: features.envelope });
      setSpectrum(features.spectrum);

      if (!sampleMeta && !guzhengCheck.isGuzheng) {
        const rejected = buildRejectedReport(sourceName, guzhengCheck);
        setReport(rejected);
        setStatus(`未通过古筝音色预检，置信度 ${guzhengCheck.score}/100。`);
        setFileState("未评分");
        setAiReport("这段音频未通过古筝声音预检，因此不会生成正式评分。建议上传古筝独奏、少混响、少环境噪声的音频。");
        setAiSource("AI 预检");
        return;
      }

      const nextReport = buildReport(features, sourceName, sampleMeta, guzhengCheck);
      setReport(nextReport);
      setStatus(`分析完成，古筝置信度 ${nextReport.guzhengConfidence}/100。`);
      setFileState("已完成");
      await requestAiReport(nextReport.deepseekContext);
      setTimeout(() => refreshReportImage(false), 180);
    } catch (error) {
      console.error(error);
      setStatus("浏览器无法解码这段音频，请换用 WAV、MP3、M4A 或 FLAC 文件。");
      setFileState("失败");
    }
  }

  async function requestAiReport(context) {
    if (!context) return;
    setIsAiLoading(true);
    try {
      const response = await fetch("/api/deepseek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      const data = await response.json();
      setAiReport(data.report || "AI 未返回报告，已保留基础分析结果。");
      setAiSource(data.source === "deepseek" ? "AI API" : "本地专业兜底");
    } catch (error) {
      setAiReport(`详细报告暂未生成：${error.message}`);
      setAiSource("请求失败");
    } finally {
      setIsAiLoading(false);
    }
  }

  async function handleUserFile(file) {
    if (!file) return;
    setActiveSample(null);
    setCurrentFile(file.name);
    setFileState("分析中");
    setStatus("正在读取上传音频...");
    if (playerRef.current) {
      playerRef.current.src = URL.createObjectURL(file);
      playerRef.current.load();
    }
    await analyzeArrayBuffer(await file.arrayBuffer(), file.name, parseSampleName(file.name));
  }

  async function loadReferenceSample(sample) {
    setActiveSample(sample.price);
    setCurrentFile(sample.file);
    setFileState("样本");
    setStatus(`正在载入 ¥${formatMoney(sample.price)} ${sample.wood} 声档...`);
    try {
      const response = await fetch(sample.path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (playerRef.current) {
        playerRef.current.src = URL.createObjectURL(new Blob([buffer], { type: "audio/flac" }));
        playerRef.current.load();
      }
      await analyzeArrayBuffer(buffer, sample.file, sample);
    } catch (error) {
      console.error(error);
      setStatus("样本载入失败，请确认 public/voices 下的声档存在。");
      setFileState("失败");
    }
  }

  async function toggleMusic() {
    const audio = musicRef.current;
    if (!audio) return;
    if (isMusicPlaying) {
      audio.pause();
      setIsMusicPlaying(false);
      return;
    }
    try {
      await audio.play();
      setIsMusicPlaying(true);
      setAutoplayBlocked(false);
    } catch {
      setAutoplayBlocked(true);
    }
  }

  async function refreshReportImage(download = false) {
    if (!reportCardRef.current || report.score === "--") return "";
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(reportCardRef.current, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: "#f6edda",
      filter: (node) => !node?.dataset?.exportHidden,
    });
    setReportImageUrl(dataUrl);
    if (download) downloadDataUrl(dataUrl, `古筝音色分析报告-${Date.now()}.png`);
    return dataUrl;
  }

  async function exportReportImage() {
    setIsExporting(true);
    try {
      await refreshReportImage(true);
    } finally {
      setIsExporting(false);
    }
  }

  async function exportAiPdf() {
    if (!aiReportRef.current) return;
    setIsExporting(true);
    try {
      const { toPng } = await import("html-to-image");
      const { jsPDF } = await import("jspdf");
      const image = await refreshReportImage(false);
      await new Promise((resolve) => setTimeout(resolve, image ? 240 : 0));
      const dataUrl = await toPng(aiReportRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#f6edda",
      });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const img = await loadImage(dataUrl);
      const width = pageWidth;
      const height = (img.height * width) / img.width;
      if (height <= pageHeight) {
        pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
      } else {
        let rendered = 0;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const sliceHeightPx = Math.floor((img.width * pageHeight) / pageWidth);
        canvas.width = img.width;
        canvas.height = sliceHeightPx;
        while (rendered < img.height) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#f6edda";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, rendered, img.width, sliceHeightPx, 0, 0, img.width, sliceHeightPx);
          const pageData = canvas.toDataURL("image/png");
          if (rendered > 0) pdf.addPage();
          pdf.addImage(pageData, "PNG", 0, 0, pageWidth, pageHeight);
          rendered += sliceHeightPx;
        }
      }
      pdf.save(`AI古筝音色详细报告-${Date.now()}.pdf`);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f5efd9] text-ink">
      <audio ref={musicRef} src="/bg-music.flac" preload="metadata" />

      <header className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between px-5 py-5 md:px-10">
        <button
          type="button"
          onClick={toggleMusic}
          className="group flex h-14 w-14 items-center justify-center rounded-full border border-white/70 bg-white/35 text-[#5d6f45] shadow-soft backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/55"
          aria-label={isMusicPlaying ? "暂停背景音乐" : "播放背景音乐"}
          title={isMusicPlaying ? "暂停背景音乐" : "播放背景音乐"}
        >
          <span className={isMusicPlaying ? "music-spin" : ""}>
            <Music2 className="h-7 w-7" strokeWidth={1.8} />
          </span>
        </button>
        <nav className="hidden items-center gap-8 rounded-full border border-white/50 bg-white/25 px-6 py-3 text-sm text-[#3e4e34] shadow-soft backdrop-blur-xl md:flex">
          <a href="#lab" className="transition hover:text-[#8a6d35]">
            听音识色
          </a>
          <a href="#samples" className="transition hover:text-[#8a6d35]">
            名琴声档
          </a>
          <a href="#report" className="transition hover:text-[#8a6d35]">
            AI 报告
          </a>
        </nav>
      </header>

      <section className="relative min-h-[92vh] overflow-hidden">
        <div className="absolute inset-0 bg-[url('/hero-bg.png')] bg-cover bg-[42%_center] md:bg-center" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-white/0 to-[#f5efd9]" />
        <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/0 to-white/18" />
        <MountainAnimation />
        <div className="pointer-events-none absolute bottom-[18%] left-[13%] right-[36%] hidden h-px overflow-hidden md:block">
          <div className="string-glow h-px w-full bg-gradient-to-r from-transparent via-[#fff3c5] to-transparent" />
        </div>

        <div className="relative z-10 flex min-h-[92vh] items-center justify-center px-5 pt-20 md:justify-end md:px-[9vw]">
          <div className="mt-20 w-full max-w-[500px] text-center md:mt-6">
            <p className="mb-5 text-sm uppercase text-[#9a7b3d]">Guzheng Timbre Intelligence</p>
            <h1 className="sr-only">天籁之音 古筝 AI 音色鉴赏</h1>
            <p className="mx-auto max-w-[420px] text-[18px] leading-9 text-[#35402d] drop-shadow-sm md:text-[20px]">
              以频谱、共鸣、动态与木质感为线索，听见一张古筝真正的气质。
            </p>
            <div className="mt-8 flex justify-center">
              <a
                href="#lab"
                className="group inline-flex h-14 min-w-[172px] items-center justify-center gap-3 rounded-full border border-[#d8bd80]/70 bg-gradient-to-r from-[#fff0c8]/90 to-[#cda75d]/90 px-8 text-[17px] font-semibold text-[#3e2f18] shadow-[0_18px_50px_rgba(117,91,45,0.22)] transition hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(117,91,45,0.28)]"
              >
                <Volume2 className="h-5 w-5" strokeWidth={1.8} />
                <span>听音识色</span>
                <ChevronRight className="h-5 w-5 transition group-hover:translate-x-1" strokeWidth={1.8} />
              </a>
            </div>
            {autoplayBlocked ? (
              <p className="mt-5 text-sm text-[#60734c]">浏览器已拦截自动播放，点击左上角音符即可开启背景音乐。</p>
            ) : null}
          </div>
        </div>
      </section>

      <section id="lab" className="relative bg-[#f5efd9] px-5 py-20 md:px-10 md:py-24">
        <SectionTitle
          eyebrow="AI Tone Studio"
          title="上传一段古筝音频，生成音色品鉴"
          text="系统会先进行古筝声音预检，通过后再读取响度包络、动态范围、频谱重心与尾音衰减，生成可导出的 AI 音色报告。"
        />

        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="glass-panel rounded-lg p-6">
            <div className="mb-6 flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-[#5d7048] text-paper">
                <UploadCloud className="h-6 w-6" strokeWidth={1.8} />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-[#25321f]">音频采样</h2>
                <p className="mt-1 text-sm text-[#65745a]">上传本地音频，或先点选下方样本试听分析。</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                handleUserFile(event.dataTransfer.files?.[0]);
              }}
              className="grid min-h-[230px] w-full place-items-center rounded-lg border border-dashed border-[#afbd9f] bg-white/38 p-8 text-center transition hover:-translate-y-1 hover:border-[#caa96e] hover:bg-white/55"
            >
              <input
                ref={uploadInputRef}
                type="file"
                accept="audio/*,.flac,.wav,.mp3,.m4a,.ogg"
                className="hidden"
                onChange={(event) => handleUserFile(event.target.files?.[0])}
              />
              <span className="grid h-20 w-20 place-items-center rounded-full border border-[#caa96e]/60 bg-[#fff7e6]/80 text-[#9d7b39]">
                <Sparkles className="h-9 w-9" strokeWidth={1.5} />
              </span>
              <span className="mt-5 block text-xl font-semibold text-[#2d3826]">拖入或选择古筝音频</span>
              <span className="mt-2 block max-w-[280px] text-sm leading-6 text-[#65745a]">
                建议 10 秒以上，古筝独奏或少量环境声效果最佳
              </span>
            </button>

            <div className="mt-5 flex min-h-14 items-center justify-between gap-4 rounded-lg border border-white/60 bg-white/36 px-4 text-sm text-[#516146]">
              <span className="truncate">{currentFile}</span>
              <b className="shrink-0 font-medium text-[#9a7b3d]">{fileState}</b>
            </div>

            <audio ref={playerRef} controls className="mt-5 w-full" />
          </section>

          <section className="dark-glass relative min-h-[480px] overflow-hidden rounded-lg p-5 text-paper">
            <WaveformCanvas data={waveform} />
            <div className="absolute bottom-5 left-5 right-5 flex items-center gap-3 rounded-lg border border-white/20 bg-[#1f2b1b]/55 px-4 py-4 backdrop-blur-xl">
              <span className="h-2.5 w-2.5 rounded-full bg-[#f3d78c] shadow-[0_0_22px_rgba(243,215,140,0.9)]" />
              <p className="m-0 text-sm leading-6 text-white/78">{status}</p>
            </div>
          </section>
        </div>
      </section>

      <section id="samples" className="relative bg-[#edf3df] px-5 py-20 md:px-10">
        <SectionTitle eyebrow="Reference Archive" title="不同价位古筝声档" compact />
        <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {referenceSamples.map((sample) => (
            <button
              key={sample.file}
              type="button"
              onClick={() => loadReferenceSample(sample)}
              className={`group min-h-[190px] rounded-lg border p-5 text-left shadow-soft transition hover:-translate-y-1 ${
                activeSample === sample.price
                  ? "border-[#caa96e] bg-white/82"
                  : "border-white/70 bg-white/52 hover:border-[#caa96e]/70 hover:bg-white/74"
              }`}
            >
              <b className="block text-2xl text-[#a17a34]">¥{formatMoney(sample.price)}</b>
              <h3 className="mt-3 text-xl font-semibold text-[#25321f]">{sample.wood}</h3>
              <p className="mt-3 text-sm leading-6 text-[#5c6b51]">{sample.tone}</p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[#6a7d55]">
                载入声档 <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </span>
            </button>
          ))}
        </div>
      </section>

      <section id="report" className="bg-[#f5efd9] px-5 py-20 md:px-10 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_380px]">
          <ReportCard
            refTarget={reportCardRef}
            report={report}
            spectrum={spectrum}
            scoreStyle={scoreStyle}
            onExport={exportReportImage}
            isExporting={isExporting}
            canExport={canExport}
          />

          <aside className="glass-panel rounded-lg p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <span className="text-sm text-[#66755b]">频谱分析</span>
              <b className="text-sm font-medium text-[#a17a34]">{report.spectrumLabel}</b>
            </div>
            <SpectrumCanvas spectrum={spectrum} />
            <div className="mt-3 rounded-lg bg-white/42 px-4 py-3 text-sm text-[#526449]">
              {report.spectrumSummary}
            </div>
          </aside>
        </div>

        <section className="mx-auto mt-6 max-w-6xl">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 text-sm uppercase text-[#a17a34]">AI Detailed Review</p>
              <h2 className="text-2xl font-semibold text-[#25321f]">AI 具体分析报告</h2>
            </div>
            <button
              type="button"
              onClick={exportAiPdf}
              disabled={isExporting || !canExport}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#caa96e]/60 bg-white/60 px-5 text-sm font-medium text-[#5d4a24] shadow-soft transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <FileDown className="h-4 w-4" />
              导出 PDF
            </button>
          </div>

          <article ref={aiReportRef} className="overflow-hidden rounded-lg border border-white/70 bg-[#f6edda] shadow-soft">
            <div className="bg-gradient-to-br from-[#fffaf0] via-[#f3ead3] to-[#e0ebd4] p-6 md:p-8">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm uppercase text-[#a17a34]">AI Detailed Review</p>
                  <h3 className="mt-2 text-3xl font-semibold text-[#25321f]">古筝音色详细鉴赏</h3>
                  <p className="mt-2 text-sm text-[#60734c]">
                    来源：{aiSource || "等待音频"} · 古筝置信度：{report.guzhengConfidence}/100
                  </p>
                </div>
                <span className="rounded-full border border-[#caa96e]/50 bg-white/55 px-4 py-2 text-sm text-[#6a572e]">
                  {isAiLoading ? "AI 生成中..." : "可导出 PDF"}
                </span>
              </div>

              <div className="mt-6 overflow-hidden rounded-lg border border-white/70 bg-white/62 p-3">
                {reportImageUrl ? (
                  <img src={reportImageUrl} alt="音色分析报告图片" className="w-full rounded-md" />
                ) : (
                  <div className="rounded-md border border-dashed border-[#c9b98e] bg-[#fbf6e8] p-8 text-center text-sm text-[#6f7c61]">
                    生成音色分析后，这里会显示报告图片，导出 PDF 时也会自动生成。
                  </div>
                )}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <MiniStat title="综合评分" value={report.score} />
                <MiniStat title="共鸣厚度" value={report.dimensionScores.resonance} />
                <MiniStat title="颗粒质感" value={report.dimensionScores.texture} />
              </div>
            </div>

            <div className="p-6 md:p-8">
              <h4 className="mb-5 text-xl font-semibold text-[#25321f]">具体分析结论</h4>
              <div className="grid gap-4">
                {formattedAiReport.map((block, index) => (
                  <section key={`${block.title}-${index}`} className="rounded-lg border border-[#e2d4b3] bg-white/55 p-5">
                    <h5 className="mb-3 text-base font-semibold text-[#8a6d35]">{block.title}</h5>
                    <p className="whitespace-pre-line text-[15px] leading-8 text-[#35402d]">{block.body}</p>
                  </section>
                ))}
              </div>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

function ReportCard({ refTarget, report, scoreStyle, onExport, isExporting, canExport }) {
  return (
    <section ref={refTarget} className="glass-panel rounded-lg p-6 md:p-7">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="mb-3 text-sm uppercase text-[#a17a34]">AI Timbre Report</p>
          <h2 className="text-3xl font-semibold text-[#25321f] md:text-5xl">音色分析报告</h2>
        </div>
        <div className="grid h-28 w-28 shrink-0 place-items-center rounded-full bg-[conic-gradient(from_-90deg,#caa96e_var(--score),rgba(106,125,85,.16)_0)] text-[#25321f]" style={scoreStyle}>
          <div className="grid h-[86px] w-[86px] place-items-center rounded-full bg-[#f9f2df]">
            <span className="text-3xl font-bold">{report.score}</span>
            <small className="-mt-6 text-xs text-[#718064]">/100</small>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {report.traits.map((trait) => (
          <span key={trait} className="rounded-full border border-[#cad6bc] bg-white/45 px-3 py-2 text-sm text-[#526449]">
            {trait}
          </span>
        ))}
      </div>

      <p className="mt-5 rounded-lg border border-white/65 bg-white/42 p-5 text-lg leading-9 text-[#35402d]">
        {report.summary}
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <ScoreCard title="清亮度" value={report.dimensionScores.brightness} />
        <ScoreCard title="共鸣厚度" value={report.dimensionScores.resonance} />
        <ScoreCard title="颗粒质感" value={report.dimensionScores.texture} />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-5">
        <Metric title="古筝置信度" value={`${report.guzhengConfidence}/100`} text="预检结果" />
        <Metric title="动态范围" value={report.dynamicValue} text={report.dynamicText} />
        <Metric title="共鸣时间" value={report.resonanceValue} text={report.resonanceText} />
        <Metric title="木材推测" value={report.woodValue} text={report.woodText} />
        <Metric title="声音年龄" value={report.ageValue} text={report.ageText} />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <InfoBox title="不足提示">
          <ul className="m-0 space-y-2 pl-5">
            {report.weaknesses.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </InfoBox>
        <InfoBox title="曲风适配">
          <p>{report.styleFit}</p>
        </InfoBox>
      </div>

      <div data-export-hidden="true" className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onExport}
          disabled={isExporting || !canExport}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#caa96e]/60 bg-white/60 px-5 text-sm font-medium text-[#5d4a24] shadow-soft transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <ImageDown className="h-4 w-4" />
          导出报告图片
        </button>
      </div>
    </section>
  );
}

function SectionTitle({ eyebrow, title, text, compact = false }) {
  return (
    <div className={`mx-auto max-w-3xl text-center ${compact ? "mb-10" : "mb-12"}`}>
      <p className="mb-3 text-sm uppercase text-[#a17a34]">{eyebrow}</p>
      <h2 className="text-3xl font-semibold leading-tight text-[#25321f] md:text-5xl">{title}</h2>
      {text ? <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-8 text-[#65745a]">{text}</p> : null}
    </div>
  );
}

function ScoreCard({ title, value }) {
  const numeric = Number(value) || 0;
  return (
    <article className="rounded-lg border border-white/65 bg-white/42 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[#66755b]">{title}</span>
        <b className="text-2xl text-[#9a7b3d]">{value}</b>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#dfe8d0]">
        <div className="h-full rounded-full bg-gradient-to-r from-[#7d9b85] to-[#caa96e]" style={{ width: `${numeric}%` }} />
      </div>
    </article>
  );
}

function Metric({ title, value, text }) {
  return (
    <article className="rounded-lg border border-white/65 bg-white/42 p-4">
      <span className="text-sm text-[#66755b]">{title}</span>
      <strong className="mt-3 block text-xl leading-tight text-[#9a7b3d]">{value}</strong>
      <p className="mt-2 text-sm leading-6 text-[#5c6b51]">{text}</p>
    </article>
  );
}

function InfoBox({ title, children }) {
  return (
    <section className="rounded-lg border border-white/65 bg-white/42 p-5 text-[#526449]">
      <h3 className="mb-3 text-lg font-semibold text-[#25321f]">{title}</h3>
      <div className="text-sm leading-7">{children}</div>
    </section>
  );
}

function MiniStat({ title, value }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/55 p-4">
      <span className="text-sm text-[#65745a]">{title}</span>
      <b className="mt-2 block text-2xl text-[#9a7b3d]">{value}</b>
    </div>
  );
}

function MountainAnimation() {
  const mountRef = useRef(null);

  useEffect(() => {
    let frame;
    let renderer;
    let material;
    let cleanup = false;

    async function init() {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
      const THREE = await import("three");
      if (!mountRef.current || cleanup) return undefined;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      mountRef.current.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uAspect: { value: mountRef.current.clientWidth / mountRef.current.clientHeight } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: `
          precision mediump float;
          varying vec2 vUv;
          uniform float uTime;
          float line(float y, float pos, float width){ return smoothstep(width, 0.0, abs(y - pos)); }
          void main(){
            vec2 uv = vUv;
            float mist = 0.0;
            mist += line(uv.y, 0.58 + sin(uv.x * 9.0 + uTime * .25) * .015, .018) * .20;
            mist += line(uv.y, 0.46 + sin(uv.x * 13.0 - uTime * .32) * .012, .014) * .18;
            float water = line(uv.y, 0.22 + sin(uv.x * 22.0 + uTime) * .006, .006) * .34;
            float strings = line(uv.y, 0.31 + sin(uv.x * 4.0) * .015, .002) * smoothstep(.08,.26,uv.x) * smoothstep(.72,.38,uv.x);
            float sun = smoothstep(.42, .0, distance(uv, vec2(.86,.78))) * .22;
            float alpha = mist + water + strings + sun;
            vec3 color = mix(vec3(.82,.95,.86), vec3(1.0,.86,.48), water + sun + strings);
            gl_FragColor = vec4(color, alpha);
          }
        `,
      });
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

      const resize = () => {
        if (!mountRef.current || !renderer || !material) return;
        renderer.setSize(Math.floor(mountRef.current.clientWidth), Math.floor(mountRef.current.clientHeight));
        material.uniforms.uAspect.value = mountRef.current.clientWidth / mountRef.current.clientHeight;
      };
      window.addEventListener("resize", resize);

      const clock = new THREE.Clock();
      let lastFrameTime = 0;
      const animate = (timestamp = 0) => {
        if (!renderer || !material) return;
        if (!document.hidden && timestamp - lastFrameTime >= 33) {
          lastFrameTime = timestamp;
          material.uniforms.uTime.value = clock.getElapsedTime();
          renderer.render(scene, camera);
        }
        frame = requestAnimationFrame(animate);
      };
      animate();

      return () => window.removeEventListener("resize", resize);
    }

    let removeResize;
    init().then((cleanupResize) => {
      removeResize = cleanupResize;
    });

    return () => {
      cleanup = true;
      if (frame) cancelAnimationFrame(frame);
      if (removeResize) removeResize();
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, []);

  return <div ref={mountRef} className="pointer-events-none absolute inset-0 z-[1] opacity-80" aria-hidden="true" />;
}

function WaveformCanvas({ data }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let frame;
    let time = 0;
    let canvasWidth = 0;
    let canvasHeight = 0;

    function resizeIfNeeded() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const nextWidth = Math.max(1, Math.floor(rect.width * ratio));
      const nextHeight = Math.max(1, Math.floor(rect.height * ratio));
      if (nextWidth !== canvasWidth || nextHeight !== canvasHeight) {
        canvasWidth = nextWidth;
        canvasHeight = nextHeight;
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
    }

    function drawStatic() {
      resizeIfNeeded();
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(255,247,230,.04)";
      for (let x = 0; x < width; x += width / 12) ctx.fillRect(x, 0, 1, height);

      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "rgba(255,247,230,.14)");
      gradient.addColorStop(0.5, "rgba(240,205,126,.78)");
      gradient.addColorStop(1, "rgba(145,184,151,.46)");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.max(1, width / 620);

      if (data?.waveform) {
        const center = height * 0.46;
        const scale = height * 0.36;
        ctx.beginPath();
        data.waveform.forEach((point, index) => {
          const x = (index / Math.max(data.waveform.length - 1, 1)) * width;
          ctx.moveTo(x, center + point.min * scale);
          ctx.lineTo(x, center + point.max * scale);
        });
        ctx.stroke();

        if (data.envelope?.values?.length) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255,247,230,.42)";
          ctx.lineWidth = Math.max(1, width / 900);
          data.envelope.values.forEach((value, index) => {
            const x = (index / Math.max(data.envelope.values.length - 1, 1)) * width;
            const y = height * 0.84 - Math.min(value * 6, 1) * height * 0.32;
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
        return;
      }
    }

    let lastFrameTime = 0;
    function drawIdle(timestamp = 0) {
      if (timestamp - lastFrameTime < 33) {
        frame = requestAnimationFrame(drawIdle);
        return;
      }
      lastFrameTime = timestamp;
      drawStatic();
      const { width, height } = canvas;
      time += 0.02;
      ctx.beginPath();
      for (let x = 0; x < width; x += 5) {
        const y = height * 0.5 + Math.sin(x * 0.012 + time) * height * 0.08 + Math.sin(x * 0.03 - time * 1.8) * height * 0.035;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      frame = requestAnimationFrame(drawIdle);
    }

    const observer = new ResizeObserver(() => {
      canvasWidth = 0;
      canvasHeight = 0;
      if (data?.waveform) drawStatic();
    });
    observer.observe(canvas);
    if (data?.waveform) drawStatic();
    else drawIdle();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [data]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="音频波形" />;
}

function SpectrumCanvas({ spectrum }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.fillRect(0, 0, width, height);

    const left = 42 * ratio;
    const right = width - 16 * ratio;
    const top = 18 * ratio;
    const bottom = height - 34 * ratio;
    ctx.strokeStyle = "rgba(82,100,73,.22)";
    ctx.fillStyle = "rgba(82,100,73,.72)";
    ctx.lineWidth = 1 * ratio;
    ctx.font = `${11 * ratio}px Microsoft YaHei`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    [0, 25, 50, 75, 100].forEach((label) => {
      const y = bottom - (label / 100) * (bottom - top);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillText(String(label), left - 8 * ratio, y);
    });
    ctx.save();
    ctx.translate(12 * ratio, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("相对能量", 0, 0);
    ctx.restore();

    const values = spectrum?.values || Array.from({ length: 80 }, (_, index) => 0.14 + Math.sin(index * 0.45) * 0.05);
    const plotWidth = right - left;
    const gap = plotWidth / values.length;
    values.forEach((value, index) => {
      const barHeight = Math.max(value, 0.03) * (bottom - top);
      const x = left + index * gap + gap * 0.16;
      const y = bottom - barHeight;
      const gradient = ctx.createLinearGradient(0, y, 0, bottom);
      gradient.addColorStop(0, "rgba(202,169,110,.95)");
      gradient.addColorStop(0.55, "rgba(125,155,133,.72)");
      gradient.addColorStop(1, "rgba(93,112,72,.26)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, Math.max(2 * ratio, gap * 0.56), barHeight);
    });

    ctx.fillStyle = "rgba(82,100,73,.72)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("低频", left + plotWidth * 0.12, bottom + 10 * ratio);
    ctx.fillText("中频", left + plotWidth * 0.5, bottom + 10 * ratio);
    ctx.fillText("高频", left + plotWidth * 0.86, bottom + 10 * ratio);
  }, [spectrum]);

  return <canvas ref={canvasRef} className="h-[360px] w-full rounded-lg border border-white/70 bg-white/40" />;
}

function formatAiReport(text) {
  const clean = String(text || "").trim();
  if (!clean) return [{ title: "等待分析", body: "完成音频分析后，这里会展示 AI 的详细结论。" }];
  const paragraphs = clean
    .replace(/\r/g, "")
    .split(/\n{2,}|(?<=。)\s*(?=[一二三四五六七八九十]、)/)
    .map((item) => item.trim())
    .filter(Boolean);
  const titles = ["综合判断", "频谱与动态", "共鸣与质感", "曲风适配", "综合评价"];
  return (paragraphs.length ? paragraphs : [clean]).map((body, index) => ({
    title: titles[index] || `分析要点 ${index + 1}`,
    body: body.replace(/^#+\s*/, "").replace(/^\d+[.、]\s*/, ""),
  }));
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}
