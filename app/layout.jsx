import "./globals.css";

export const metadata = {
  title: "天籁之音 | 古筝 AI 音色鉴赏",
  description: "上传古筝音频，生成频谱、共鸣、动态与综合音色分析报告。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
