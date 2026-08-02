import fs from "node:fs";
import path from "node:path";
import { nowLocalIso } from "./time";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export function saveBase64Photo(
  employeeId: number,
  dataUrl: string,
): string | null {
  // Expect "data:image/jpeg;base64,..." or similar.
  const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === "jpg" ? "jpg" : match[1];
  const b64 = match[2];
  const buf = Buffer.from(b64, "base64");

  // Cap photo size at 2 MB — kiosk shouldn't be sending more.
  if (buf.byteLength > 2 * 1024 * 1024) return null;

  ensureUploadDir();
  const stamp = nowLocalIso().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHMMSS
  // Add a small random suffix to prevent same-second collisions.
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  const filename = `${employeeId}_${stamp}_${rand}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  return filename;
}

export function readPhoto(filename: string): Buffer | null {
  // Defend against path traversal.
  if (!/^[A-Za-z0-9_.-]+$/.test(filename)) return null;
  const full = path.join(UPLOAD_DIR, filename);
  if (!full.startsWith(UPLOAD_DIR)) return null;
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full);
}

export function deletePhoto(filename: string): boolean {
  if (!/^[A-Za-z0-9_.-]+$/.test(filename)) return false;
  const full = path.join(UPLOAD_DIR, filename);
  if (!full.startsWith(UPLOAD_DIR)) return false;
  if (!fs.existsSync(full)) return false;
  fs.unlinkSync(full);
  return true;
}

export function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export const PHOTO_DIRECTORY = UPLOAD_DIR;
