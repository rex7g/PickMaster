import { NextResponse } from "next/server";
import {
  createApiKey,
  deposit,
  getSessionUserId,
  publicProfile,
  revokeApiKey,
  updateProfile,
  getProfile,
} from "@/lib/auth";

/** PATCH: actualizar perfil/settings. Acciones especiales via `action`. */
export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  try {
    const body = await request.json();
    if (body.action === "create-api-key") {
      const key = createApiKey(userId, body.label ?? "default");
      return NextResponse.json({ apiKey: key, profile: publicProfile(getProfile(userId)!) });
    }
    if (body.action === "revoke-api-key") {
      revokeApiKey(userId, body.keyId);
      return NextResponse.json({ profile: publicProfile(getProfile(userId)!) });
    }
    if (body.action === "deposit") {
      const balanceCents = deposit(userId, body.amountCents);
      return NextResponse.json({ balanceCents });
    }
    const profile = updateProfile(userId, body);
    return NextResponse.json({ profile: publicProfile(profile) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error actualizando el perfil." },
      { status: 422 },
    );
  }
}
