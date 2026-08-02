import { PosShell } from "@/components/pos/PosShell";

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <PosShell>{children}</PosShell>;
}
