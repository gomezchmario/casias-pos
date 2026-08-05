import { AdminShell } from "@/components/admin/AdminShell";

/** The dashboard at /admin, and a fallback for any admin screen without one.
 *  The template is restated for the reason given in the POS shell layout. */
export const metadata = {
  title: { default: "Dashboard · Admin", template: "%s · Casias Tire Shop" },
};

export default function AuthedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
