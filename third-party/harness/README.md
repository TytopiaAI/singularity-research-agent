Desktop browser guest policy and the primary-runtime preparation scripts are adapted from DeepSeek Harness, tag `dsh-v0.2.1-rc.3`, under the adjacent MIT license.

Source: https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.3

Local changes: bind browser leases to Singularity's embedded WebContents, use scoped IPC names, use extensionless TypeScript imports and a workspace-owned preparation entry. Download hashes and interpreter/library versions remain pinned in `scripts/primary-runtime/lock.json`. The extraction library is updated independently for security fixes.
