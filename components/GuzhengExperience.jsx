"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, ChevronRight, Gem, ImageDown, Mail, Music2, Phone, ShieldCheck, Sparkles, UploadCloud, Volume2 } from "lucide-react";
import {
  MAX_ANALYSIS_SECONDS,
  SEGMENT_SECONDS,
  analyzeSegments,
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
  dimensionScores: { balance: "--", purity: "--", resonance: "--", control: "--", brightness: "--", texture: "--" },
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
  styleFit: "系统会根据音区均衡、纯净度、共鸣与音色控制判断适合曲风。",
  spectrumSummary: "等待频谱分析",
  spectrumDetail: "完成分析后，这里会显示频段比例、频谱重心和分段变化。",
  spectrumLabel: "未载入",
  guzhengConfidence: "--",
  analyzedDuration: "--",
  originalDuration: "--",
  wasTrimmed: false,
  segmentAnalyses: [],
  deepseekContext: null,
};

export default function GuzhengExperience({ isMiniProgramShell = false }) {
  const [report, setReport] = useState(initialReport);
  const [status, setStatus] = useState("等待第一段声音进入鉴赏台");
  const [currentFile, setCurrentFile] = useState("尚未载入音频");
  const [fileState, setFileState] = useState("等待采样");
  const [activeSample, setActiveSample] = useState(null);
  const [aiReport, setAiReport] = useState("完成音频分析后，可生成 AI 详细鉴赏报告。");
  const [aiSource, setAiSource] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isMiniProgramView, setIsMiniProgramView] = useState(isMiniProgramShell);
  const [introVisible, setIntroVisible] = useState(!isMiniProgramShell);
  const [introLeaving, setIntroLeaving] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  const [aiReportReady, setAiReportReady] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(true);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [waveform, setWaveform] = useState(null);
  const [spectrum, setSpectrum] = useState(null);
  const [referenceProfiles, setReferenceProfiles] = useState([]);
  const [reportImageUrl, setReportImageUrl] = useState("");
  const [exportPreviewUrl, setExportPreviewUrl] = useState("");
  const [exportHint, setExportHint] = useState("");

  const audioContextRef = useRef(null);
  const musicRef = useRef(null);
  const playerRef = useRef(null);
  const uploadInputRef = useRef(null);
  const reportSectionRef = useRef(null);
  const reportCardRef = useRef(null);
  const aiReportRef = useRef(null);
  const exportPreviewRef = useRef(null);
  const introFinishedRef = useRef(false);
  const introExitTimerRef = useRef(null);

  const finishIntro = useCallback(() => {
    if (introFinishedRef.current) return;
    introFinishedRef.current = true;
    setIntroLeaving(true);
    introExitTimerRef.current = window.setTimeout(() => {
      setIntroVisible(false);
    }, 1100);
  }, []);

  useEffect(() => {
    if (isMiniProgramShell) {
      introFinishedRef.current = true;
      setIsMiniProgramView(true);
      setIntroVisible(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const userAgent = navigator.userAgent || "";
    const inMiniProgram = params.get("mp") === "1" || params.get("client") === "miniprogram" || /miniProgram/i.test(userAgent);
    if (inMiniProgram) {
      introFinishedRef.current = true;
      setIsMiniProgramView(true);
      setIntroVisible(false);
    }
  }, [isMiniProgramShell]);

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
          const mono = mixToMono(decoded, MAX_ANALYSIS_SECONDS);
          const features = extractFeatures(mono.samples, mono.sampleRate, mono.duration);
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

  useEffect(() => {
    return () => {
      if (introExitTimerRef.current) window.clearTimeout(introExitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const sectionIds = ["lab", "samples", "report", "guide"];
    const updateActiveSection = () => {
      const anchor = window.innerHeight * 0.34;
      const current = sectionIds.reduce((active, id) => {
        const element = document.getElementById(id);
        if (!element) return active;
        return element.getBoundingClientRect().top <= anchor ? id : active;
      }, "");
      setActiveSection(current);
    };
    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, []);

  const scoreStyle = useMemo(() => ({ "--score": `${Number(report.score) || 0}%` }), [report.score]);
  const formattedAiReport = useMemo(() => formatAiReport(aiReport), [aiReport]);
  const canExport = report.score !== "--";
  const canGenerateAi = Boolean(report.deepseekContext && report.score !== "--");
  const navLinkClass = (id) =>
    `rounded-full px-3 py-1.5 transition ${
      activeSection === id ? "bg-[#5d7048]/90 text-white shadow-soft" : "hover:bg-white/42 hover:text-[#8a6d35]"
    }`;
  const mobileNavLinkClass = (id) =>
    `rounded-full px-2 py-2 text-center text-[12px] font-medium leading-none transition ${
      activeSection === id ? "bg-[#5d7048] text-white shadow-soft" : "text-[#405136]"
    }`;

  async function ensureAudioContext({ resume = false } = {}) {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (resume && audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }

  async function analyzeArrayBuffer(arrayBuffer, sourceName, sampleMeta, sourceFile = null) {
    try {
      if (sourceFile && isVideoLikeFile(sourceFile)) {
        rejectUnsupportedVideo();
        return;
      }

      setStatus("正在解码音频，并进行古筝音色预检...");
      setFileState("预检中");
      setAiReport("AI 正在等待古筝音色预检结果。");
      setAiSource("");
      setReportImageUrl("");
      setExportPreviewUrl("");
      setExportHint("");
      setAiReportReady(false);

      const context = await ensureAudioContext({ resume: true });
      const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
      const mono = mixToMono(decoded, MAX_ANALYSIS_SECONDS);
      const features = extractFeatures(mono.samples, mono.sampleRate, mono.duration);
      const segmentAnalyses = analyzeSegments(mono.samples, mono.sampleRate, mono.duration, SEGMENT_SECONDS);
      const guzhengCheck = assessGuzhengLikelihood(features, referenceProfiles);

      setWaveform({ waveform: features.waveform, envelope: features.envelope });
      setSpectrum(features.spectrum);

      if (!sampleMeta && !guzhengCheck.isGuzheng) {
        const rejected = buildRejectedReport(sourceName, guzhengCheck);
        setReport(rejected);
        setStatus(`未通过古筝音色预检，置信度 ${guzhengCheck.score}/100。${mono.wasTrimmed ? "已仅检测前 60 秒。" : ""}`);
        setFileState("未评分");
        setAiReport("这段音频未通过古筝声音预检，因此不会生成正式评分。建议上传古筝独奏、少混响、少环境噪声的音频。");
        setAiSource("AI 预检");
        scrollToReport();
        return;
      }

      const nextReport = buildReport(features, sourceName, sampleMeta, guzhengCheck, {
        segmentAnalyses,
        analyzedDuration: mono.duration,
        originalDuration: mono.originalDuration,
        wasTrimmed: mono.wasTrimmed,
      });
      setReport(nextReport);
      setStatus(
        `分析完成，古筝置信度 ${nextReport.guzhengConfidence}/100。已按 ${SEGMENT_SECONDS} 秒分段，${
          mono.wasTrimmed ? "仅取前 60 秒分析。" : "已覆盖全部有效音频。"
        }`,
      );
      setFileState("已完成");
      setAiReport("基础音色分析已完成。点击“生成 AI 报告”后，将调用 AI 生成更完整的具体分析结论。");
      setAiSource("等待生成");
      scrollToReport();
      setTimeout(() => refreshReportImage(false), 180);
    } catch (error) {
      console.error(error);
      setStatus("浏览器无法解码这段音频，请换用 WAV、MP3、M4A 或 FLAC 文件。");
      setFileState("失败");
      if (sourceFile && isServerAudioFallbackCandidate(sourceFile)) {
        console.warn("本地解码失败，切换服务端音频解析。", error);
        await analyzeMediaOnServer(sourceFile);
      }
    }
  }

  async function analyzeMediaOnServer(file) {
    setStatus("正在使用服务端音频解码，并进行古筝音色预检...");
    setFileState("解码中");
    setAiReport("AI 正在等待音频解析结果。");
    setAiSource("");
    setReportImageUrl("");
    setExportPreviewUrl("");
    setExportHint("");
    setAiReportReady(false);

    try {
      const formData = new FormData();
      formData.append("file", file, file.name || "upload.media");
      const response = await fetch("/api/analyze-media", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `音频解析失败：HTTP ${response.status}`);
      }

      setWaveform(data.waveform || null);
      setSpectrum(data.spectrum || null);
      setReport(data.report);
      const media = data.media || {};

      if (data.report?.score === "--") {
        setStatus(`未通过古筝音色预检，置信度 ${data.report.guzhengConfidence}/100。`);
        setFileState("未评分");
        setAiReport("音频未通过古筝声音预检，因此不会生成正式评分。建议上传古筝独奏、少混响、少环境噪声的录音。");
        setAiSource("AI 预检");
      } else {
        setStatus(
          `分析完成，古筝置信度 ${data.report.guzhengConfidence}/100。已取前 ${Math.round(media.analyzedDuration || MAX_ANALYSIS_SECONDS)} 秒音频分析${
            media.wasTrimmed ? "，后续音频已自动舍弃。" : "。"
          }`,
        );
        setFileState("已完成");
        setAiReport("基础音色分析已完成。点击“生成 AI 报告”后，将调用 AI 生成更完整的具体分析结论。");
        setAiSource("等待生成");
        setTimeout(() => refreshReportImage(false), 180);
      }
      scrollToReport();
    } catch (error) {
      console.error(error);
      setStatus(error.message || "音频解析失败，请换用 M4A、MP3、WAV 或 FLAC。");
      setFileState("失败");
    }
  }

  async function requestAiReport(context) {
    if (!context) return;
    setIsAiLoading(true);
    setAiReportReady(false);
    try {
      const response = await fetch("/api/deepseek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `AI 请求失败：HTTP ${response.status}`);
      }
      setAiReport(data.report || "AI 未返回报告，已保留基础分析结果。");
      setAiSource(data.source === "deepseek" ? "AI API" : "本地专业兜底");
      return true;
    } catch (error) {
      setAiReport(`详细报告暂未生成：${error.message}`);
      setAiSource("请求失败");
      return false;
    } finally {
      setIsAiLoading(false);
    }
  }

  function scrollToReport() {
    setTimeout(() => {
      reportSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }

  async function generateAiReport() {
    if (!report.deepseekContext) return;
    const generated = await requestAiReport(report.deepseekContext);
    if (!generated) return;
    await nextFrame();
    await refreshReportImage(false);
    setAiReportReady(true);
  }

  function rejectUnsupportedVideo() {
    setFileState("不支持");
    setStatus("当前版本仅支持音频文件。请先从视频中导出 M4A、MP3、WAV 或 FLAC 音频后再上传。");
    setWaveform(null);
    setSpectrum(null);
    setReport(initialReport);
    setAiReport("为节省服务器带宽与解析时间，视频文件不会上传分析。");
    setAiSource("");
    setReportImageUrl("");
    setExportPreviewUrl("");
    setExportHint("");
    setAiReportReady(false);
    if (playerRef.current) {
      playerRef.current.removeAttribute("src");
      playerRef.current.load();
    }
  }

  async function handleUserFile(file) {
    if (!file) return;
    setActiveSample(null);
    setCurrentFile(file.name);
    if (isVideoLikeFile(file)) {
      rejectUnsupportedVideo();
      return;
    }
    setFileState("分析中");
    setStatus("正在读取上传音频...");
    if (playerRef.current) {
      playerRef.current.src = URL.createObjectURL(file);
      playerRef.current.load();
    }
    await analyzeArrayBuffer(await file.arrayBuffer(), file.name, parseSampleName(file.name), file);
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

  async function refreshReportImage(download = false, options = {}) {
    if (!reportCardRef.current || report.score === "--") return "";
    const preferCanvas = options.preferCanvas || isMobileExportEnvironment();
    let dataUrl = "";

    if (preferCanvas) {
      dataUrl = await createCanvasReportImage(report);
    } else {
      try {
        const { toPng } = await import("html-to-image");
        dataUrl = await toPng(reportCardRef.current, {
          cacheBust: true,
          pixelRatio: 2,
          backgroundColor: "#f6edda",
          filter: (node) => !node?.dataset?.exportHidden,
        });
      } catch (error) {
        console.warn("DOM 导出失败，已切换 Canvas 报告图。", error);
        dataUrl = await createCanvasReportImage(report);
      }
    }

    setReportImageUrl(dataUrl);
    if (options.preview) setExportPreviewUrl(dataUrl);
    if (download) downloadDataUrl(dataUrl, `古筝音色分析报告-${Date.now()}.png`);
    return dataUrl;
  }

  async function exportReportImage() {
    setIsExporting(true);
    setExportHint("");
    try {
      const dataUrl = await refreshReportImage(false, {
        preferCanvas: isMobileExportEnvironment(),
        preview: true,
      });
      if (!dataUrl) return;

      if (supportsDirectDownload()) {
        downloadDataUrl(dataUrl, `古筝音色分析报告-${Date.now()}.png`);
        setExportHint("报告图片已开始下载。");
      } else {
        setExportHint("报告图片已生成，请长按下方图片保存到相册。");
        await nextFrame();
        exportPreviewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (error) {
      console.error(error);
      setExportHint("导出失败，请稍后重试或更换浏览器。");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f5efd9] pb-24 text-ink md:pb-0">
      <audio ref={musicRef} src="/bg-music.flac" preload="metadata" />
      {introVisible && !isMiniProgramView ? <IntroOverlay leaving={introLeaving} onDone={finishIntro} /> : null}

      <header
        className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between px-4 py-4 transition duration-500 md:px-10 md:py-5"
      >
        <button
          type="button"
          onClick={toggleMusic}
          className="group flex h-12 w-12 items-center justify-center rounded-full border border-white/70 bg-white/40 text-[#5d6f45] shadow-soft backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/55 md:h-14 md:w-14"
          aria-label={isMusicPlaying ? "暂停背景音乐" : "播放背景音乐"}
          title={isMusicPlaying ? "暂停背景音乐" : "播放背景音乐"}
        >
          <span className={isMusicPlaying ? "music-spin" : ""}>
            <Music2 className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.8} />
          </span>
        </button>
        <nav className="hidden items-center gap-3 rounded-full border border-white/50 bg-white/25 px-4 py-2 text-sm text-[#3e4e34] shadow-soft backdrop-blur-xl md:flex">
          <a href="#lab" className={navLinkClass("lab")}>
            听音识色
          </a>
          <a href="#samples" className={navLinkClass("samples")}>
            名琴声档
          </a>
          <a href="#report" className={navLinkClass("report")}>
            AI 报告
          </a>
          <a href="#guide" className={navLinkClass("guide")}>
            使用指南
          </a>
        </nav>
      </header>

      <nav className="fixed bottom-3 left-3 right-3 z-50 grid grid-cols-4 gap-1 rounded-full border border-white/70 bg-[#fff8e8]/78 p-1.5 shadow-[0_18px_60px_rgba(42,54,35,0.24)] backdrop-blur-xl md:hidden">
        <a href="#lab" className={mobileNavLinkClass("lab")}>
          听音
        </a>
        <a href="#samples" className={mobileNavLinkClass("samples")}>
          声档
        </a>
        <a href="#report" className={mobileNavLinkClass("report")}>
          报告
        </a>
        <a href="#guide" className={mobileNavLinkClass("guide")}>
          指南
        </a>
      </nav>

      <section className="relative min-h-[100svh] overflow-hidden">
        <div className="absolute inset-0 bg-[url('/hero-bg.png')] bg-cover bg-[38%_center] md:bg-center" />
        {!isMiniProgramView ? (
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src="/bg.mp4"
            poster="/hero-bg.png"
            muted
            playsInline
            autoPlay
            loop
            preload="auto"
            aria-hidden="true"
          />
        ) : null}
        <div className="hero-breathe absolute inset-0 bg-gradient-to-b from-white/18 via-white/0 to-[#f5efd9]" />
        <div className="absolute inset-y-0 right-0 w-[68vw] bg-gradient-to-l from-[#142014]/72 via-[#213018]/34 to-transparent" />
        <div className="hero-mist absolute inset-x-[-12%] top-[13%] h-40 bg-gradient-to-r from-transparent via-white/34 to-transparent blur-2xl" />
        <div className="hero-water absolute bottom-[12%] left-0 right-0 h-28 bg-[linear-gradient(180deg,transparent,rgba(245,239,217,.18)),repeating-linear-gradient(0deg,rgba(255,250,236,.34)_0_1px,transparent_1px_13px)]" />
        <div className="hero-light-sweep absolute inset-y-0 right-[-12%] w-[48vw] bg-gradient-to-l from-white/36 via-white/12 to-transparent" />
        <MountainAnimation />
        <div className="pointer-events-none absolute bottom-[18%] left-[13%] right-[36%] hidden h-px overflow-hidden md:block">
          <div className="string-glow h-px w-full bg-gradient-to-r from-transparent via-[#fff3c5] to-transparent" />
        </div>

        <div className="relative z-10 flex min-h-[100svh] items-center justify-center px-4 pb-24 pt-24 md:justify-end md:px-[9vw] md:pb-20">
          <div className="w-full max-w-[500px] text-center md:mt-4">
            <p className="hero-copy-glow mb-4 text-[12px] uppercase tracking-[0.12em] text-[#f3d78c] sm:text-sm sm:tracking-[0.18em]">
              Guzheng Timbre Intelligence
            </p>
            <h1 className="hero-title-glow mx-auto max-w-[520px] text-[42px] font-semibold leading-tight text-[#fff7e6] sm:text-5xl md:text-6xl">
              古筝 AI 音色鉴赏
            </h1>
            <p className="hero-copy-glow mx-auto mt-5 max-w-[430px] text-base leading-8 text-[#fff1c6] md:mt-6 md:text-[20px] md:leading-9">
              以频谱、共鸣、动态与木质感为线索，听见一张古筝真正的气质。
            </p>
            <div className="mt-7 flex justify-center md:mt-8">
              <a
                href="#lab"
                className="group inline-flex h-[52px] min-w-[160px] items-center justify-center gap-2 rounded-full border border-[#ffe8ac]/80 bg-gradient-to-r from-[#fff0c8]/95 to-[#cda75d]/95 px-7 py-3 text-base font-semibold text-[#2d2413] shadow-[0_18px_50px_rgba(33,48,24,0.35)] transition hover:shadow-[0_24px_60px_rgba(33,48,24,0.42)] md:h-14 md:min-w-[172px] md:gap-3 md:px-8 md:text-[17px]"
              >
                <Volume2 className="h-5 w-5" strokeWidth={1.8} />
                <span>听音识色</span>
                <ChevronRight className="h-5 w-5 transition group-hover:translate-x-1" strokeWidth={1.8} />
              </a>
            </div>
            {autoplayBlocked ? (
              <p className="hero-copy-glow mt-5 text-sm text-[#fff1c6]">浏览器已拦截自动播放，点击左上角音符即可开启背景音乐。</p>
            ) : null}
          </div>
        </div>
      </section>

      <section id="lab" className="relative bg-[#f5efd9] px-4 py-14 md:px-10 md:py-24">
        <SectionTitle
          eyebrow="AI Tone Studio"
          title="上传一段古筝音频，生成音色品鉴"
          text="系统会先进行古筝声音预检，通过后仅取前 60 秒音频，并按每 10 秒分段读取响度包络、动态范围、频谱重心与尾音衰减。"
        />

        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="glass-panel rounded-lg p-5 md:p-6">
            <div className="mb-6 flex items-center gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#5d7048] text-paper md:h-12 md:w-12">
                <UploadCloud className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.8} />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-[#25321f] md:text-2xl">音频采样</h2>
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
              className="grid min-h-[190px] w-full place-items-center rounded-lg border border-dashed border-[#afbd9f] bg-white/38 p-5 text-center transition-colors hover:border-[#caa96e] hover:bg-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#caa96e]/55 md:min-h-[230px] md:p-8"
            >
              <input
                ref={uploadInputRef}
                type="file"
                accept="audio/*,.flac,.wav,.mp3,.m4a,.aac,.ogg,.opus"
                className="hidden"
                onChange={(event) => handleUserFile(event.target.files?.[0])}
              />
              <span className="grid h-16 w-16 place-items-center rounded-full border border-[#caa96e]/60 bg-[#fff7e6]/80 text-[#9d7b39] md:h-20 md:w-20">
                <Sparkles className="h-7 w-7 md:h-9 md:w-9" strokeWidth={1.5} />
              </span>
              <span className="mt-4 block text-lg font-semibold text-[#2d3826] md:mt-5 md:text-xl">拖入或选择古筝音频</span>
              <span className="mt-2 block max-w-[280px] text-sm leading-6 text-[#65745a]">
                仅支持音频文件；超过 60 秒时，系统只分析前 60 秒
              </span>
            </button>

            <div className="mt-5 flex min-h-14 items-center justify-between gap-3 rounded-lg border border-white/60 bg-white/36 px-3 text-sm text-[#516146] md:gap-4 md:px-4">
              <span className="truncate">{currentFile}</span>
              <b className="shrink-0 font-medium text-[#9a7b3d]">{fileState}</b>
            </div>

            <audio ref={playerRef} controls className="mt-5 w-full" />
          </section>

          <section className="dark-glass relative min-h-[330px] overflow-hidden rounded-lg p-4 text-paper md:min-h-[480px] md:p-5">
            {waveform?.waveform ? <WaveformCanvas data={waveform} /> : <IdleWaveform />}
            <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3 rounded-lg border border-white/20 bg-[#1f2b1b]/62 px-4 py-3 backdrop-blur-xl md:bottom-5 md:left-5 md:right-5 md:py-4">
              <span className="h-2.5 w-2.5 rounded-full bg-[#f3d78c] shadow-[0_0_22px_rgba(243,215,140,0.9)]" />
              <p className="m-0 text-sm leading-6 text-white/78">{status}</p>
            </div>
          </section>
        </div>
      </section>

      <section id="samples" className="relative bg-[#edf3df] px-4 py-14 md:px-10 md:py-20">
        <SectionTitle eyebrow="Reference Archive" title="不同价位古筝声档" compact />
        <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {referenceSamples.map((sample) => (
            <button
              key={sample.file}
              type="button"
              onClick={() => loadReferenceSample(sample)}
              className={`group min-h-[160px] rounded-lg border p-4 text-left shadow-soft transition hover:-translate-y-1 md:min-h-[190px] md:p-5 ${
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

      <section ref={reportSectionRef} id="report" className="bg-[#f5efd9] px-4 py-14 md:px-10 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_380px]">
          <ReportCard
            refTarget={reportCardRef}
            report={report}
            spectrum={spectrum}
            scoreStyle={scoreStyle}
            onExport={exportReportImage}
            isExporting={isExporting}
            canExport={canExport}
            exportPreviewRef={exportPreviewRef}
            exportPreviewUrl={exportPreviewUrl}
            exportHint={exportHint}
          />

          <aside className="glass-panel rounded-lg p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <span className="text-sm text-[#66755b]">频谱分析</span>
              <b className="text-sm font-medium text-[#a17a34]">{report.spectrumLabel}</b>
            </div>
            <SpectrumCanvas spectrum={spectrum} />
            <div className="mt-3 rounded-lg bg-white/42 px-4 py-3 text-sm text-[#526449]">
              {report.spectrumSummary}
            </div>
            <div className="mt-3 rounded-lg border border-white/65 bg-white/32 px-4 py-3 text-sm leading-6 text-[#526449]">
              {report.spectrumDetail}
            </div>
          </aside>
        </div>

        <section className="mx-auto mt-6 max-w-6xl">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 text-sm uppercase text-[#a17a34]">AI Detailed Review</p>
              <h2 className="text-2xl font-semibold text-[#25321f]">AI 具体分析报告</h2>
            </div>
            <div className="flex justify-stretch md:justify-end">
              <button
                type="button"
                onClick={generateAiReport}
                disabled={isAiLoading || !canGenerateAi}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[#8ba079]/60 bg-[#5d7048] px-5 text-sm font-medium text-white shadow-soft transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 md:w-auto"
              >
                <Sparkles className="h-4 w-4" />
                生成 AI 报告
              </button>
            </div>
          </div>

          <article ref={aiReportRef} className="overflow-hidden rounded-lg border border-white/70 bg-[#f5efd9] shadow-soft">
            <div className="bg-gradient-to-br from-[#fffaf0] via-[#f3ead3] to-[#e0ebd4] p-5 md:p-8">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm uppercase text-[#a17a34]">AI Detailed Review</p>
                  <h3 className="mt-2 text-2xl font-semibold text-[#25321f] md:text-3xl">古筝音色详细鉴赏</h3>
                  <p className="mt-2 text-sm text-[#60734c]">
                    {aiReportReady ? `来源：${aiSource || "AI"} · 古筝置信度：${report.guzhengConfidence}/100` : "点击生成 AI 报告后，将显示完整图文结论。"}
                  </p>
                </div>
              </div>
            </div>

            {aiReportReady ? (
              <>
                <div className="bg-[#f5efd9] p-3 md:p-8">
                  <div className="overflow-hidden rounded-lg border border-white/70 bg-white/62 p-2 md:p-3">
                  <img src={reportImageUrl} alt="音色分析报告图片" className="w-full max-w-full rounded-md" />
                  </div>
                </div>

                <div className="bg-[#f5efd9] px-4 pb-5 md:px-8 md:pb-8">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                    <MiniStat title="综合评分" value={report.score} />
                    <MiniStat title="音区均衡" value={report.dimensionScores.balance} />
                    <MiniStat title="音色纯净" value={report.dimensionScores.purity} />
                    <MiniStat title="共鸣表现" value={report.dimensionScores.resonance} />
                    <MiniStat title="音色控制" value={report.dimensionScores.control} />
                  </div>
                </div>

                {report.segmentAnalyses?.length ? (
                  <div className="grid gap-4 bg-[#f5efd9] px-4 pb-5 md:px-8 md:pb-8 lg:grid-cols-2">
                    <ComparisonChartCard
                      title="频谱与动态"
                      text="每 10 秒对比频谱重心与动态范围，观察亮度和强弱层次是否稳定。"
                    >
                      <SegmentComparisonCanvas data={report.segmentAnalyses} mode="spectrumDynamic" />
                    </ComparisonChartCard>
                    <ComparisonChartCard
                      title="共鸣与纯净"
                      text="每 10 秒对比共鸣时间与音色纯净度，观察尾音支撑和杂散感变化。"
                    >
                      <SegmentComparisonCanvas data={report.segmentAnalyses} mode="resonanceTexture" />
                    </ComparisonChartCard>
                  </div>
                ) : null}

                <div className="grid gap-4 bg-[#f5efd9] p-4 md:p-8">
                  {formattedAiReport.map((block, index) => (
                    <section
                      key={`${block.title}-${index}`}
                      className="rounded-lg border border-[#e2d4b3] bg-[#f5efd9] p-5"
                    >
                      <h5 className="mb-3 text-base font-semibold text-[#8a6d35]">{block.title}</h5>
                      <p className="whitespace-pre-line text-[15px] leading-8 text-[#35402d]">{block.body}</p>
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <div className="bg-[#f5efd9] p-4 md:p-8">
                <div className="rounded-lg border border-dashed border-[#c9b98e] bg-[#fbf6e8]/60 p-6 text-center text-sm text-[#6f7c61] md:p-8">
                  {isAiLoading ? "AI 正在生成图文报告，请稍候。" : "生成 AI 报告后，报告图片、评分、分段图表和具体结论会一起出现。"}
                </div>
              </div>
            )}
          </article>
        </section>
      </section>

      <section id="guide" className="relative bg-[#edf3df] px-4 py-14 md:px-10 md:py-24">
        <SectionTitle
          eyebrow="Care & Guide"
          title="隐私政策、使用说明与新手选筝"
          text="把音色检测、选琴判断和购买沟通放在同一处，方便你在试听、对比和决策时快速查阅。"
        />

        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-2">
          <FooterInfoCard icon={ShieldCheck} eyebrow="Privacy" title="隐私政策">
            <p>最后更新时间：2026 年 7 月 2 日。</p>
            <p>
              本网页不会采集、保存或转存你的原始音频片段。基础音色分析在浏览器内完成；当你点击生成 AI 报告时，仅提交频谱、动态、共鸣、分段评分等结构化特征，不包含原始音频文件。
            </p>
            <p>联系方式仅用于答复咨询、购筝沟通或售后协助，不会用于无关营销转交。</p>
          </FooterInfoCard>

          <FooterInfoCard icon={BookOpenCheck} eyebrow="How To Use" title="使用说明">
            <p>
              音色评分会先判断音频是否接近古筝独奏，再截取前 60 秒并按每 10 秒分段解析，综合音区均衡、音色纯净、共鸣表现与音色控制四项生成结果。
            </p>
            <ol className="space-y-3 pl-5">
              <li>
                <b>逐弦轻拨，基础排查：</b>从低音到高音逐根轻拨，听是否有木头杂音、狼音、金属摩擦声，并留意单弦音准是否稳定。
              </li>
              <li>
                <b>技巧试弹，测试衔接：</b>尝试托劈、刮奏、滑音与揉弦，重点感受高、中、低音区过渡是否顺滑，强弱变化是否可控。
              </li>
              <li>
                <b>曲目试奏，整体感受：</b>用熟悉的入门旋律做整体试听，判断中音是否圆润、低音是否浑厚、高音是否清亮，多台琴对比会更直观。
              </li>
            </ol>
          </FooterInfoCard>

          <FooterInfoCard icon={Gem} eyebrow="Buying Notes" title="新手选筝">
            <ul className="space-y-3 pl-5">
              <li>
                <b>看面板纹路：</b>优先选择纹理顺直、连贯、少杂乱砸纹的面板。面板等级通常决定声音上限，是判断音色基础的第一步。
              </li>
              <li>
                <b>看侧板材质：</b>高端筝常用质感自然的硬木侧板，低端贴皮仿木纹会显得纹理重复、触感轻薄，可从纹理、色泽和触感对比。
              </li>
              <li>
                <b>看品牌与品控：</b>有十年以上沉淀、具备稳定量产能力的品牌，通常更容易保证品质下限；认证、名家评价和真实用户反馈也值得参考。
              </li>
              <li>
                <b>看预算匹配：</b>主流价位大多遵循一分钱一分货。初学建议尽量不要低于 4500-5000 元区间，这个价位更容易兼顾音色与手感。
              </li>
            </ul>
            <p>
              如果已经拥有一台古筝，不必过分纠结是否顶级。只要不是几百元的超低价产品，主流价位通常足够支持初、中级学习；适合自己、愿意长期练习，才是最重要的选择。
            </p>
          </FooterInfoCard>

          <FooterInfoCard icon={Mail} eyebrow="Contact" title="联系方式">
            <p>如需购买古筝、试听建议或选筝咨询，可以通过以下方式联系：</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <a
                href="mailto:917801787@qq.com"
                className="inline-flex min-w-0 items-center gap-3 rounded-lg border border-white/70 bg-white/50 px-4 py-3 text-sm font-medium text-[#2f3b28] transition hover:-translate-y-0.5 hover:bg-white/72 sm:text-base"
              >
                <Mail className="h-4 w-4 shrink-0 text-[#a17a34]" />
                <span className="min-w-0 break-all">917801787@qq.com</span>
              </a>
              <a
                href="tel:17370002516"
                className="inline-flex min-w-0 items-center gap-3 rounded-lg border border-white/70 bg-white/50 px-4 py-3 text-sm font-medium text-[#2f3b28] transition hover:-translate-y-0.5 hover:bg-white/72 sm:text-base"
              >
                <Phone className="h-4 w-4 shrink-0 text-[#a17a34]" />
                <span className="min-w-0 break-all">17370002516</span>
              </a>
            </div>
            <p className="text-sm text-[#6b775f]">建议沟通时说明预算、学习阶段、偏好的音色方向，以及是否需要适配儿童或成人初学。</p>
          </FooterInfoCard>
        </div>
      </section>
    </main>
  );
}

function ReportCard({ refTarget, report, scoreStyle, onExport, isExporting, canExport, exportPreviewRef, exportPreviewUrl, exportHint }) {
  return (
    <section ref={refTarget} className="glass-panel rounded-lg p-5 md:p-7">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="mb-3 text-sm uppercase text-[#a17a34]">AI Timbre Report</p>
          <h2 className="text-[32px] font-semibold leading-tight text-[#25321f] md:text-5xl">音色分析报告</h2>
        </div>
        <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full bg-[conic-gradient(from_-90deg,#caa96e_var(--score),rgba(106,125,85,.16)_0)] text-[#25321f] md:h-28 md:w-28" style={scoreStyle}>
          <div className="grid h-[74px] w-[74px] place-items-center rounded-full bg-[#f9f2df] md:h-[86px] md:w-[86px]">
            <span className="text-2xl font-bold md:text-3xl">{report.score}</span>
            <small className="-mt-6 text-xs text-[#718064]">/100</small>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {report.traits.map((trait) => (
          <span
            key={trait}
            className="inline-flex min-w-[92px] flex-none justify-center whitespace-nowrap rounded-full border border-[#cad6bc] bg-white/45 px-3 py-2 text-center text-[13px] leading-none text-[#526449]"
          >
            {trait}
          </span>
        ))}
      </div>

      <p className="mt-5 rounded-lg border border-white/65 bg-white/42 p-4 text-base leading-8 text-[#35402d] md:p-5 md:text-lg md:leading-9">
        {report.summary}
      </p>

      {report.analyzedDuration && report.analyzedDuration !== "--" ? (
        <div className="mt-4 rounded-lg border border-[#d9e2ca] bg-white/38 px-4 py-3 text-sm leading-6 text-[#5c6b51]">
          分析窗口：已分析 {formatSeconds(report.analyzedDuration)}
          {report.wasTrimmed ? `，原音频 ${formatSeconds(report.originalDuration)}，超过 60 秒部分已自动舍弃。` : "，未触发截断。"}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <ScoreCard title="音区均衡" value={report.dimensionScores.balance} />
        <ScoreCard title="音色纯净" value={report.dimensionScores.purity} />
        <ScoreCard title="共鸣表现" value={report.dimensionScores.resonance} />
        <ScoreCard title="音色控制" value={report.dimensionScores.control} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <Metric title="古筝置信度" value={`${report.guzhengConfidence}/100`} text="预检结果" />
        <Metric title="动态范围" value={report.dynamicValue} text={report.dynamicText} />
        <Metric title="共鸣时间" value={report.resonanceValue} text={report.resonanceText} />
        <Metric title="木材推测" value={report.woodValue} text={report.woodText} />
        <Metric title="声音年龄" value={report.ageValue} text={report.ageText} />
      </div>

      <div className="mt-4 rounded-lg border border-[#d9e2ca] bg-white/38 px-4 py-3 text-sm leading-6 text-[#5c6b51]">
        音色评分基于音区均衡、音色纯净、共鸣表现与音色控制四项综合估算；参考声档仅辅助定位声学轮廓，不按价格直接给高分。
      </div>

      {report.segmentAnalyses?.length ? (
        <section className="mt-5 rounded-lg border border-white/65 bg-white/36 p-3 md:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-[#25321f]">10 秒分段解析</h3>
            <span className="whitespace-nowrap text-sm text-[#8a6d35]">{report.segmentAnalyses.length} 段</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {report.segmentAnalyses.map((segment) => (
              <article key={segment.index} className="rounded-lg border border-[#dfe5d3] bg-white/45 p-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                  <b className="text-[#8a6d35]">
                    {segment.startSecond}-{segment.endSecond}s
                  </b>
                  <span className="text-[#60734c]">{segment.centroidHz} Hz</span>
                </div>
                <p className="text-sm leading-6 text-[#526449]">{segment.summary}</p>
                <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px] text-[#66755b] sm:gap-2 sm:text-xs">
                  <span className="rounded-md bg-[#eef3e5] px-1.5 py-1 sm:px-2">衡 {segment.balance}</span>
                  <span className="rounded-md bg-[#f4ecd8] px-1.5 py-1 sm:px-2">净 {segment.purity}</span>
                  <span className="rounded-md bg-[#eef3e5] px-1.5 py-1 sm:px-2">鸣 {segment.resonance}</span>
                  <span className="rounded-md bg-[#f4ecd8] px-1.5 py-1 sm:px-2">控 {segment.control}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

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

      <div data-export-hidden="true" className="mt-5 flex justify-stretch sm:justify-end">
        <button
          type="button"
          onClick={onExport}
          disabled={isExporting || !canExport}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[#caa96e]/60 bg-white/60 px-5 text-sm font-medium text-[#5d4a24] shadow-soft transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
        >
          <ImageDown className="h-4 w-4" />
          {isExporting ? "正在生成图片" : "导出报告图片"}
        </button>
      </div>

      <div data-export-hidden="true" ref={exportPreviewRef} className="mt-4">
        {exportHint ? (
          <div className="rounded-lg border border-[#d9e2ca] bg-white/48 px-4 py-3 text-sm leading-6 text-[#5c6b51]">
            {exportHint}
          </div>
        ) : null}
        {exportPreviewUrl ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-white/70 bg-white/58 p-2">
            <img src={exportPreviewUrl} alt="可保存的音色分析报告图片" className="block w-full rounded-md" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function IntroOverlay({ leaving, onDone }) {
  const [videoReady, setVideoReady] = useState(false);
  const videoOpacity = leaving || !videoReady ? "opacity-0" : "opacity-100";
  const videoScale = leaving ? "scale-[1.018]" : "scale-100";

  useEffect(() => {
    if (!videoReady) {
      const fallback = window.setTimeout(onDone, 5000);
      return () => window.clearTimeout(fallback);
    }
    const release = window.setTimeout(onDone, 3400);
    return () => window.clearTimeout(release);
  }, [onDone, videoReady]);

  useEffect(() => {
    const fallback = window.setTimeout(onDone, 9000);
    return () => window.clearTimeout(fallback);
  }, [onDone]);

  return (
    <div
      className={`intro-overlay fixed inset-0 z-[80] overflow-hidden bg-[#f5efd9] transition duration-1000 ease-out ${
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[url('/hero-bg.png')] bg-cover bg-[38%_center] md:bg-center" />
      <video
        className={`absolute inset-0 h-full w-full object-cover transition duration-700 ${videoOpacity} ${videoScale}`}
        src="/bg.mp4"
        muted
        playsInline
        autoPlay
        preload="auto"
        onCanPlay={() => setVideoReady(true)}
        onLoadedData={() => setVideoReady(true)}
        onTimeUpdate={(event) => {
          if (event.currentTarget.currentTime >= 3) onDone();
        }}
        onEnded={onDone}
        onError={onDone}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-[#f5efd9]/38" />
      <div className={`intro-veil absolute inset-0 bg-[#f5efd9] ${videoReady ? "opacity-0" : "opacity-45"}`} />
    </div>
  );
}

function SectionTitle({ eyebrow, title, text, compact = false }) {
  return (
    <div className={`mx-auto max-w-3xl text-center ${compact ? "mb-10" : "mb-12"}`}>
      <p className="mb-3 text-sm uppercase text-[#a17a34]">{eyebrow}</p>
      <h2 className="text-[28px] font-semibold leading-tight text-[#25321f] sm:text-3xl md:text-5xl">{title}</h2>
      {text ? <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-8 text-[#65745a] md:mt-5 md:text-[16px]">{text}</p> : null}
    </div>
  );
}

function FooterInfoCard({ icon: Icon, eyebrow, title, children }) {
  return (
    <article className="glass-panel rounded-lg p-5 md:p-7">
      <div className="mb-5 flex items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#caa96e]/45 bg-[#fff7e6]/70 text-[#8a6d35] md:h-12 md:w-12">
          <Icon className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[#a17a34]">{eyebrow}</p>
          <h3 className="mt-1 text-xl font-semibold text-[#25321f] md:text-2xl">{title}</h3>
        </div>
      </div>
      <div className="space-y-4 text-[14px] leading-8 text-[#526449] md:text-[15px]">{children}</div>
    </article>
  );
}

function ScoreCard({ title, value }) {
  const numeric = Number(value) || 0;
  return (
    <article className="rounded-lg border border-white/65 bg-white/42 p-3 md:p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[#66755b]">{title}</span>
        <b className="text-xl text-[#9a7b3d] md:text-2xl">{value}</b>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#dfe8d0]">
        <div className="h-full rounded-full bg-gradient-to-r from-[#7d9b85] to-[#caa96e]" style={{ width: `${numeric}%` }} />
      </div>
    </article>
  );
}

function Metric({ title, value, text }) {
  return (
    <article className="rounded-lg border border-white/65 bg-white/42 p-3 md:p-4">
      <span className="text-sm text-[#66755b]">{title}</span>
      <strong className="mt-3 block text-lg leading-tight text-[#9a7b3d] md:text-xl">{value}</strong>
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

function formatSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return "未知时长";
  return `${seconds.toFixed(seconds % 1 ? 1 : 0)} 秒`;
}

function MiniStat({ title, value }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/55 p-3 md:p-4">
      <span className="text-sm text-[#65745a]">{title}</span>
      <b className="mt-2 block text-xl text-[#9a7b3d] md:text-2xl">{value}</b>
    </div>
  );
}

function ComparisonChartCard({ title, text, children }) {
  return (
    <section className="rounded-lg border border-white/70 bg-white/58 p-3 md:p-4">
      <div className="mb-3">
        <h5 className="text-base font-semibold text-[#25321f]">{title}</h5>
        <p className="mt-1 text-sm leading-6 text-[#60734c]">{text}</p>
      </div>
      {children}
    </section>
  );
}

function SegmentComparisonCanvas({ data, mode }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    let frame = 0;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.6);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(255,255,255,.34)";
      ctx.fillRect(0, 0, width, height);

      const left = 42 * ratio;
      const right = width - 20 * ratio;
      const top = 52 * ratio;
      const bottom = height - 44 * ratio;
      const plotWidth = Math.max(1, right - left);
      const plotHeight = Math.max(1, bottom - top);
      const points = Array.isArray(data) && data.length ? data : [];

      ctx.strokeStyle = "rgba(82,100,73,.18)";
      ctx.lineWidth = 1 * ratio;
      ctx.font = `${11 * ratio}px Microsoft YaHei`;
      ctx.fillStyle = "rgba(82,100,73,.68)";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      [0, 25, 50, 75, 100].forEach((label) => {
        const y = bottom - (label / 100) * plotHeight;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillText(String(label), left - 8 * ratio, y);
      });

      ctx.save();
      ctx.translate(13 * ratio, top + plotHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText("归一化对比", 0, 0);
      ctx.restore();

      if (!points.length) {
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(82,100,73,.58)";
        ctx.fillText("等待 10 秒分段数据", left + plotWidth / 2, top + plotHeight / 2);
        return;
      }

      const series =
        mode === "spectrumDynamic"
          ? [
              { name: "频谱重心", unit: "Hz", color: "#b88b3d", values: points.map((item) => item.centroidHz), min: 450, max: 2600 },
              { name: "动态范围", unit: "dB", color: "#5d7048", values: points.map((item) => item.dynamicDb), min: 5, max: 28 },
            ]
          : [
              { name: "共鸣时间", unit: "秒", color: "#b88b3d", values: points.map((item) => item.resonanceSeconds), min: 1.8, max: 6.4 },
              { name: "音色纯净", unit: "分", color: "#5d7048", values: points.map((item) => item.purity ?? item.texture), min: 35, max: 100 },
            ];

      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      series.forEach((item, index) => {
        const x = left;
        const y = 14 * ratio + index * 18 * ratio;
        ctx.fillStyle = item.color;
        ctx.fillRect(x, y - 4 * ratio, 16 * ratio, 3 * ratio);
        ctx.fillStyle = "rgba(49,61,40,.78)";
        ctx.fillText(`${item.name} ${formatRange(item.values, item.unit)}`, x + 22 * ratio, y - 2 * ratio);
      });

      const xFor = (index) => left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
      const yFor = (value, item) => {
        const normalized = clampClient((value - item.min) / (item.max - item.min), 0, 1);
        return bottom - normalized * plotHeight;
      };

      series.forEach((item) => {
        ctx.beginPath();
        item.values.forEach((value, index) => {
          const x = xFor(index);
          const y = yFor(value, item);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2.2 * ratio;
        ctx.stroke();

        item.values.forEach((value, index) => {
          const x = xFor(index);
          const y = yFor(value, item);
          ctx.fillStyle = "#fffaf0";
          ctx.beginPath();
          ctx.arc(x, y, 4.5 * ratio, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = item.color;
          ctx.lineWidth = 1.5 * ratio;
          ctx.stroke();
        });
      });

      ctx.fillStyle = "rgba(82,100,73,.72)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      points.forEach((segment, index) => {
        const x = xFor(index);
        ctx.fillText(`${segment.startSecond}-${segment.endSecond}s`, x, bottom + 12 * ratio);
      });
    };

    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    });
    observer.observe(canvas);
    draw();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [data, mode]);

  return <canvas ref={canvasRef} className="h-[220px] w-full rounded-lg border border-white/70 bg-white/38 md:h-[260px]" />;
}

function clampClient(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatRange(values, unit) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const digits = unit === "Hz" || unit === "分" ? 0 : 1;
  return `${min.toFixed(digits)}-${max.toFixed(digits)}${unit}`;
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

    function clearCanvas() {
      resizeIfNeeded();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function drawStatic() {
      resizeIfNeeded();
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

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

    const observer = new ResizeObserver(() => {
      canvasWidth = 0;
      canvasHeight = 0;
      if (data?.waveform) drawStatic();
      else clearCanvas();
    });
    observer.observe(canvas);
    if (data?.waveform) drawStatic();
    else clearCanvas();

    return () => {
      observer.disconnect();
    };
  }, [data]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full select-none" aria-label="音频波形" />;
}

function IdleWaveform() {
  return (
    <svg
      className="idle-wave pointer-events-none absolute inset-0 h-full w-full select-none"
      viewBox="0 0 1000 480"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        className="idle-wave-line idle-wave-line-a"
        d="M0 286 C78 286 78 238 156 238 C228 238 220 256 292 210 C358 168 398 158 454 218 C520 288 570 242 632 264 C710 292 714 334 780 338 C852 342 858 230 926 220 C970 214 980 244 1000 228"
      />
      <path
        className="idle-wave-line idle-wave-line-b"
        d="M0 286 C82 278 82 248 156 242 C230 236 226 262 292 214 C360 164 400 174 454 224 C522 286 574 246 632 270 C704 300 720 326 780 330 C850 334 858 244 926 232 C970 224 982 250 1000 236"
      />
      <path
        className="idle-wave-glow"
        d="M0 286 C78 286 78 238 156 238 C228 238 220 256 292 210 C358 168 398 158 454 218 C520 288 570 242 632 264 C710 292 714 334 780 338 C852 342 858 230 926 220 C970 214 980 244 1000 228"
      />
    </svg>
  );
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

  return <canvas ref={canvasRef} className="pointer-events-none h-[260px] w-full select-none rounded-lg border border-white/70 bg-white/40 md:h-[360px]" />;
}

function formatAiReport(text) {
  const clean = sanitizeAiText(text);
  if (!clean) return [{ title: "等待分析", body: "完成音频分析后，这里会展示 AI 的详细结论。" }];
  const paragraphs = clean
    .replace(/\r/g, "")
    .split(/\n{2,}|(?<=。)\s*(?=[一二三四五六七八九十]、)/)
    .map((item) => item.trim())
    .filter(Boolean);
  const titles = ["综合判断", "频谱与动态", "共鸣与纯净", "曲风适配", "综合评价"];
  return (paragraphs.length ? paragraphs : [clean]).map((body, index) => ({
    title: titles[index] || `分析要点 ${index + 1}`,
    body: sanitizeAiText(body).replace(/^#+\s*/, "").replace(/^\d+[.、]\s*/, ""),
  }));
}

function sanitizeAiText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .trim();
}

async function createCanvasReportImage(report) {
  if (document.fonts?.ready) {
    await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 350))]);
  }

  const width = 1200;
  const draftHeight = 2300;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = draftHeight;
  const ctx = canvas.getContext("2d");

  const palette = {
    paper: "#f6edda",
    panel: "rgba(255, 255, 255, 0.42)",
    panelStrong: "rgba(255, 255, 255, 0.58)",
    ink: "#25321f",
    body: "#526449",
    gold: "#a17a34",
    softGold: "#d2b36e",
    green: "#6f8c72",
    line: "rgba(255,255,255,0.72)",
  };

  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, width, draftHeight);
  const glow = ctx.createRadialGradient(180, 90, 20, 180, 90, 760);
  glow.addColorStop(0, "rgba(255,255,255,.62)");
  glow.addColorStop(0.48, "rgba(246,237,218,.3)");
  glow.addColorStop(1, "rgba(237,243,223,.5)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, draftHeight);

  let y = 76;
  drawText(ctx, "AI TIMBRE REPORT", 60, y, {
    font: serifFont(26, 500),
    fillStyle: palette.gold,
  });
  y += 76;
  drawText(ctx, "音色分析报告", 60, y, {
    font: serifFont(72, 700),
    fillStyle: palette.ink,
  });

  drawGauge(ctx, 1030, 145, 86, Number(report.score) || 0, palette);

  y += 96;
  y = drawTraits(ctx, report.traits || [], 60, y, 780, palette);
  y += 34;

  y = drawPanel(ctx, 60, y, 1080, 150, palette, () => {
    return drawWrappedText(ctx, report.summary || "等待音频分析。", 94, y + 48, 1010, {
      font: serifFont(30, 500),
      fillStyle: "#35402d",
      lineHeight: 48,
      maxLines: 2,
    });
  });
  y += 36;

  const scoreItems = [
    ["音区均衡", report.dimensionScores?.balance],
    ["音色纯净", report.dimensionScores?.purity],
    ["共鸣表现", report.dimensionScores?.resonance],
    ["音色控制", report.dimensionScores?.control],
  ];
  y = drawScoreGrid(ctx, scoreItems, 60, y, 1080, palette);
  y += 34;

  const metricItems = [
    ["古筝置信度", `${report.guzhengConfidence}/100`, "预检结果"],
    ["动态范围", report.dynamicValue, report.dynamicText],
    ["共鸣时间", report.resonanceValue, report.resonanceText],
    ["木材推测", report.woodValue, report.woodText],
    ["声音年龄", report.ageValue, report.ageText],
  ];
  y = drawMetricGrid(ctx, metricItems, 60, y, 1080, palette);
  y += 34;

  const leftHeight = estimateTextBoxHeight(report.weaknesses?.join("；") || "暂无明显短板。", 470, 28, 40, 128);
  const rightHeight = estimateTextBoxHeight(report.styleFit || "等待曲风适配。", 470, 28, 40, 168);
  const boxHeight = Math.max(210, leftHeight, rightHeight);
  drawInfoBox(ctx, "不足提示", report.weaknesses?.join("；") || "暂无明显短板。", 60, y, 520, boxHeight, palette);
  drawInfoBox(ctx, "曲风适配", report.styleFit || "等待曲风适配。", 620, y, 520, boxHeight, palette);
  y += boxHeight + 38;

  if (report.spectrumDetail) {
    const spectrumHeight = estimateTextBoxHeight(report.spectrumDetail, 980, 26, 42, 132);
    drawInfoBox(ctx, "频谱分析", report.spectrumDetail, 60, y, 1080, Math.max(180, spectrumHeight), palette);
    y += Math.max(180, spectrumHeight) + 36;
  }

  drawText(ctx, "评分依据：音区均衡、音色纯净、共鸣表现与音色控制；参考声档仅辅助定位声学轮廓。", 60, y, {
    font: serifFont(23, 400),
    fillStyle: "#6b775f",
  });
  y += 54;

  drawText(ctx, `生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`, 60, y, {
    font: serifFont(22, 400),
    fillStyle: "#8a977c",
  });
  y += 70;

  const finalHeight = Math.min(Math.max(y, 1420), draftHeight);
  const output = document.createElement("canvas");
  output.width = width;
  output.height = finalHeight;
  const outCtx = output.getContext("2d");
  outCtx.drawImage(canvas, 0, 0, width, finalHeight, 0, 0, width, finalHeight);
  return output.toDataURL("image/png");
}

function drawGauge(ctx, cx, cy, radius, score, palette) {
  const value = clampClient(score, 0, 100);
  ctx.save();
  ctx.lineWidth = 24;
  ctx.strokeStyle = "rgba(106,125,85,.16)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = palette.softGold;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (value / 100));
  ctx.stroke();
  ctx.fillStyle = palette.paper;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = "center";
  drawText(ctx, String(score || "--"), cx, cy - 4, {
    font: serifFont(46, 700),
    fillStyle: palette.ink,
    align: "center",
  });
  drawText(ctx, "/100", cx, cy + 44, {
    font: serifFont(20, 400),
    fillStyle: "#718064",
    align: "center",
  });
  ctx.restore();
}

function drawTraits(ctx, traits, x, y, maxWidth, palette) {
  let currentX = x;
  let currentY = y;
  const height = 54;
  traits.slice(0, 8).forEach((trait) => {
    const text = String(trait);
    ctx.font = serifFont(24, 500);
    const chipWidth = Math.max(126, ctx.measureText(text).width + 48);
    if (currentX + chipWidth > x + maxWidth) {
      currentX = x;
      currentY += height + 14;
    }
    roundedRect(ctx, currentX, currentY, chipWidth, height, 27);
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.fill();
    ctx.strokeStyle = "#cad6bc";
    ctx.lineWidth = 2;
    ctx.stroke();
    drawText(ctx, text, currentX + chipWidth / 2, currentY + 35, {
      font: serifFont(23, 500),
      fillStyle: palette.body,
      align: "center",
    });
    currentX += chipWidth + 16;
  });
  return currentY + height;
}

function drawPanel(ctx, x, y, width, height, palette, drawContent) {
  roundedRect(ctx, x, y, width, height, 14);
  ctx.fillStyle = palette.panel;
  ctx.fill();
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawContent?.();
  return y + height;
}

function drawScoreGrid(ctx, items, x, y, width, palette) {
  const gap = 20;
  const cardWidth = (width - gap * 3) / 4;
  const cardHeight = 132;
  items.forEach(([title, value], index) => {
    const cardX = x + index * (cardWidth + gap);
    drawPanel(ctx, cardX, y, cardWidth, cardHeight, palette);
    drawText(ctx, title, cardX + 26, y + 46, {
      font: serifFont(22, 500),
      fillStyle: "#66755b",
    });
    drawText(ctx, String(value ?? "--"), cardX + cardWidth - 26, y + 54, {
      font: serifFont(34, 700),
      fillStyle: palette.gold,
      align: "right",
    });
    const numeric = Number(value) || 0;
    const barX = cardX + 26;
    const barY = y + 92;
    const barWidth = cardWidth - 52;
    roundedRect(ctx, barX, barY, barWidth, 12, 6);
    ctx.fillStyle = "#dfe8d0";
    ctx.fill();
    roundedRect(ctx, barX, barY, barWidth * clampClient(numeric / 100, 0, 1), 12, 6);
    const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    gradient.addColorStop(0, "#7d9b85");
    gradient.addColorStop(1, palette.softGold);
    ctx.fillStyle = gradient;
    ctx.fill();
  });
  return y + cardHeight;
}

function drawMetricGrid(ctx, items, x, y, width, palette) {
  const gap = 18;
  const cardWidth = (width - gap * 4) / 5;
  const cardHeight = 166;
  items.forEach(([title, value, text], index) => {
    const cardX = x + index * (cardWidth + gap);
    drawPanel(ctx, cardX, y, cardWidth, cardHeight, palette);
    drawText(ctx, title, cardX + 22, y + 42, {
      font: serifFont(21, 500),
      fillStyle: "#66755b",
    });
    drawWrappedText(ctx, String(value ?? "--"), cardX + 22, y + 82, cardWidth - 44, {
      font: serifFont(28, 700),
      fillStyle: palette.gold,
      lineHeight: 32,
      maxLines: 2,
    });
    drawWrappedText(ctx, String(text || ""), cardX + 22, y + 132, cardWidth - 44, {
      font: serifFont(19, 400),
      fillStyle: palette.body,
      lineHeight: 24,
      maxLines: 2,
    });
  });
  return y + cardHeight;
}

function drawInfoBox(ctx, title, body, x, y, width, height, palette) {
  drawPanel(ctx, x, y, width, height, palette);
  drawText(ctx, title, x + 32, y + 56, {
    font: serifFont(29, 700),
    fillStyle: palette.ink,
  });
  drawWrappedText(ctx, body, x + 32, y + 106, width - 64, {
    font: serifFont(24, 400),
    fillStyle: palette.body,
    lineHeight: 39,
    maxLines: Math.max(2, Math.floor((height - 118) / 39)),
  });
}

function drawText(ctx, text, x, y, options = {}) {
  ctx.save();
  ctx.font = options.font || serifFont(24, 400);
  ctx.fillStyle = options.fillStyle || "#25321f";
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "alphabetic";
  ctx.fillText(String(text), x, y);
  ctx.restore();
}

function drawWrappedText(ctx, text, x, y, maxWidth, options = {}) {
  ctx.save();
  ctx.font = options.font || serifFont(24, 400);
  ctx.fillStyle = options.fillStyle || "#25321f";
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = "alphabetic";
  const lineHeight = options.lineHeight || 36;
  const lines = wrapCanvasText(ctx, String(text || ""), maxWidth, options.maxLines || 10);
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
  ctx.restore();
  return y + lines.length * lineHeight;
}

function wrapCanvasText(ctx, text, maxWidth, maxLines) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const tokens = Array.from(normalized);
  const lines = [];
  let line = "";
  for (const token of tokens) {
    const next = line + token;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = token;
      if (lines.length >= maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && tokens.join("").length > lines.join("").length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  }
  return lines;
}

function estimateTextBoxHeight(text, width, fontSize, lineHeight, base) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = serifFont(fontSize, 400);
  const lines = wrapCanvasText(ctx, text, width, 8);
  return base + lines.length * lineHeight;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function serifFont(size, weight = 400) {
  return `${weight} ${size}px "Noto Serif SC", "Songti SC", "Microsoft YaHei", serif`;
}

function isMobileExportEnvironment() {
  if (typeof navigator === "undefined") return false;
  return /MicroMessenger|miniProgram|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

function supportsDirectDownload() {
  if (typeof document === "undefined") return false;
  if (isMobileExportEnvironment()) return false;
  const link = document.createElement("a");
  return "download" in link;
}

function isVideoLikeFile(file) {
  const type = file?.type || "";
  const name = file?.name || "";
  return type.startsWith("video/") || /\.(mp4|mov|m4v|avi|webm|mkv|3gp)$/i.test(name);
}

function isServerAudioFallbackCandidate(file) {
  const type = file?.type || "";
  const name = file?.name || "";
  return (
    !isVideoLikeFile(file) &&
    (type.startsWith("audio/") || /\.(flac|wav|mp3|m4a|aac|ogg|opus)$/i.test(name))
  );
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
