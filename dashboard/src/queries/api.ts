import ky from "ky";

import { pageKey } from "src/queries/key";

export const api = ky.create({ prefix: "/api/", retry: 0, timeout: 30_000, headers: { "x-prg-key": pageKey } });
