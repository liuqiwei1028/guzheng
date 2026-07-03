import { NextResponse } from "next/server";
import { getBearerToken, toMiniProgramUser, verifyMiniProgramToken } from "@/lib/miniprogramAuth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const token = getBearerToken(request);
    const session = verifyMiniProgramToken(token);
    return NextResponse.json({ user: toMiniProgramUser(session) });
  } catch {
    return NextResponse.json({ error: "登录已失效，请重新登录" }, { status: 401 });
  }
}
