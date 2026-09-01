import { NextResponse } from "next/server";
import { login, publicProfile } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const profile = await login({
      method: body.method,
      email: body.email,
      address: body.address,
    });
    return NextResponse.json({ profile: publicProfile(profile) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error de login." },
      { status: 422 },
    );
  }
}
