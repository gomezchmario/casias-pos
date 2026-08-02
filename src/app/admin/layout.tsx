// Pass-through layout for /admin/*. The AdminShell (with sidebar + auth gate)
// is applied only inside /admin/(authed)/ via that group's own layout.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
