How to run the deployed-smoke CI workflow and collect artifacts

1. Prerequisites
   - Ensure the repo has these secrets set in GitHub: `WEBHOOK_BASE`, `WEBHOOK_API_KEY` (for the deployed service).
   - If you want verbose diagnostics, set `DEBUG_TESTS=true` in the workflow dispatch inputs or in the target environment (staging only).

2. Dispatch the workflow
   - Open the repository on GitHub, go to Actions → deployed-smoke, click "Run workflow".
   - Provide `WEBHOOK_BASE` (the public URL of the deployed webhook) and any other required inputs.
   - Set the `DEBUG_TESTS` input to `true` to collect additional debug artifacts.

3. Collect artifacts after the run completes
   - On the workflow run page, expand the job(s), and locate the step that uploads artifacts.
   - Download the produced artifact bundle(s) (they should include async*handles*\*.json, async_handle_map.json, and any test logs).
   - Save them under `artifacts-ci-runs/<run-id>/` for later analysis.

4. Analyze async handles locally
   - Use the repo tool `tools/analyze_async_handles.js` (included on the branch) to aggregate and prioritize handle creation stacks. Example usage:

     node tools/analyze_async_handles.js --input ./artifacts-ci-runs/<run-id>/ --output ./artifacts-ci-runs/<run-id>/analysis.json

5. Iteration guidance
   - If the artifacts indicate lingering `Agent` sockets (http/https or undici), first ensure code destroys globalAgent or per-request agent.destroy() calls are added in teardown paths.
   - For bound-anonymous-fn issues rooted in third-party libs, prefer using the `requestApp` helper pattern (ephemeral server + per-request agent) rather than direct supertest/app patterns.

Notes:

- I cannot dispatch GitHub workflows from this environment; follow the steps above to run them manually and then either upload the artifacts here or share the run URL and I will help analyze.
