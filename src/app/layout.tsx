import type { Metadata, Viewport } from "next";
import { readTextSizeCookie } from "@/modules/appearance/infrastructure/text-size-cookie";
import { AppHeader } from "@/shared/ui/app-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudyBench",
  description:
    "Personal study workbench for technical certifications and language examinations.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * The document every page renders inside.
 *
 * **The root font size is set here, on the server**, because that is the only place it can
 * be set without the owner seeing the wrong size first. It has to be in the first byte of
 * HTML — a script that read the preference and applied it after hydration would paint the
 * default size and then jump, on every navigation.
 *
 * **An inline style rather than a data attribute.** The earlier version of this setting had
 * three named presets, so three CSS rules could cover every possible value. A size is now
 * any whole number from 12 to 24, and thirteen rules to express "use this number" would be
 * a lookup table standing in for the number itself. The value written here is a whole number
 * produced by `toTextSize`, which cannot return anything else, so there is no string from the
 * request in this attribute and nothing to escape — the guard is what makes the inline style
 * safe, and it is the reason the guard rejects rather than passes through.
 *
 * `-webkit-text-size-adjust: 100%` in the stylesheet keeps iOS from adding its own scaling
 * on top of this one.
 *
 * Reading a cookie here makes the tree below dynamic, which every page in it already is:
 * each declares `force-dynamic` because it reads the owner's database per request.
 *
 * The header renders here rather than per page, so every route — including ones not written
 * yet — has the same way out. Pages render their own breadcrumb trail inside `main`.
 */
export default async function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const textSize = await readTextSizeCookie();

  return (
    <html lang="en" style={{ fontSize: `${textSize}px` }}>
      <body>
        <AppHeader textSize={textSize} />
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
