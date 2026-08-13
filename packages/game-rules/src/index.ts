/**
 * Rule engine package.
 *
 * The condition/rule engine (Phase 11): the shared `Rule` AST, the pure
 * evaluation core, and four typed entry points (generation eligibility,
 * discovery, availability, runtime/gameplay). Public API is unchanged —
 * `Rule`, `RULE_OPERATORS`, and the generator modules are all re-exported
 * here.
 */
export * from './rules/index.js';

export * from './generation/index.js';
