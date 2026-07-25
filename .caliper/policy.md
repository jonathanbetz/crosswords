# Review Policy

## Philosophy

Engineering quality takes priority over convention compliance. Only flag REAL issues visible in the code — do not invent problems. If the PR is clean, say so clearly. A clean review is a good review.

Respect existing codebase patterns. If the PR follows patterns used elsewhere, do not flag it. Do not review files outside the PR diff.

## Severity Definitions

### Blocking
Will cause bugs, security issues, or data loss. Must fix before merge.

### Suggestion
Meaningful engineering improvement. Should fix, non-blocking.

### Nit
Minor improvement. Nice to have.

## Priority Order (within each severity)
security > logic > error-handling > design > performance > boy-scout > testability > convention

## Engineering Review Criteria

### 1. Logic Correctness
- Off-by-one errors, incorrect boundary conditions
- Race conditions in async code (missing await, concurrent state mutation)
- Null/undefined not checked before use
- Edge cases: empty arrays, zero values, empty strings
- Type narrowing errors

### 2. Design Quality
- Single Responsibility: does each function do one thing well?
- Right abstraction level? Too abstract or too concrete?
- Do names accurately describe behavior?
- Tight coupling to implementation details?
- Meaningful code duplication that should be extracted?

### 3. Boy Scout Rule
When a function is MODIFIED in this PR, evaluate whether it should be cleaned up:
- Dead code paths or unreachable branches
- Stale comments or TODOs that are now addressable
- Unnecessary complexity that could be simplified
- Poor variable/function names that obscure intent
- Deprecated patterns the codebase has moved away from

Only applies to code the author is actively changing. Boy Scout findings are always "suggestion" severity unless they fix a bug.

### 4. Error Handling Quality
- Recovery logic correct?
- Error messages actionable?
- Errors properly propagated, not silently swallowed?

### 5. Performance
- N+1 queries (database calls inside loops)
- Missing pagination for large datasets
- Unbounded operations

### 6. Security
- Auth guards present on API routes
- Tenant isolation in database queries
- No credential values in error messages or logs
- Input validation before use
- No injection vulnerabilities

### 7. Testability
- Were tests added or updated for behavior changes?
- Is the code structured to be testable?
- Are there implicit dependencies that make testing hard?

## Design Review Criteria

These are evaluated at the PR level, not per-file.

### 1. Approach Assessment
- Does the PR's stated goal match what the code actually does?
- Is this a reasonable approach? Is there a materially simpler design?
- Is the scope right — too much (should split) or too little (incomplete)?

### 2. Responsibility Allocation
- Are changes in the right files and modules?
- Should any logic be split out or consolidated?
- Are new files justified?

### 3. Module Boundaries
- Does the PR respect existing architectural layers?
- Does it introduce cross-layer imports or hidden coupling?
- Are new dependencies between modules justified?

### 4. API Contract Quality (when API routes change)
- Response shape consistent with existing endpoints?
- Error responses structured and consistent?
- Are breaking changes flagged?

### 5. Data Model Quality (when schema/migrations change)
- Is the schema normalized appropriately?
- Are indexes present for expected query patterns?
- Is the migration safe?

### 6. Extensibility vs. Over-engineering
- Does the design accommodate likely near-term changes without being speculative?
- Is it over-engineered for what it needs to do today?

## Risk Classification

### High Risk (deep engineering review)
- Auth/security files
- Schema or migration files
- API route handlers
- New files over 50 lines
- Files that change function signatures or interfaces used by other modules

### Medium Risk (targeted review)
- Library code
- Components with business logic
- Config files

### Low Risk (convention scan only)
- Pure UI/styling changes
- Test files, documentation, markdown
- Lock files, generated files
- Files with fewer than 5 lines changed

## Ground Rules

- Be specific — exact file paths and line numbers.
- Provide actionable feedback — what's wrong AND what the fix should be.
- Keep comments concise, direct, and helpful — not pedantic.
- Only flag issues with evidence. Do not speculate.
- Explain WHY something is a problem.
