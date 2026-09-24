import { access, constants } from "node:fs/promises";
import { delimiter, extname, join } from "node:path";
/** Resolve an executable on PATH. On Windows, tries each PATHEXT suffix when the name has none. */
export const which = async (cmd) => {
    const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
    const exts = process.platform === "win32" && !extname(cmd) ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
    for (const dir of dirs) {
        for (const ext of [...exts, ""]) {
            const file = join(dir, cmd + ext);
            try {
                await access(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
                return file;
            }
            catch {
                /* try next */
            }
        }
    }
    return undefined;
};
//# sourceMappingURL=which.js.map