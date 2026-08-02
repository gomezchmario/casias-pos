"use client";

export function PrintButton() {
  return (
    <div className="no-print flex gap-2">
      <button type="button" className="btn btn-primary" onClick={() => window.print()}>
        Print
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => window.close()}>
        Close
      </button>
    </div>
  );
}
