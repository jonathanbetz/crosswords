---
description: Review a PR against project standards and post approved comments to GitHub
---

You are orchestrating the caliper review pipeline for PR #$ARGUMENTS.

## Step 1 — Triage

Run the triage phase:

```
npx caliper $ARGUMENTS
```

This gathers PR metadata, classifies files by risk, runs metadata checks, and saves state. Show the full output to the user.

Then ask the user: **"Does this triage look right? Any files you want me to move between tiers?"**

Use AskUserQuestion with options:

- "Looks good, continue" — proceed to Step 2
- "Adjust triage" — let the user explain what to change (not yet supported, just acknowledge and continue)

If the user says it looks good, proceed. If they want to cancel, stop.

## Step 2 — Run review

Resume the review pipeline (context building, approach review, code review, summary):

```
npx caliper $ARGUMENTS --resume
```

This will take a few minutes. The script:

1. Builds architectural context
2. Runs convention checks
3. Runs AI approach review
4. Runs AI code review
5. Prints a summary

No comments are posted to GitHub during this step — all findings are accumulated with "pending" status. Show the full output to the user when complete, then proceed to Step 3.

## Step 3 — Review & post findings

Present findings one at a time for user approval before posting to GitHub.

Loop through each pending finding sequentially:

1. Read the state file at `/tmp/caliper/$ARGUMENTS/state.json`
2. Look at `codeReviewFindings` and `findingActions`. Find the next finding whose corresponding `findingActions` entry has status `"pending"`.
3. If no pending findings remain, skip to the final tally below.
4. Display the finding to the user clearly:
   - **Severity**: (the finding's `severity`)
   - **Category**: (the finding's `category`)
   - **Location**: `file:line` (or "General" if `file` is empty)
   - **Title**: (the finding's `title`)
   - **Body**: (the finding's `body`)
   - **Suggested fix**: (the finding's `suggested_fix.new_code` if present, otherwise omit)
5. **Important**: Add 3-4 blank lines of padding after the finding text and before calling AskUserQuestion, because the question widget covers the last ~2 lines of text output.
6. Ask the user using AskUserQuestion with header "Finding" and options:
   - "Post to PR" — post this comment to the GitHub PR
   - "Skip" — do not post this finding
7. If the user chooses **"Post to PR"**, run:
   ```
   npx caliper-post $ARGUMENTS <index>
   ```
   where `<index>` is the finding's index in `codeReviewFindings`. Show the result.
8. Go back to step 2 for the next pending finding.

**Final tally**: When all findings have been reviewed, show a summary:
- N finding(s) posted to PR
- M finding(s) skipped
