import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type AdminSession = {
  adminId?: number;
  username?: string;
  mustChangePassword?: boolean;
};

const sessionPassword = process.env.SESSION_SECRET;

if (!sessionPassword || sessionPassword.length < 32) {
  // Don't crash the build — surface a clear runtime error when actually used.
  console.warn(
    "[session] SESSION_SECRET is missing or shorter than 32 chars. Run `npm run setup` to generate one.",
  );
}

export const sessionOptions: SessionOptions = {
  password:
    sessionPassword && sessionPassword.length >= 32
      ? sessionPassword
      : "DEV_INSECURE_FALLBACK_SECRET_PLEASE_RUN_SETUP_TO_GENERATE_ONE_32CH",
  cookieName: "casias_admin",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 12, // 12 hours
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<AdminSession>(cookieStore, sessionOptions);
}

export async function requireAdmin(): Promise<AdminSession> {
  const session = await getSession();
  if (!session.adminId) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}
