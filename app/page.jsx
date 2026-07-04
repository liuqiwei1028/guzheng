import GuzhengExperience from "@/components/GuzhengExperience";

export default function Page({ searchParams }) {
  const isMiniProgramShell = searchParams?.mp === "1" || searchParams?.client === "miniprogram";
  return <GuzhengExperience isMiniProgramShell={isMiniProgramShell} />;
}
