import type { FormSpec } from "./features-v1";

export const CANDIDATE_FORMS: FormSpec[] = [
  // Baseline — matches the current production formula structure.
  {
    name: "current",
    intercept: true,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },

  // Margin cap variants
  {
    name: "gdCap2",
    intercept: true,
    margin: { kind: "cappedGd", cap: 2 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },
  {
    name: "gdCap4",
    intercept: true,
    margin: { kind: "cappedGd", cap: 4 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },

  // Pythagorean margin
  {
    name: "pyth1",
    intercept: true,
    margin: { kind: "pythagorean", exponent: 1 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },
  {
    name: "pyth2",
    intercept: true,
    margin: { kind: "pythagorean", exponent: 2 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },
  {
    name: "pyth2.5",
    intercept: true,
    margin: { kind: "pythagorean", exponent: 2.5 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },
  {
    name: "pyth3",
    intercept: true,
    margin: { kind: "pythagorean", exponent: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },

  // Log margin
  {
    name: "logMargin",
    intercept: true,
    margin: { kind: "log" },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: [],
  },

  // Best margin so far + interactions (decided after first sweep, listed up front for stable search)
  {
    name: "current+strengthXwml",
    intercept: true,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: ["strengthTimesWinLoss"],
  },
  {
    name: "current+strengthXmargin",
    intercept: true,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: false,
    interactions: ["strengthTimesMargin"],
  },

  // Class-specific intercepts (spec predicts no help; verify)
  {
    name: "current+classIntercepts",
    intercept: false,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: false,
    classIntercepts: true,
    interactions: [],
  },

  // Ties-separate
  {
    name: "current+tiesSeparate",
    intercept: true,
    margin: { kind: "cappedGd", cap: 3 },
    strength: true,
    tiesSeparate: true,
    classIntercepts: false,
    interactions: [],
  },
];
