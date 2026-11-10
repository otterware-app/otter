import { platform } from "@otter/core/extension-kit";

const SECRET = "varys-token";

export const getVarysToken = async (): Promise<string> =>
  (await platform()
    .secrets.get(SECRET)
    .catch(() => null)) ?? "";
export const setVarysToken = (token: string) => platform().secrets.set(SECRET, token);
export const clearVarysToken = () => platform().secrets.delete(SECRET);
