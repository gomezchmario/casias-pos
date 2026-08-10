import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  typedRoutes: false,

  /**
   * The page shell is never cached. The files it points at still are.
   *
   * This exists because of one failure that kept coming back and always looked
   * like something else. A tab left open across a deploy keeps the HTML it was
   * served, and that HTML names its stylesheet by content hash. Rebuild, and
   * the hash moves; the stale shell then asks for a file that no longer exists,
   * gets nothing, and renders with the JavaScript of the new version and the
   * styling of none.
   *
   * On screen that is survivable — things look plain. On the close-out it is
   * not: the print rules are what create the page breaks and hold the signature
   * block together, so their absence prints a sheet with no page one, the
   * signature lines stacked on top of each other and the report headings landed
   * in the middle of the page. It reads as a layout bug in the close-out, and
   * three separate times it was diagnosed as one.
   *
   * The register is one PC on one desk and its pages are a few kilobytes, so
   * re-fetching the shell every time costs nothing measurable. `/_next/static`
   * keeps its immutable caching — those filenames already contain a hash, which
   * is what makes them safe to keep and what made the shell unsafe to.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
