import { AdminShell } from "@/components/admin/AdminShell";

export default function AuthedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
