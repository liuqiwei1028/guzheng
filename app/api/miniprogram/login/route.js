import { NextResponse } from "next/server";
import { createMiniProgramToken, toMiniProgramUser } from "@/lib/miniprogramAuth";
import { code2Session } from "@/lib/wechatApi";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { code } = await request.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "缺少微信登录 code" }, { status: 400 });
    }

    const session = await code2Session(code);
    const { token, expiresIn, expiresAt } = createMiniProgramToken({
      loginType: "wechat",
      openid: session.openid,
      unionid: session.unionid || "",
    });

    return NextResponse.json({
      token,
      expiresIn,
      user: toMiniProgramUser({ loginType: "wechat", exp: expiresAt }),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "微信登录失败" }, { status: 500 });
  }
}
