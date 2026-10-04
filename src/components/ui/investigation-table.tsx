import type { Investigation } from "@/lib/engine/types";

/** Author-supplied test results. Shows only what the author entered; nothing is calculated or filled in. */
export function InvestigationTable({ investigations }: { investigations: readonly Investigation[] }) {
  if (investigations.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="sr-only">Investigation results</caption>
        <thead className="bg-canvas text-xs tracking-wider text-ink-subtle uppercase">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Test</th>
            <th scope="col" className="px-3 py-2 font-semibold">Result</th>
            <th scope="col" className="px-3 py-2 font-semibold">Reference range</th>
            <th scope="col" className="px-3 py-2 font-semibold">Interpretation</th>
          </tr>
        </thead>
        <tbody>
          {investigations.map((inv, i) => (
            <tr key={`${inv.name}-${i}`} className="border-t border-line align-top">
              <th scope="row" className="px-3 py-2 font-semibold">{inv.name}</th>
              <td className="px-3 py-2 tabular-nums">
                {inv.value}
                {inv.unit ? ` ${inv.unit}` : ""}
              </td>
              <td className="px-3 py-2 text-ink-muted">{inv.referenceRange ?? "—"}</td>
              <td className="px-3 py-2 text-ink-muted">{inv.interpretation ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
