import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <header className="page-header">
        <p className="eyebrow">StudyBench</p>
        <h1>Page not found</h1>
        <p className="lede">
          That page does not exist. The study track may have been renamed, or
          the address may be mistyped.
        </p>
      </header>
      <p>
        <Link href="/">Back to study tracks</Link>
      </p>
    </main>
  );
}
