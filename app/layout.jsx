import "./globals.css";

export const metadata = {
  title: "筝音慧鉴",
  description: "筝音慧鉴：上传古筝音频，生成频谱、共鸣、动态与综合音色分析报告。",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
