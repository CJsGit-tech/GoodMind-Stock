# Global Engineering Principles

## Local staging workflow — owner decision, 15 October 2026

- The owner explicitly replaced AppDeploy staging iteration with a local copy to reduce platform usage. Maintain frontend and backend source in `pocket-stock-staging/`; this is the default staging environment. This decision supersedes the older AppDeploy-only frontend, local-build prohibition and deployed-AppDeploy-only staging review requirements below for local staging work.
- Run local development and review through `pocket-stock-staging/` using its README. Keep SQLite data, uploaded files and local credentials in ignored `.local/` and `.env` paths. Never copy production credentials into local staging. Local test-reader identities are simulations; they do not verify Google/email OAuth.
- Verify local staging at 1366 × 768 and 1440 × 900 through the actual localhost UI, attach JPG evidence to the relevant Linear issue, and record that the environment was local. Do not claim AppDeploy runtime, quota, OAuth or cloud isolation parity from a local test.
- Retain the existing AppDeploy staging and production apps. AppDeploy deployment is a separate action requiring task authorization; source export and local development do not authorize a cloud deployment. When cloud deployment is requested, retrieve current AppDeploy instructions and apply the AppDeploy review requirements below.
- Linear remains the system of record. Application source, tests, lockfile, runtime assets, reproducible-source provenance and run instructions may remain in the local staging folder; project plans and QA evidence belong in Linear. Done still requires owner permission.

- Read this file before inspecting, planning, or changing code. Inspect the relevant implementation, architecture, styles, design tokens, utilities, and dependencies before proposing a change. Ask when a material product or implementation choice remains ambiguous.
- Reuse and extend existing components and patterns where practical. Preserve intentional visual variants and the product's established layout, typography, color, and interaction language. Favor clear hierarchy and spacing over unnecessary borders, nested cards, and decoration.
- Before adding a complex capability or dependency, check existing code and installed packages. If a new package is needed, choose a maintained, documented, production-ready option with a suitable commercial license.
- Keep code simple and readable: focused functions and modules, descriptive names, explicit control flow, and the smallest change that solves the task. Split distinct responsibilities without creating needless abstractions. Verify that the change works and does not duplicate existing functionality.

# External Document Formatting

When creating or updating documents in rich-text services such as Linear, produce human-readable rendered content rather than raw Markdown syntax. Use the service's native formatting controls or a supported rich-text/HTML paste path, then verify that headings, paragraphs, lists, and inline code are visually rendered before reporting completion.

# Authenticated UI Testing

- When an authorized test requires authentication, agents may read credentials from the repository's `.env` file and sign in through the actual deployed PocketStocks UI in AppDeploy. No separate permission is needed solely to use the credential for that test. Coding agents may run UI checks and capture evidence within their assigned scope; their evidence does not replace the TPM's independent review below.
- Keep credential values out of chat, commands and logs, screenshots, Linear, source changes, and test reports. Do not toggle password visibility or inspect the secret to prove it was entered. A browser tool may display a masked value such as `<redacted>`; submit the form normally and verify the resulting UI and session before concluding that login failed.
- This authorization does not permit credential changes, deleting production data, or bypassing a tool restriction. Use an explicitly disposable record for destructive live tests and obtain any confirmation required at the irreversible action.

# Linear Is the System of Record

Linear is the authoritative system of record for all PocketStocks project management, product, design, research, review, approval, and delivery work.

## Linear Access Order

- Use Codex in-app Linear access first for all Linear reads, searches, creation, updates, uploads, and verification.
- Use the macOS Linear app through UI automation only when in-app Linear access is unavailable, blocked, or does not support the required operation.
- When falling back to the macOS app, state the concrete reason and continue to treat Linear as the sole system of record.

- Create and maintain requirements, user stories, issues, acceptance criteria, specifications, UX contracts, design references, research, resource lists, decisions, approvals, status, release notes, QA evidence, and delivery audits in Linear.
- Before creating an issue or document, search Linear for the canonical existing record and update it when appropriate. Avoid duplicate or competing records.
- Every deliverable must be linked to the applicable PocketStocks project, document, and issue in Linear. A deliverable that exists only on the local filesystem is incomplete.
- Upload requested documents and QA evidence directly to Linear, render supported content inline, and verify the resulting document, attachment, link, and issue relationship before reporting completion.
- Treat local non-code artifacts as temporary working or upload-staging files. After successful Linear upload and verification, remove temporary, duplicate, superseded, and delivered local copies using exact verified paths.
- Keep backend source, tests, configuration, and required runtime assets in the repository when the application needs them. Do not recreate or retain PocketStocks frontend source, local prototypes, or build output here; author and maintain frontend code through AppDeploy. Track requirements, decisions, implementation status, and review evidence in Linear.
- Keep repository engineering instructions such as `AGENTS.md` and installed skill files at their required filesystem paths. Record material workflow decisions on the applicable Linear issue; a duplicate file upload is not required for these runtime instructions.
- A local non-code artifact may remain only when it is required by the application, required for reproducible generation, or explicitly approved as an exception. Record that exception and its purpose in Linear.
- Do not report work complete until Linear has been rechecked as the authoritative record and scoped local cleanup has succeeded.

# Dedicated Task Chats

- Every delegated PocketStocks task—coding, design, research, QA, review, or implementation—must have its own dedicated Codex project chat session so the user can inspect its scope, progress, reports, and outcome.
- Bind each dedicated task chat to the exact Linear issue or document it serves. The task prompt must state its ownership boundary, required evidence, and report-back format.
- Prefer an isolated worktree for a task chat when the repository has a usable committed Git starting point. If that is not possible, use the saved project locally only with explicitly non-overlapping file ownership.
- A dedicated task chat does not replace the main agent's Linear ownership, independent verification, or required UI implementation review gate.

# Frontend Source and AppDeploy Delivery

- Do not recreate, edit, or retain PocketStocks frontend source code, local prototypes, build output, or frontend source assets in this repository or a worktree. The user removed the local frontend source. Frontend implementation code is authored and maintained through the AppDeploy MCP workflow only.
- Before generating or submitting AppDeploy code, call AppDeploy `get_deploy_instructions` and follow its current constraints. Use the existing PocketStocks AppDeploy app and its update/deploy workflow; do not create a replacement app unless the user asks.
- Do not write frontend code to local files as a staging step. Keep deployment payloads within the AppDeploy workflow. Do not require local `npm run build`, a local `dist/` folder, or a local frontend fixture harness.
- After deployment, inspect the real AppDeploy UI at the required viewports and exercise the changed routes and states. Capture and retain only QA evidence needed by the applicable Linear issue; never capture credentials or secrets.
- For QA screenshots, use the in-app browser or Chrome UI/browser controls to capture the rendered AppDeploy page. A failed or unavailable desktop screenshot method does not end screenshot capture: try the browser's supported screenshot/capture controls and save the required JPG for Linear. Follow the browser tool's documented export restrictions; do not bypass them. If all supported browser capture paths fail, record the specific failure and keep the issue active until JPG evidence can be attached.
- Keep applicable design references linked from their Linear issues. Do not create local design source files, visual indexes, or design PDFs unless the user separately requests those deliverables.

## AppDeploy Build and Deployment

- Use the AppDeploy MCP tools to update and deploy the existing app. Do not implement a design directly in local frontend files.
- Call `get_deploy_instructions` before generating any deployment code. After deployment starts, poll AppDeploy status until it reaches a terminal state, inspect QA and runtime results, fix and redeploy when feasible, then verify the deployed UI through browser controls.
- Never mark an issue `Done` without explicit user permission. Record the AppDeploy environment, route, viewport, actions, observed result, checks, and any untested irreversible action in Linear.

# UI Implementation Review Gate

Apply this gate to every implementation issue that changes or verifies user-visible UI. It is a required TPM/main-agent review loop using the deployed AppDeploy UI; local frontend code and fixture runs are not part of this project workflow.

- Review common desktop web browser sizes by default: 1366 × 768 and 1440 × 900. Add another desktop size only when the current task explicitly requires it.
- Do not run mobile-width, mobile-layout, or simulated mobile checks during routine UI review. Check mobile only when the user explicitly requests mobile coverage for that task.
- Record the actual desktop viewports checked in Linear, and do not claim mobile coverage when it was not checked.
- Resolve the canonical Linear issue, user story, applicable design references or existing product patterns, relevant AppDeploy routes and states, and target viewports before review.
- Personally operate the deployed PocketStocks AppDeploy UI. Inspect each required viewport and the normal path plus affected loading, empty, error, interaction, changed, and reset states. Compare the rendered result with applicable design references, requirements, and existing product patterns; distinguish verified data differences from visual defects.
- Return material discrepancies for correction through the AppDeploy workflow. Recheck the deployed UI after each correction; keep the issue active or use the team's blocked convention until review passes.
- Owner clarification (7 October 2026): move delivered work to `In Review` when automated/source checks and independent deployed browser checks cover most requirements and the remaining checks need human action or more complex test setup. Record the verified evidence, exact outstanding checks, and reviewer actions in Linear; leave unverified acceptance items unchecked. `In Review` does not certify that every test passed. Known material defects, incomplete core implementation, or missing basic deployment/browser evidence remain active.
- Record the AppDeploy environment, route, viewport, actions, observed result, applicable design reference, evidence, checks, and conclusion in Linear before moving the issue to `In Review`. Do not infer visual alignment from code, deployment status, or a screenshot supplied by someone else.
- Capture the TPM's implementation-review screenshots from the in-app browser or Chrome UI/browser controls. If one capture route fails, use another supported browser capture route before treating screenshot evidence as blocked; create the collaboration-ready JPG and attach it to the applicable Linear issue.
- If the deployed route, credentials, target viewport, or core review state is unavailable, leave the issue active and record the concrete blocker in Linear. An unavailable advanced state alone does not prevent `In Review` under the owner's clarification above; record it as an outstanding review check.
- `Done` always requires explicit user permission.

## UI Visual Image Format

- For AppDeploy UI QA evidence uploaded to Linear, create and use a JPG asset as the collaboration-ready format. Upload only JPG QA evidence; never upload a PNG.
- Do not create project visual indexes or design PDFs unless the user separately requests them. Temporary screenshot source files must be removed after the JPG QA evidence is verified in Linear.
