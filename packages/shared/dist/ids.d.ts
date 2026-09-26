export type IdPrefix = "w" | "m" | "t" | "r" | "u" | "lim";
/** Isomorphic id generator: `<prefix>_<8 hex>` using Web Crypto (Node 22 and browsers). */
export declare function newId(prefix: IdPrefix): string;
