import { useQueries } from "@tanstack/react-query";

import { api } from "src/queries/api";

export type FileLines = { from: number; to: number; lines: string[] };

// Lines are fetched in fixed chunks, so revealing a few more never fetches again what is already here.
const CHUNK = 500;

// The new side's lines in each [from, to] range, 1-based and inclusive, for a file whose text the server holds.
export function useFileLines(layer: number, file: string, ranges: [number, number][]) {
  const chunks = [...new Set(ranges.flatMap(([from, to]) => chunkRange(from, to)))].sort((a, b) => a - b);
  const results = useQueries({
    queries: chunks.map(k => {
      const from = k * CHUNK + 1;
      const to = from + CHUNK - 1;
      return {
        queryKey: ["lines", layer, file, from, to],
        queryFn: () => api.get(`layers/${layer}/files/${file}/lines`, { searchParams: { from, to } }).json<FileLines>(),
        staleTime: Number.POSITIVE_INFINITY,
      };
    }),
  });
  const line = (n: number) => {
    const data = results[chunks.indexOf(Math.floor((n - 1) / CHUNK))]?.data;
    return data ? data.lines[n - data.from] : undefined;
  };
  return { line, pending: results.some(result => result.isPending), failed: results.some(result => result.isError) };
}

function chunkRange(from: number, to: number) {
  const out: number[] = [];
  for (let k = Math.floor((from - 1) / CHUNK); to >= from && k <= Math.floor((to - 1) / CHUNK); k++) {
    out.push(k);
  }
  return out;
}
