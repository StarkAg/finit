/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as budget from "../budget.js";
import type * as ledger from "../ledger.js";
import type * as names from "../names.js";
import type * as quotes from "../quotes.js";
import type * as seed from "../seed.js";
import type * as swing from "../swing.js";
import type * as yearly from "../yearly.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  budget: typeof budget;
  ledger: typeof ledger;
  names: typeof names;
  quotes: typeof quotes;
  seed: typeof seed;
  swing: typeof swing;
  yearly: typeof yearly;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
