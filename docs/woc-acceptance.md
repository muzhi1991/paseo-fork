# WOC first deployment acceptance — 2026-10-30

The deployment uses upstream source `deb1bdc2666c7fdf964933875635767fe8b66c20` with the WOC adaptation on `feat/woc-embedded`. Runtime: Node 22.23.4, Pi 1.4.0, Cua CLI 0.7.0. The server, SDK and plugin API are built from that source; the published Paseo 0.14.0 package alone is insufficient.

## Deployed boundary

- WOC console: `http://192.168.31.101:36083/agent`.
- Authenticated AI bridge: port 36084, in the separate `woc-agent` container. The raw daemon listens only on container loopback.
- Model endpoint: `http://192.168.31.3:8317/v1`; `deepseek-flash` is the default, `glm-5.3-flash` is the second choice. Keys are private mounted files.
- Persisted deployment: `/root/woc-agent/{state,workspace,secrets}` on llm server.
- Runtime image: `sha256:d76ed395e7e36cccfc8d878bbf7220f3f269b134926ab10f1244c242effe5e16`. Web assets and WOC adapters are mounted separately; keep their source revisions with the deployment.
- Panel image: `sha256:638c27ff966016bc752b82c77ec41951ffad1f8ad3ecc3639440b9e65cb5a12c`. Panel rollback files are in `/root/woc-ui-private/paseo-agent-v1` and `paseo-agent-v2`.

## Verified behavior

Both model names were checked against the API, exercised with actual tool calls, and tested with a small image. Each Pi conversation found the three installed skills, called the WOC machine-list tool and original Cua Spaces tool, and wrote a workspace file. Both agreed on the same three machines and their distinct gateway ports.

The desktop test used only `dfde788ec9`, without clicking or typing. A real Pi read its screenshot, acquired the WOC lock, moved the real cursor to `(60,60)`, verified the position and released the lock. One initial Cua call combined mutually exclusive target/scope parameters; Pi corrected it from the tool error. No WeChat messages were sent.

A separate two-identity MCP test verified unlocked writes return a visible `WOC_LOCK_REQUIRED` error; other clients can still read while a lock is held; another identity cannot acquire or write; the holder can write; explicit release restores availability. Existing lock expiry behavior remains covered by WOC control tests; this deployment did not wait out every configurable timeout.

Chrome exercised WOC entry without another password or pairing, new conversation, actual streamed reply, history after refresh, workspace file preview, archive, restore, deletion and logout. Restoration was additionally checked by exact agent IDs and credential digests to catch accidental duplicate creation. Deleting the disposable conversation retained its workspace file. Restarting only the Agent container preserved the remaining conversations, files and identities; the launch plugin returned to running state.

Application containers `woc-wx-77bafd5161`, `woc-wx-53c41906da`, `woc-wx-dfde788ec9` and independent `cua-worker-01` retained their original container IDs and start times. The Mac Paseo service was not changed.

## Repeat checks

Local source checks:

```sh
npm run typecheck --workspace=@getpaseo/app
npx tsc -p woc/plugin/tsconfig.json --noEmit
npm run lint -- woc packages/app/src/woc
node --test woc/test/bridge.test.mjs
node --import tsx --test woc/test/plugin.test.mjs
```

Inside the dedicated Agent container, `woc/test/agent-acceptance.mjs MODEL` creates labelled test conversations. `gui-acceptance.mjs` and `lock-acceptance.mjs` use those identities and the designated disposable desktop; review their target before using another deployment. Run `restart-acceptance.mjs before`, restart the container, then run it with `after`. That check expects the model-test files and `acceptance/ui.txt` from browser acceptance. Do not run a restart while an Agent is working or holding a GUI lock.

Bridge tests exercise real HTTP/WebSocket connections with fixture auth, foreign-origin rejection, credential stripping and logout closure. WOC's provisioning and control suite passed 39 tests; its server typecheck and web production build also passed. Browser evidence is retained locally under the WOC checkout's ignored `artifacts/paseo-agent/`; private model/GUI transcripts are under `/root/woc-agent/state/` and are not committed.

The first version has one shared administrator workspace. Advanced upstream UI is hidden in embedded mode and remains available with `?woc=0`. It does not introduce per-user file isolation, scheduled autonomous tasks, or a new application automation layer. Existing WOC/Cua skills and gateway remain responsible for computer operations.

## Initial page load follow-up

The initial acceptance used a fast LAN and missed the cost of transferring the full Paseo bundle. Chrome's network timeline showed a 23,852,268-byte main script, no compression and a fresh download on every reload. Source-map attribution found roughly 4.36 MB of generated protocol validators, 3.58 MB of embedded Mermaid runtime, 1.58 MB of icons and 1.44 MB of locale data. Hiding controls does not remove their imported dependencies.

With Chrome limited to 10 Mbps and 20 ms latency, time until the model controls appeared was:

| Build                                           | First visit |  Reload | Main script transferred |
| ----------------------------------------------- | ----------: | ------: | ----------------------: |
| Original                                        |     20.55 s | 19.67 s |                23.85 MB |
| Gzip and static cache                           |      6.14 s |  0.46 s |                 5.31 MB |
| Also defer Mermaid until a diagram is requested |      4.90 s |  0.51 s |                 4.34 MB |

The final uncompressed main script is 20,273,607 bytes. Reload transfers zero bytes for the immutable assets. These are measured samples under the same artificial bandwidth limit, not a universal timing guarantee. Further reduction of protocol validators, icons and locale imports would require separate upstream-boundary work.

The bridge regression test first failed on the missing compression header, then passed compression, opt-out negotiation, caching boundaries, authentication and logout checks. Four real-browser Mermaid tests passed, including delayed loading with queued requests. A production Pi conversation rendered a diagram successfully and fetched the separate renderer chunk exactly once; its disposable test conversation was deleted. Ordinary chat did not fetch the renderer.

Repeat the performance check from this checkout, using the existing private panel password on stdin:

```sh
ssh root@192.168.31.101 'cat /root/woc-cua-control/deploy/cua-control/secrets/panel-admin-password' | PERF_MBPS=10 node woc/test/load-acceptance.mjs
```

The harness uses Chrome, logs only timing/resource metadata, and checks both readiness and zero static re-download. Browser unit tests can use the normal app Vitest browser configuration; this Mac used an ignored override selecting installed Chrome because the dependency's pinned Playwright Chromium was absent.

Rollback for this change is `/root/woc-agent/rollback/20261030-load/`: restore `bridge.mjs` and `web-ui-before`, then restart only the idle `woc-agent` container. The application containers and WOC panel were not restarted for this fix.
