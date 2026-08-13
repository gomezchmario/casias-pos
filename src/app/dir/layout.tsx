import "./dir.css";

/**
 * The directory sits outside the POS shell on purpose.
 *
 * No nav, no register header, no language toggle — one of the two screens below
 * is read by somebody who does not work here, and every control this layout
 * does not draw is a control they cannot press by mistake.
 */
export const metadata = {
  title: { default: "Directory", template: "%s · Casias Tire Shop" },
  // A company's page is not for search engines, and neither is the index.
  robots: { index: false, follow: false },
};

export default function DirLayout({ children }: { children: React.ReactNode }) {
  return children;
}
